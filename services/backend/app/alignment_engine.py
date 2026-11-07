"""
محرك المطابقة القرآنية اللحظي واكتشاف أخطاء الحفظ والترديد (QuranAlignmentEngine)
يتضمن:
1. فهرس عكسي ثنائي وأحادي فائق السرعة في الذاكرة للبحث الصوتي والنصي عبر 6,236 آية (< 3ms).
2. آلة الحالة لجلسة التلاوة (SEARCHING -> TRACKING) مع دعم المتشابهات.
3. معالجة التخطي (SKIPPED)، الإبدال (SUBSTITUTED)، الترديد الطبيعي (BACKTRACK)،
   البسملة والاستعاذة، والحروف المقطعة، والكلمات المدمجة عثمانياً (مثل: يَٰٓأَيُّهَا).
"""

from __future__ import annotations
import json
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from .arabic_utils import (
    IGNORED_RECITATION_PHRASES,
    MUQATTAAT_EXPANSIONS,
    normalize_quran_phrase,
    normalize_quran_word,
    phonetic_similarity,
)
from .database import get_db
from .tajweed_engine import evaluate_tajweed_on_word


@dataclass
class RecitationSessionState:
    session_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    mode: str = "MEMORIZATION"  # MEMORIZATION | READING | TAJWEED_PRACTICE
    auto_locate: bool = False
    cursor_word_id: int = 1
    start_word_id: int = 1
    furthest_word_id: int = 1
    current_page: int = 1
    current_surah: int = 1
    words_recited: int = 0
    revealed_word_ids: set[int] = field(default_factory=set)
    mistakes: List[Dict[str, Any]] = field(default_factory=list)
    tajweed_feedback: List[Dict[str, Any]] = field(default_factory=list)
    # تتبع الجمل المتدفقة لتجنب تكرار معالجة الكلمات المؤقتة (Interim ASR)
    active_utterance_id: str = ""
    consumed_utterance_idx: int = 0
    started_at: datetime = field(default_factory=datetime.utcnow)


class QuranAlignmentEngine:
    def __init__(self) -> None:
        self.words: Dict[int, Dict[str, Any]] = {}
        self.ayahs: Dict[int, Dict[str, Any]] = {}
        self.surahs: Dict[int, Dict[str, Any]] = {}
        self.page_first_word: Dict[int, int] = {}
        self.surah_first_word: Dict[int, int] = {}
        self.word_inv_index: Dict[str, List[int]] = defaultdict(list)
        self.bigram_inv_index: Dict[str, List[int]] = defaultdict(list)
        self.max_word_id: int = 0
        self._load_index()

    def _load_index(self) -> None:
        from .database import DB_PATH

        if not DB_PATH.exists():
            from scripts.build_quran_db import main as build_db_main

            build_db_main()

        with get_db() as conn:
            for s in conn.execute("SELECT * FROM surahs ORDER BY number"):
                self.surahs[s["number"]] = s

            for a in conn.execute("SELECT * FROM quran_ayahs ORDER BY id"):
                self.ayahs[a["id"]] = a

            for w in conn.execute(
                """
                SELECT id, ayah_id, surah_number, ayah_number, word_position,
                       page_number, text_uthmani, display_uthmani, text_imlaei,
                       text_normalized, tajweed_rules, qps_reference
                FROM quran_words
                ORDER BY id
                """
            ):
                try:
                    w["tajweed_rules"] = json.loads(w["tajweed_rules"])
                except Exception:
                    w["tajweed_rules"] = []
                wid = w["id"]
                self.words[wid] = w
                self.max_word_id = max(self.max_word_id, wid)

                if w["page_number"] not in self.page_first_word:
                    self.page_first_word[w["page_number"]] = wid
                if w["surah_number"] not in self.surah_first_word:
                    self.surah_first_word[w["surah_number"]] = wid

                aid = w["ayah_id"]
                ayah_obj = self.ayahs[aid]
                if "first_word_id" not in ayah_obj:
                    ayah_obj["first_word_id"] = wid
                ayah_obj["last_word_id"] = wid

        # بناء الفهرس العكسي للكلمات والثنائيات اللفظية للبحث الصوتي الفوري
        for aid, a in self.ayahs.items():
            toks = a["text_normalized"].split()
            seen_u = set()
            for tok in toks:
                if tok not in seen_u:
                    seen_u.add(tok)
                    self.word_inv_index[tok].append(aid)
            seen_b = set()
            for i in range(len(toks) - 1):
                bg = f"{toks[i]} {toks[i + 1]}"
                if bg not in seen_b:
                    seen_b.add(bg)
                    self.bigram_inv_index[bg].append(aid)

    # ------------------------------------------------------------------
    # 1. البحث الصوتي والنصي الذكي وتحديد الموضع مع كشف المتشابهات
    # ------------------------------------------------------------------
    def search_quran(self, query: str, limit: int = 12) -> List[Dict[str, Any]]:
        norm_q = normalize_quran_phrase(query)
        if not norm_q:
            return []

        q_tokens = norm_q.split()
        candidate_scores: Counter[int] = Counter()

        # نقاط عالية لتطابق الثنائيات اللفظية المتتالية
        for i in range(len(q_tokens) - 1):
            bg = f"{q_tokens[i]} {q_tokens[i + 1]}"
            postings = self.bigram_inv_index.get(bg, [])
            weight = 6.0 / (1.0 + 0.015 * len(postings))
            for aid in postings:
                candidate_scores[aid] += weight

        # نقاط الكلمات المفردة مع وزن الندرة (IDF تقريبي)
        for tok in q_tokens:
            postings = self.word_inv_index.get(tok, [])
            if len(postings) <= 800 or len(q_tokens) <= 2:
                weight = 2.5 / (1.0 + 0.008 * len(postings))
                for aid in postings:
                    candidate_scores[aid] += weight

        # إن لم نجد تطابقاً حرفياً تاماً (مثلاً خطأ إملائي أو صوتي في البحث)، نبحث صوتياً في الكلمات القريبة
        if not candidate_scores and q_tokens:
            longest_tok = max(q_tokens, key=len)
            for vocab_w, postings in self.word_inv_index.items():
                if abs(len(vocab_w) - len(longest_tok)) <= 2:
                    sim, _ = phonetic_similarity(longest_tok, vocab_w)
                    if sim >= 0.78:
                        for aid in postings[:120]:
                            candidate_scores[aid] += sim * 2.0

        top_candidates = [aid for aid, _ in candidate_scores.most_common(60)]
        results: List[Dict[str, Any]] = []

        for aid in top_candidates:
            ayah = self.ayahs[aid]
            a_norm = ayah["text_normalized"]
            a_tokens = a_norm.split()

            # حساب دقة التطابق المتسلسل داخل الآية وتحديد الكلمة المطابقة لبداية التلاوة
            exact_sub = 1.0 if norm_q in a_norm else 0.0
            best_window_sim = 0.0
            matched_offset = 0
            win_len = min(len(q_tokens), len(a_tokens))

            if win_len > 0:
                for start_i in range(max(1, len(a_tokens) - win_len + 1)):
                    sims = [
                        phonetic_similarity(q_tokens[k], a_tokens[start_i + k])[0]
                        for k in range(win_len)
                    ]
                    avg_s = sum(sims) / win_len
                    if avg_s > best_window_sim:
                        best_window_sim = avg_s
                        matched_offset = start_i

            final_score = round(min(1.0, best_window_sim * 0.82 + exact_sub * 0.18), 3)
            if final_score < 0.58:
                continue

            surah_meta = self.surahs[ayah["surah_number"]]
            start_wid = ayah["first_word_id"] + matched_offset
            next_wid = min(self.max_word_id, start_wid + win_len)

            results.append(
                {
                    "ayah_id": aid,
                    "surah_number": ayah["surah_number"],
                    "surah_name": surah_meta["name_ar"],
                    "ayah_number": ayah["ayah_number"],
                    "page_number": ayah["page_number"],
                    "juz_number": ayah["juz_number"],
                    "text_uthmani": ayah["text_uthmani"],
                    "match_score": final_score,
                    "matched_start_word_id": start_wid,
                    "resume_cursor_word_id": next_wid,
                }
            )

        results.sort(key=lambda r: (-r["match_score"], r["surah_number"], r["ayah_number"]))
        return results[:limit]

    # ------------------------------------------------------------------
    # 2. محرك التتبع اللحظي كلمة بكلمة واكتشاف الأخطاء
    # ------------------------------------------------------------------
    def _is_basmalah_or_istiadhah(self, norm_tok: str, cursor_word: Dict[str, Any]) -> bool:
        """هل الكلمة المنطوقة جزء من الاستعاذة أو البسملة خارج الآية المتتبعة؟"""
        if norm_tok in IGNORED_RECITATION_PHRASES:
            # انتبه: كلمة "الله" أو "الرحيم" قد تكون هي نفسها الكلمة المتوقعة في الآية!
            sim_expected, _ = phonetic_similarity(norm_tok, cursor_word["text_normalized"])
            if sim_expected >= 0.80:
                return False
            return True
        if norm_tok in ("بسم", "الرحمن", "الرحيم") and cursor_word["ayah_number"] == 1 and cursor_word["surah_number"] != 1:
            sim_expected, _ = phonetic_similarity(norm_tok, cursor_word["text_normalized"])
            if sim_expected < 0.80:
                return True
        return False

    def process_spoken_tokens(
        self,
        state: RecitationSessionState,
        raw_tokens: List[str],
        is_final: bool = True,
        simulated_duration_ratio: Optional[float] = None,
        forced_mistake_hint: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        معالجة دفق الكلمات الجديدة المنطوقة وتحديث مؤشر المصحف وسجل الأخطاء والتجويد.
        """
        events: List[Dict[str, Any]] = []
        norm_tokens = [
            (tok, normalize_quran_word(tok))
            for tok in raw_tokens
            if normalize_quran_word(tok)
        ]

        # إذا كان المستخدم في وضع "التعرف التلقائي الحر" ولم يثبت الموضع بعد
        if state.auto_locate and len(norm_tokens) >= 2:
            phrase = " ".join(nt for _, nt in norm_tokens)
            matches = self.search_quran(phrase, limit=3)
            if matches and matches[0]["match_score"] >= 0.78:
                best = matches[0]
                state.auto_locate = False
                state.start_word_id = best["matched_start_word_id"]
                state.cursor_word_id = best["matched_start_word_id"]
                state.current_page = best["page_number"]
                state.current_surah = best["surah_number"]
                events.append(
                    {
                        "event": "VERSE_LOCATED",
                        "surah_number": best["surah_number"],
                        "surah_name": best["surah_name"],
                        "ayah_number": best["ayah_number"],
                        "page_number": best["page_number"],
                        "mutashabihat_candidates": matches[1:] if len(matches) > 1 and matches[1]["match_score"] >= 0.82 else [],
                    }
                )

        idx = 0
        n_toks = len(norm_tokens)

        while idx < n_toks and state.cursor_word_id <= self.max_word_id:
            raw_spk, norm_spk = norm_tokens[idx]
            expected = self.words[state.cursor_word_id]
            exp_norm = expected["text_normalized"]

            # 1. فحص الاستعاذة والبسملة الاستفتاحية
            if self._is_basmalah_or_istiadhah(norm_spk, expected):
                events.append(
                    {
                        "event": "IGNORED_HEADER_PHRASE",
                        "spoken": raw_spk,
                    }
                )
                idx += 1
                continue

            # 2. مطابقة مباشرة مع الكلمة المتوقعة عند المؤشر
            sim, makhraj_shift = phonetic_similarity(norm_spk, exp_norm)

            # 2-ب: فحص الكلمات المركبة عثمانياً مثل (يَٰٓأَيُّهَا = "يا" + "أيها") أو (وَأَن لَّوِ)
            consumed_count = 1
            if sim < 0.80 and idx + 1 < n_toks:
                merged_norm = norm_spk + norm_tokens[idx + 1][1]
                sim_merged, makhraj_merged = phonetic_similarity(merged_norm, exp_norm)
                if sim_merged >= 0.82 and sim_merged > sim:
                    sim = sim_merged
                    makhraj_shift = makhraj_merged
                    raw_spk = f"{raw_spk} {norm_tokens[idx + 1][0]}"
                    consumed_count = 2

            # 2-ج: فحص نطق الحروف المقطعة مفردة (مثل: "ألف" "لام" "ميم" للكلمة "الٓمٓ")
            if sim < 0.80 and exp_norm in MUQATTAAT_EXPANSIONS:
                exp_parts = MUQATTAAT_EXPANSIONS[exp_norm].split()
                k_len = len(exp_parts)
                if idx + k_len <= n_toks:
                    spoken_join = " ".join(norm_tokens[idx + j][1] for j in range(k_len))
                    sim_muq, _ = phonetic_similarity(spoken_join, " ".join(exp_parts))
                    if sim_muq >= 0.80:
                        sim = 0.98
                        consumed_count = k_len
                        raw_spk = " ".join(norm_tokens[idx + j][0] for j in range(k_len))

            if sim >= 0.78 and forced_mistake_hint != "FORCE_SUBSTITUTION":
                # تطابق صحيح! نكشف الكلمة ونفحص التجويد ثم نقدم المؤشر
                wid = state.cursor_word_id
                state.revealed_word_ids.add(wid)
                state.words_recited += 1
                state.furthest_word_id = max(state.furthest_word_id, wid)

                tj_notes = evaluate_tajweed_on_word(
                    expected,
                    spoken_token=raw_spk,
                    phonetic_score=sim,
                    had_makhraj_shift=makhraj_shift,
                    simulated_duration_ratio=simulated_duration_ratio,
                )
                for note in tj_notes:
                    state.tajweed_feedback.append(note)
                    events.append({"event": "TAJWEED_NOTE", **note})

                events.append(
                    {
                        "event": "WORD_MATCHED",
                        "word_id": wid,
                        "uthmani": expected["text_uthmani"],
                        "spoken": raw_spk,
                        "similarity": sim,
                        "ayah_number": expected["ayah_number"],
                        "surah_number": expected["surah_number"],
                        "page_number": expected["page_number"],
                    }
                )

                state.cursor_word_id = min(self.max_word_id, wid + 1)
                next_w = self.words[state.cursor_word_id]
                state.current_page = next_w["page_number"]
                state.current_surah = next_w["surah_number"]
                idx += consumed_count
                continue

            # إذا كانت النتيجة الصوتية لا تزال جزئية (Interim) في آخر حرف من الكلمة، ننتظر استقرارها
            if not is_final and idx == n_toks - 1:
                events.append(
                    {
                        "event": "PARTIAL_LISTENING",
                        "spoken": raw_spk,
                        "expected_word_id": state.cursor_word_id,
                    }
                )
                break

            # 3. فحص الترديد الطبيعي للخلف (Backtracking / Self-Correction) في آخر 4 كلمات
            backtracked_to: Optional[int] = None
            for back_offset in range(1, 5):
                prev_id = state.cursor_word_id - back_offset
                if prev_id >= 1:
                    prev_w = self.words[prev_id]
                    b_sim, _ = phonetic_similarity(norm_spk, prev_w["text_normalized"])
                    if b_sim >= 0.84:
                        backtracked_to = prev_id
                        break

            if backtracked_to is not None:
                # نرجع المؤشر بهدوء مع القارئ ليكمل ترديده دون تسجيل خطأ
                state.cursor_word_id = min(self.max_word_id, backtracked_to + 1)
                events.append(
                    {
                        "event": "BACKTRACK_DETECTED",
                        "realigned_word_id": backtracked_to,
                        "spoken": raw_spk,
                    }
                )
                idx += 1
                continue

            # 4. فحص تخطي كلمة أو كلمتين للأمام (SKIPPED WORD)
            skipped_target: Optional[int] = None
            for ahead_offset in (1, 2, 3):
                ahead_id = state.cursor_word_id + ahead_offset
                if ahead_id <= self.max_word_id:
                    ahead_w = self.words[ahead_id]
                    a_sim, _ = phonetic_similarity(norm_spk, ahead_w["text_normalized"])
                    if a_sim >= 0.84:
                        skipped_target = ahead_id
                        break

            if skipped_target is not None:
                # سجّل الكلمات المتخطاة كأخطاء نسيان/تخطي ثم تقدم مع القارئ
                for missed_id in range(state.cursor_word_id, skipped_target):
                    missed_w = self.words[missed_id]
                    mistake_item = {
                        "word_id": missed_id,
                        "surah_number": missed_w["surah_number"],
                        "ayah_number": missed_w["ayah_number"],
                        "page_number": missed_w["page_number"],
                        "mistake_type": "SKIPPED",
                        "expected_token": missed_w["text_uthmani"],
                        "spoken_token": f"(تخطى إلى: {raw_spk})",
                        "details": f"تخطي كلمة ﴿{missed_w['text_uthmani']}﴾ في الآية {missed_w['ayah_number']}",
                    }
                    state.mistakes.append(mistake_item)
                    events.append({"event": "MISTAKE_DETECTED", **mistake_item})

                state.revealed_word_ids.add(skipped_target)
                state.words_recited += 1
                state.cursor_word_id = min(self.max_word_id, skipped_target + 1)
                next_w = self.words[state.cursor_word_id]
                state.current_page = next_w["page_number"]
                state.current_surah = next_w["surah_number"]
                idx += 1
                continue

            # 5. خطأ استبدال كلمة بأخرى (SUBSTITUTED WORD)
            mistake_item = {
                "word_id": state.cursor_word_id,
                "surah_number": expected["surah_number"],
                "ayah_number": expected["ayah_number"],
                "page_number": expected["page_number"],
                "mistake_type": "SUBSTITUTED",
                "expected_token": expected["text_uthmani"],
                "spoken_token": raw_spk,
                "details": f"نُطقت «{raw_spk}» بدلاً من ﴿{expected['text_uthmani']}﴾",
            }
            state.mistakes.append(mistake_item)
            events.append({"event": "MISTAKE_DETECTED", **mistake_item})
            # يبقى المؤشر عند الكلمة نفسها ليصححها القارئ قبل المتابعة!
            idx += 1

        total_attempts = state.words_recited + len(state.mistakes)
        accuracy = (
            round(100.0 * state.words_recited / max(1, total_attempts), 1)
            if total_attempts > 0
            else 100.0
        )
        tajweed_score = round(
            max(0.0, 100.0 - len(state.tajweed_feedback) * 4.5), 1
        )

        cursor_w = self.words[state.cursor_word_id]
        return {
            "session_id": state.session_id,
            "cursor_word_id": state.cursor_word_id,
            "cursor_surah": cursor_w["surah_number"],
            "cursor_ayah": cursor_w["ayah_number"],
            "cursor_page": cursor_w["page_number"],
            "expected_uthmani": cursor_w["text_uthmani"],
            "words_recited": state.words_recited,
            "mistakes_count": len(state.mistakes),
            "tajweed_notes_count": len(state.tajweed_feedback),
            "accuracy_score": accuracy,
            "tajweed_score": tajweed_score,
            "revealed_word_ids": list(state.revealed_word_ids)[-250:],
            "events": events,
        }
