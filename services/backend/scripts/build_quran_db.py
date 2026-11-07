"""
بناء قاعدة البيانات القرآنية الكاملة الموثقة (114 سورة، 6,236 آية، ~77,430 كلمة)
مع استخراج أحكام التجويد المرجعية، توصيف QPS، وشبكة المتشابهات اللفظية، وجداول التسميع و FSRS.
"""

from __future__ import annotations
import json
import os
import sqlite3
import sys
import time
from collections import defaultdict
from pathlib import Path

import httpx

ROOT_DIR = Path(__file__).resolve().parents[3]
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.arabic_utils import (  # noqa: E402
    clean_uthmani_display,
    normalize_quran_phrase,
    normalize_quran_word,
    tokenize_ayah_uthmani_and_simple,
)
from app.tajweed_engine import (  # noqa: E402
    build_qps_descriptor,
    extract_word_tajweed_rules,
)

DB_PATH = ROOT_DIR / "data" / "quran.db"


def strip_header_basmalah(surah_num: int, ayah_num: int, text: str) -> str:
    """
    فصل البسملة الاستفتاحية عن الآية الأولى في السور (2..114 عدا التوبة 9)،
    مع إبقائها آيةً أولى في سورة الفاتحة (1).
    """
    cleaned = clean_uthmani_display(text)
    if surah_num in (1, 9) or ayah_num != 1:
        return cleaned
    parts = cleaned.split()
    if len(parts) > 4:
        first_four_norm = " ".join(normalize_quran_word(w) for w in parts[:4])
        if first_four_norm == "بسم الله الرحمن الرحيم":
            return " ".join(parts[4:]).strip()
    return cleaned


def fetch_quran_editions() -> tuple[dict, dict]:
    print("⏳ جاري تحميل نص المصحف العثماني والإملائي الموثّق (6,236 آية)...")
    with httpx.Client(timeout=60.0) as client:
        r_uthmani = client.get("https://api.alquran.cloud/v1/quran/quran-uthmani")
        r_uthmani.raise_for_status()
        r_simple = client.get("https://api.alquran.cloud/v1/quran/quran-simple")
        r_simple.raise_for_status()
    return r_uthmani.json()["data"], r_simple.json()["data"]


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        DROP TABLE IF EXISTS surahs;
        DROP TABLE IF EXISTS quran_ayahs;
        DROP TABLE IF EXISTS quran_words;
        DROP TABLE IF EXISTS mutashabihat_links;
        DROP TABLE IF EXISTS recitation_sessions;
        DROP TABLE IF EXISTS session_mistakes;
        DROP TABLE IF EXISTS memorization_progress;
        DROP TABLE IF EXISTS memorization_plans;

        CREATE TABLE surahs (
            number INTEGER PRIMARY KEY,
            name_ar TEXT NOT NULL,
            name_uthmani TEXT NOT NULL,
            name_en TEXT NOT NULL,
            revelation_type TEXT NOT NULL,
            ayah_count INTEGER NOT NULL,
            start_page INTEGER NOT NULL,
            end_page INTEGER NOT NULL
        );

        CREATE TABLE quran_ayahs (
            id INTEGER PRIMARY KEY,
            surah_number INTEGER NOT NULL,
            ayah_number INTEGER NOT NULL,
            page_number INTEGER NOT NULL,
            juz_number INTEGER NOT NULL,
            hizb_quarter INTEGER NOT NULL,
            sajda INTEGER NOT NULL DEFAULT 0,
            text_uthmani TEXT NOT NULL,
            text_imlaei TEXT NOT NULL,
            text_normalized TEXT NOT NULL,
            word_count INTEGER NOT NULL
        );

        CREATE INDEX idx_ayahs_surah ON quran_ayahs(surah_number, ayah_number);
        CREATE INDEX idx_ayahs_page ON quran_ayahs(page_number);
        CREATE INDEX idx_ayahs_juz ON quran_ayahs(juz_number);

        CREATE TABLE quran_words (
            id INTEGER PRIMARY KEY,
            ayah_id INTEGER NOT NULL REFERENCES quran_ayahs(id),
            surah_number INTEGER NOT NULL,
            ayah_number INTEGER NOT NULL,
            word_position INTEGER NOT NULL,
            page_number INTEGER NOT NULL,
            text_uthmani TEXT NOT NULL,
            display_uthmani TEXT NOT NULL,
            waqf_mark TEXT,
            text_imlaei TEXT NOT NULL,
            text_normalized TEXT NOT NULL,
            tajweed_rules TEXT NOT NULL,
            qps_reference TEXT NOT NULL
        );

        CREATE INDEX idx_words_ayah ON quran_words(ayah_id);
        CREATE INDEX idx_words_page ON quran_words(page_number);
        CREATE INDEX idx_words_surah ON quran_words(surah_number, ayah_number);
        CREATE INDEX idx_words_norm ON quran_words(text_normalized);

        CREATE TABLE mutashabihat_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_ayah_id INTEGER NOT NULL REFERENCES quran_ayahs(id),
            target_ayah_id INTEGER NOT NULL REFERENCES quran_ayahs(id),
            shared_phrase TEXT NOT NULL,
            similarity_score REAL NOT NULL
        );

        CREATE INDEX idx_mutashabihat_src ON mutashabihat_links(source_ayah_id);

        CREATE TABLE recitation_sessions (
            id TEXT PRIMARY KEY,
            mode TEXT NOT NULL,
            surah_number INTEGER,
            page_number INTEGER,
            start_word_id INTEGER,
            end_word_id INTEGER,
            words_recited_count INTEGER DEFAULT 0,
            mistakes_count INTEGER DEFAULT 0,
            tajweed_notes_count INTEGER DEFAULT 0,
            accuracy_score REAL DEFAULT 100.0,
            tajweed_score REAL DEFAULT 100.0,
            duration_seconds INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE session_mistakes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            word_id INTEGER NOT NULL REFERENCES quran_words(id),
            surah_number INTEGER NOT NULL,
            ayah_number INTEGER NOT NULL,
            page_number INTEGER NOT NULL,
            mistake_type TEXT NOT NULL,
            expected_token TEXT NOT NULL,
            spoken_token TEXT NOT NULL,
            details TEXT,
            created_at TEXT NOT NULL
        );

        CREATE INDEX idx_mistakes_word ON session_mistakes(word_id);
        CREATE INDEX idx_mistakes_page ON session_mistakes(page_number);

        CREATE TABLE memorization_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            target_juz INTEGER DEFAULT 30,
            daily_ayahs_goal INTEGER DEFAULT 10,
            active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL
        );

        CREATE TABLE memorization_progress (
            ayah_id INTEGER PRIMARY KEY REFERENCES quran_ayahs(id),
            surah_number INTEGER NOT NULL,
            ayah_number INTEGER NOT NULL,
            stability REAL DEFAULT 1.5,
            difficulty REAL DEFAULT 5.0,
            reps INTEGER DEFAULT 1,
            lapses INTEGER DEFAULT 0,
            last_accuracy REAL DEFAULT 100.0,
            next_review_date TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """
    )


def build_mutashabihat_index(ayah_rows: list[tuple]) -> list[tuple]:
    """
    اكتشاف الآيات المتشابهة لفظياً عبر القرآن الكريم باستخدام البصمات اللفظية (4-grams).
    ayah_rows item: (ayah_id, surah_num, ayah_num, page, juz, hizb, sajda, u_txt, s_txt, norm_txt, w_cnt)
    """
    phrase_buckets: dict[str, list[tuple[int, list[str]]]] = defaultdict(list)
    for row in ayah_rows:
        ayah_id = row[0]
        tokens = row[9].split()
        if len(tokens) < 4:
            continue
        # نأخذ مطلع الآية (أول 4 كلمات) وخاتمتها أو وسطها لبناء روابط دقيقة غير مفرطة
        ngrams_seen = set()
        positions = [0]
        if len(tokens) >= 6:
            positions.append(1)
        for pos in positions:
            gram = " ".join(tokens[pos : pos + 4])
            if gram not in ngrams_seen:
                ngrams_seen.add(gram)
                phrase_buckets[gram].append((ayah_id, tokens))

    links_map: dict[tuple[int, int], tuple[str, float]] = {}
    for gram, items in phrase_buckets.items():
        if len(items) < 2 or len(items) > 18:
            continue
        for i in range(len(items)):
            id_a, tok_a = items[i]
            set_a = set(tok_a)
            for j in range(i + 1, len(items)):
                id_b, tok_b = items[j]
                if id_a == id_b:
                    continue
                set_b = set(tok_b)
                jaccard = len(set_a & set_b) / max(1, len(set_a | set_b))
                score = round(max(0.65, min(0.99, 0.55 + jaccard * 0.45)), 2)
                for src, dst in ((id_a, id_b), (id_b, id_a)):
                    prev = links_map.get((src, dst))
                    if prev is None or score > prev[1]:
                        links_map[(src, dst)] = (gram, score)

    return [
        (src, dst, phrase, score)
        for (src, dst), (phrase, score) in links_map.items()
    ]


def main() -> None:
    t0 = time.time()
    os.makedirs(DB_PATH.parent, exist_ok=True)
    uthmani_data, simple_data = fetch_quran_editions()

    conn = sqlite3.connect(str(DB_PATH))
    create_schema(conn)

    u_surahs = uthmani_data["surahs"]
    s_surahs = simple_data["surahs"]

    surah_rows = []
    ayah_rows = []
    word_rows = []

    global_ayah_id = 0
    global_word_id = 0

    print("⚙️ جاري تحليل الكلمات واستخراج أحكام التجويد والخط الصوتي QPS...")
    for s_idx, u_surah in enumerate(u_surahs):
        s_surah = s_surahs[s_idx]
        surah_num = u_surah["number"]
        u_ayahs = u_surah["ayahs"]
        s_ayahs = s_surah["ayahs"]

        start_page = u_ayahs[0]["page"]
        end_page = u_ayahs[-1]["page"]
        rev_ar = "مكية" if u_surah["revelationType"] == "Meccan" else "مدنية"
        # اسم السورة الإملائي الفصيح مع الحفاظ على التاء المربوطة والهمزات
        import re as _re
        s_clean = clean_uthmani_display(u_surah["name"]).replace("ٱ", "ا").replace("ءَا", "آ").replace("\u0670", "ا")
        s_clean = _re.sub(r"[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED\u0640\ufeff]", "", s_clean)
        s_clean = _re.sub(r"ا{2,}", "ا", s_clean)
        short_ar = _re.sub(r"^سورة\s+", "", s_clean).strip()
        short_ar = {"ال عمران": "آل عمران"}.get(short_ar, short_ar)

        surah_rows.append(
            (
                surah_num,
                short_ar,
                clean_uthmani_display(u_surah["name"]),
                u_surah["englishName"],
                rev_ar,
                len(u_ayahs),
                start_page,
                end_page,
            )
        )

        for a_idx, u_ayah in enumerate(u_ayahs):
            s_ayah = s_ayahs[a_idx]
            global_ayah_id += 1
            ayah_num = u_ayah["numberInSurah"]
            page_num = u_ayah["page"]
            juz_num = u_ayah["juz"]
            hizb_q = u_ayah["hizbQuarter"]
            sajda_val = 1 if u_ayah.get("sajda") else 0

            u_text = strip_header_basmalah(surah_num, ayah_num, u_ayah["text"])
            s_text = strip_header_basmalah(surah_num, ayah_num, s_ayah["text"])

            tokens = tokenize_ayah_uthmani_and_simple(u_text, s_text)
            norm_ayah = " ".join(t["text_normalized"] for t in tokens if t["text_normalized"])

            ayah_rows.append(
                (
                    global_ayah_id,
                    surah_num,
                    ayah_num,
                    page_num,
                    juz_num,
                    hizb_q,
                    sajda_val,
                    u_text,
                    s_text,
                    norm_ayah,
                    len(tokens),
                )
            )

            num_toks = len(tokens)
            for pos_idx, tok in enumerate(tokens):
                global_word_id += 1
                prev_u = tokens[pos_idx - 1]["text_uthmani"] if pos_idx > 0 else None
                next_u = tokens[pos_idx + 1]["text_uthmani"] if pos_idx + 1 < num_toks else None
                is_end = pos_idx == (num_toks - 1)

                rules = extract_word_tajweed_rules(
                    tok["text_uthmani"],
                    prev_uthmani_word=prev_u,
                    next_uthmani_word=next_u,
                    is_ayah_end=is_end,
                )
                qps_ref = build_qps_descriptor(tok["text_normalized"], rules)

                word_rows.append(
                    (
                        global_word_id,
                        global_ayah_id,
                        surah_num,
                        ayah_num,
                        pos_idx + 1,
                        page_num,
                        tok["text_uthmani"],
                        tok["display_uthmani"],
                        tok["waqf_mark"],
                        tok["text_imlaei"],
                        tok["text_normalized"],
                        json.dumps(rules, ensure_ascii=False),
                        qps_ref,
                    )
                )

    print("🔗 جاري بناء شبكة المتشابهات اللفظية عبر القرآن الكريم...")
    mutashabihat_rows = build_mutashabihat_index(ayah_rows)

    with conn:
        conn.executemany(
            "INSERT INTO surahs VALUES (?,?,?,?,?,?,?,?)", surah_rows
        )
        conn.executemany(
            "INSERT INTO quran_ayahs VALUES (?,?,?,?,?,?,?,?,?,?,?)", ayah_rows
        )
        conn.executemany(
            "INSERT INTO quran_words VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", word_rows
        )
        conn.executemany(
            "INSERT INTO mutashabihat_links (source_ayah_id, target_ayah_id, shared_phrase, similarity_score) VALUES (?,?,?,?)",
            mutashabihat_rows,
        )

        # إضافة خطة حفظ افتراضية جاهزة للمستخدم لبدء التجربة فوراً
        conn.execute(
            """
            INSERT INTO memorization_plans (title, target_juz, daily_ayahs_goal, active, created_at)
            VALUES ('خطة إتقان الفاتحة وجزء عمّ بالتجويد', 30, 12, 1, datetime('now'))
            """
        )

        # تهيئة بطاقات مراجعة متباعدة (FSRS) لسور قصيرة وتبارك ليظهر نظام الجدولة حياً
        conn.execute(
            """
            INSERT INTO memorization_progress (ayah_id, surah_number, ayah_number, stability, difficulty, reps, lapses, last_accuracy, next_review_date, updated_at)
            SELECT id, surah_number, ayah_number,
                   CASE WHEN surah_number = 1 THEN 14.5 WHEN surah_number >= 112 THEN 9.2 ELSE 2.4 END,
                   CASE WHEN surah_number = 1 THEN 3.1 WHEN surah_number >= 112 THEN 3.8 ELSE 5.6 END,
                   CASE WHEN surah_number = 1 THEN 6 ELSE 2 END,
                   0,
                   98.5,
                   CASE WHEN surah_number IN (78, 103, 108) THEN date('now') ELSE date('now', '+2 days') END,
                   datetime('now')
            FROM quran_ayahs
            WHERE surah_number IN (1, 78, 103, 108, 112, 113, 114)
            """
        )

    conn.close()
    elapsed = round(time.time() - t0, 2)
    size_mb = round(DB_PATH.stat().st_size / (1024 * 1024), 2)
    print(
        f"✅ اكتمل بناء قاعدة البيانات بنجاح في {elapsed} ثانية!\n"
        f"   • السور: {len(surah_rows)}\n"
        f"   • الآيات: {len(ayah_rows)}\n"
        f"   • الكلمات القرآنية المفهرسة: {len(word_rows)}\n"
        f"   • روابط المتشابهات اللفظية: {len(mutashabihat_rows)}\n"
        f"   • حجم قاعدة البيانات: {size_mb} MB ({DB_PATH})"
    )


if __name__ == "__main__":
    main()
