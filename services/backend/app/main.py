"""
الخادم المركزي الموحد لمنصة إتقان القرآنية (Itqan Quran AI Backend)
FastAPI + Real-Time WebSockets + Quran Alignment + Tajweed QPS + FSRS Spaced Repetition
"""

from __future__ import annotations
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .alignment_engine import QuranAlignmentEngine, RecitationSessionState
from .arabic_utils import normalize_quran_word, phonetic_similarity
from .asr_gateway import SelfHostedASRGateway
from .database import get_db, parse_word_row
from .fsrs_planner import compute_fsrs_update
from .tajweed_engine import TAJWEED_RULE_CATALOG

ROOT_DIR = Path(__file__).resolve().parents[3]
WEB_BUNDLE_DIR = ROOT_DIR / "apps" / "web" / "public_bundle"

app = FastAPI(
    title="منصة إتقان القرآنية - Itqan Quran AI API",
    version="1.0.0",
    description="منظومة التسميع الذكي وتصحيح التجويد بالذكاء الاصطناعي المستضاف ذاتياً",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = QuranAlignmentEngine()
asr_gateway = SelfHostedASRGateway()


class PlanUpdatePayload(BaseModel):
    title: str
    target_juz: int
    daily_ayahs_goal: int


def _persist_session_to_db(state: RecitationSessionState, duration_sec: int) -> Dict[str, Any]:
    """حفظ جلسة التلاوة والأخطاء وتحديث جدولة المراجعة المتباعدة FSRS تلقائياً."""
    if state.words_recited == 0 and not state.mistakes:
        return {"saved": False}

    total_attempts = state.words_recited + len(state.mistakes)
    accuracy = round(100.0 * state.words_recited / max(1, total_attempts), 1)
    tajweed_score = round(max(0.0, 100.0 - len(state.tajweed_feedback) * 4.5), 1)
    now_iso = datetime.utcnow().isoformat(timespec="seconds")

    start_w = engine.words.get(state.start_word_id, engine.words[1])

    with get_db() as conn:
        with conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO recitation_sessions (
                    id, mode, surah_number, page_number, start_word_id, end_word_id,
                    words_recited_count, mistakes_count, tajweed_notes_count,
                    accuracy_score, tajweed_score, duration_seconds, created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    state.session_id,
                    state.mode,
                    start_w["surah_number"],
                    start_w["page_number"],
                    state.start_word_id,
                    max(state.start_word_id, state.furthest_word_id),
                    state.words_recited,
                    len(state.mistakes),
                    len(state.tajweed_feedback),
                    accuracy,
                    tajweed_score,
                    max(1, duration_sec),
                    now_iso,
                ),
            )

            for m in state.mistakes:
                conn.execute(
                    """
                    INSERT INTO session_mistakes (
                        session_id, word_id, surah_number, ayah_number, page_number,
                        mistake_type, expected_token, spoken_token, details, created_at
                    ) VALUES (?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        state.session_id,
                        m["word_id"],
                        m["surah_number"],
                        m["ayah_number"],
                        m["page_number"],
                        m["mistake_type"],
                        m["expected_token"],
                        m["spoken_token"],
                        m.get("details", ""),
                        now_iso,
                    ),
                )

            for tj in state.tajweed_feedback:
                wid = tj["word_id"]
                w_obj = engine.words[wid]
                conn.execute(
                    """
                    INSERT INTO session_mistakes (
                        session_id, word_id, surah_number, ayah_number, page_number,
                        mistake_type, expected_token, spoken_token, details, created_at
                    ) VALUES (?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        state.session_id,
                        wid,
                        w_obj["surah_number"],
                        w_obj["ayah_number"],
                        w_obj["page_number"],
                        f"TAJWEED_{tj['rule_code']}",
                        w_obj["text_uthmani"],
                        tj["rule_name"],
                        tj["message"],
                        now_iso,
                    ),
                )

            # تحديث بطاقات المراجعة المتباعدة (FSRS) للآيات التي شملتها الجلسة
            touched_ayahs = set()
            for wid in state.revealed_word_ids:
                if wid in engine.words:
                    touched_ayahs.add(engine.words[wid]["ayah_id"])

            mistakes_per_ayah: Dict[int, int] = {}
            for m in state.mistakes:
                aid = engine.words[m["word_id"]]["ayah_id"]
                mistakes_per_ayah[aid] = mistakes_per_ayah.get(aid, 0) + 1
                touched_ayahs.add(aid)

            for aid in list(touched_ayahs)[:60]:
                ayah_obj = engine.ayahs[aid]
                m_cnt = mistakes_per_ayah.get(aid, 0)
                w_cnt = max(1, ayah_obj["word_count"])
                ayah_acc = max(0.0, 100.0 * (w_cnt - m_cnt) / w_cnt)

                existing = conn.execute(
                    "SELECT * FROM memorization_progress WHERE ayah_id = ?", (aid,)
                ).fetchone()

                if existing:
                    upd = compute_fsrs_update(
                        existing["stability"],
                        existing["difficulty"],
                        existing["reps"],
                        existing["lapses"],
                        ayah_acc,
                    )
                else:
                    upd = compute_fsrs_update(1.5, 5.0, 0, 0, ayah_acc)

                conn.execute(
                    """
                    INSERT OR REPLACE INTO memorization_progress (
                        ayah_id, surah_number, ayah_number, stability, difficulty,
                        reps, lapses, last_accuracy, next_review_date, updated_at
                    ) VALUES (?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        aid,
                        ayah_obj["surah_number"],
                        ayah_obj["ayah_number"],
                        upd["stability"],
                        upd["difficulty"],
                        upd["reps"],
                        upd["lapses"],
                        upd["last_accuracy"],
                        upd["next_review_date"],
                        upd["updated_at"],
                    ),
                )

    return {
        "saved": True,
        "session_id": state.session_id,
        "accuracy_score": accuracy,
        "tajweed_score": tajweed_score,
        "words_recited": state.words_recited,
        "mistakes_count": len(state.mistakes),
    }


# ==============================================================================
# REST API Endpoints
# ==============================================================================


@app.get("/api/health")
async def api_health() -> Dict[str, Any]:
    worker_status = await asr_gateway.check_worker_health()
    return {
        "status": "ok",
        "stats": {
            "surahs": len(engine.surahs),
            "ayahs": len(engine.ayahs),
            "words": engine.max_word_id,
        },
        "ai_worker": worker_status,
    }


@app.get("/api/surahs")
def list_surahs() -> List[Dict[str, Any]]:
    return list(engine.surahs.values())


@app.get("/api/mushaf/page/{page_number}")
def get_mushaf_page(page_number: int) -> Dict[str, Any]:
    if page_number < 1 or page_number > 604:
        raise HTTPException(status_code=400, detail="رقم الصفحة يجب أن يكون بين 1 و 604")

    with get_db() as conn:
        ayahs = conn.execute(
            "SELECT * FROM quran_ayahs WHERE page_number = ? ORDER BY id",
            (page_number,),
        ).fetchall()
        words = [
            parse_word_row(r)
            for r in conn.execute(
                "SELECT * FROM quran_words WHERE page_number = ? ORDER BY id",
                (page_number,),
            ).fetchall()
        ]
        mistake_rows = conn.execute(
            """
            SELECT word_id, COUNT(*) AS count, GROUP_CONCAT(DISTINCT mistake_type) AS types
            FROM session_mistakes
            WHERE page_number = ?
            GROUP BY word_id
            """,
            (page_number,),
        ).fetchall()

    words_by_ayah: Dict[int, List[Dict[str, Any]]] = {}
    for w in words:
        words_by_ayah.setdefault(w["ayah_id"], []).append(w)

    enriched_ayahs = []
    surahs_on_page = set()
    for a in ayahs:
        s_meta = engine.surahs[a["surah_number"]]
        surahs_on_page.add(a["surah_number"])
        enriched_ayahs.append(
            {
                **a,
                "surah_name_ar": s_meta["name_ar"],
                "surah_name_uthmani": s_meta["name_uthmani"],
                "revelation_type": s_meta["revelation_type"],
                "show_basmalah": a["ayah_number"] == 1 and a["surah_number"] not in (1, 9),
                "is_surah_start": a["ayah_number"] == 1,
                "words": words_by_ayah.get(a["id"], []),
            }
        )

    heatmap = {
        str(r["word_id"]): {"count": r["count"], "types": (r["types"] or "").split(",")}
        for r in mistake_rows
    }

    juz_num = ayahs[0]["juz_number"] if ayahs else 1
    first_surah = engine.surahs[ayahs[0]["surah_number"]] if ayahs else None

    return {
        "page_number": page_number,
        "juz_number": juz_num,
        "primary_surah": first_surah,
        "surahs_on_page": [engine.surahs[sn] for sn in sorted(surahs_on_page)],
        "first_word_id": words[0]["id"] if words else 1,
        "last_word_id": words[-1]["id"] if words else 1,
        "word_count": len(words),
        "ayahs": enriched_ayahs,
        "heatmap": heatmap,
    }


@app.get("/api/search")
def search_quran_endpoint(
    q: str = Query(..., min_length=2), limit: int = Query(12, ge=1, le=30)
) -> Dict[str, Any]:
    results = engine.search_quran(q, limit=limit)
    return {"query": q, "count": len(results), "results": results}


@app.get("/api/mutashabihat/page/{page_number}")
def get_page_mutashabihat(page_number: int) -> List[Dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT m.source_ayah_id, m.target_ayah_id, m.shared_phrase, m.similarity_score,
                   sa.surah_number AS src_surah, sa.ayah_number AS src_ayah, sa.text_uthmani AS src_text,
                   ta.surah_number AS tgt_surah, ta.ayah_number AS tgt_ayah, ta.page_number AS tgt_page,
                   ta.text_uthmani AS tgt_text
            FROM mutashabihat_links m
            JOIN quran_ayahs sa ON sa.id = m.source_ayah_id
            JOIN quran_ayahs ta ON ta.id = m.target_ayah_id
            WHERE sa.page_number = ?
            ORDER BY sa.ayah_number, m.similarity_score DESC
            LIMIT 25
            """,
            (page_number,),
        ).fetchall()

    for r in rows:
        r["src_surah_name"] = engine.surahs[r["src_surah"]]["name_ar"]
        r["tgt_surah_name"] = engine.surahs[r["tgt_surah"]]["name_ar"]
    return rows


@app.get("/api/tajweed/catalog")
def get_tajweed_catalog() -> Dict[str, Any]:
    return {"rules": TAJWEED_RULE_CATALOG}


@app.get("/api/analytics/dashboard")
def get_analytics_dashboard() -> Dict[str, Any]:
    today_iso = date.today().isoformat()
    with get_db() as conn:
        summary = conn.execute(
            """
            SELECT COUNT(*) AS sessions_count,
                   COALESCE(SUM(words_recited_count), 0) AS total_words,
                   COALESCE(ROUND(AVG(accuracy_score), 1), 100.0) AS avg_accuracy,
                   COALESCE(ROUND(AVG(tajweed_score), 1), 100.0) AS avg_tajweed
            FROM recitation_sessions
            """
        ).fetchone()

        recent_sessions = conn.execute(
            """
            SELECT * FROM recitation_sessions
            ORDER BY created_at DESC
            LIMIT 12
            """
        ).fetchall()
        for s in recent_sessions:
            if s.get("surah_number") in engine.surahs:
                s["surah_name"] = engine.surahs[s["surah_number"]]["name_ar"]

        recent_mistakes = conn.execute(
            """
            SELECT m.*, w.text_uthmani
            FROM session_mistakes m
            JOIN quran_words w ON w.id = m.word_id
            ORDER BY m.id DESC
            LIMIT 25
            """
        ).fetchall()
        for m in recent_mistakes:
            m["surah_name"] = engine.surahs[m["surah_number"]]["name_ar"]

        weak_words = conn.execute(
            """
            SELECT m.word_id, m.surah_number, m.ayah_number, m.page_number,
                   w.text_uthmani, COUNT(*) AS error_count
            FROM session_mistakes m
            JOIN quran_words w ON w.id = m.word_id
            GROUP BY m.word_id
            ORDER BY error_count DESC, m.word_id ASC
            LIMIT 12
            """
        ).fetchall()
        for ww in weak_words:
            ww["surah_name"] = engine.surahs[ww["surah_number"]]["name_ar"]

        active_plan = conn.execute(
            "SELECT * FROM memorization_plans WHERE active = 1 ORDER BY id DESC LIMIT 1"
        ).fetchone()

        due_reviews = conn.execute(
            """
            SELECT p.*, a.page_number, a.text_uthmani
            FROM memorization_progress p
            JOIN quran_ayahs a ON a.id = p.ayah_id
            WHERE p.next_review_date <= ?
            ORDER BY p.difficulty DESC, p.surah_number, p.ayah_number
            LIMIT 20
            """,
            (today_iso,),
        ).fetchall()
        for d in due_reviews:
            d["surah_name"] = engine.surahs[d["surah_number"]]["name_ar"]

        mastered_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM memorization_progress WHERE stability >= 7.0"
        ).fetchone()["cnt"]
        tracked_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM memorization_progress"
        ).fetchone()["cnt"]

    return {
        "summary": {
            **summary,
            "mastered_ayahs": mastered_count,
            "tracked_ayahs": tracked_count,
            "due_today_count": len(due_reviews),
        },
        "active_plan": active_plan,
        "due_reviews": due_reviews,
        "recent_sessions": recent_sessions,
        "recent_mistakes": recent_mistakes,
        "weak_words": weak_words,
    }


@app.post("/api/plans/update")
def update_memorization_plan(payload: PlanUpdatePayload) -> Dict[str, Any]:
    now_iso = datetime.utcnow().isoformat(timespec="seconds")
    with get_db() as conn:
        with conn:
            conn.execute("UPDATE memorization_plans SET active = 0")
            conn.execute(
                """
                INSERT INTO memorization_plans (title, target_juz, daily_ayahs_goal, active, created_at)
                VALUES (?,?,?,1,?)
                """,
                (payload.title, payload.target_juz, payload.daily_ayahs_goal, now_iso),
            )
    return {"status": "updated"}


@app.delete("/api/mistakes/reset")
def reset_mistake_history() -> Dict[str, Any]:
    with get_db() as conn:
        with conn:
            conn.execute("DELETE FROM session_mistakes")
            conn.execute("DELETE FROM recitation_sessions")
    return {"status": "cleared"}


# ==============================================================================
# Real-Time Bidirectional Recitation WebSocket (/ws/recitation)
# ==============================================================================


@app.websocket("/ws/recitation")
async def websocket_recitation(ws: WebSocket) -> None:
    await ws.accept()
    state = RecitationSessionState()

    try:
        while True:
            message = await ws.receive()

            if message["type"] == "websocket.disconnect":
                break

            # 1. استقبال الشرائح الصوتية الخام (16kHz PCM) وتمريرها لخادم الـ GPU إن وُجد
            if "bytes" in message and message["bytes"]:
                pcm_bytes = message["bytes"]
                expected_w = engine.words.get(state.cursor_word_id)
                expected_qps = expected_w["qps_reference"] if expected_w else None
                gpu_out = await asr_gateway.transcribe_pcm_chunk(pcm_bytes, expected_qps)
                if gpu_out and gpu_out.get("tokens"):
                    res = engine.process_spoken_tokens(
                        state,
                        raw_tokens=gpu_out["tokens"],
                        is_final=gpu_out.get("is_final", True),
                        simulated_duration_ratio=gpu_out.get("duration_ratio"),
                    )
                    await ws.send_json({"type": "alignment_update", **res})
                continue

            # 2. رسائل التحكم والبث النصي المتدفق (JSON)
            if "text" not in message or not message["text"]:
                continue

            import json as _json

            payload = _json.loads(message["text"])
            action = payload.get("action")

            if action == "init":
                start_wid = int(payload.get("start_word_id", 1))
                start_wid = max(1, min(engine.max_word_id, start_wid))
                w_obj = engine.words[start_wid]
                state = RecitationSessionState(
                    mode=payload.get("mode", "MEMORIZATION"),
                    auto_locate=bool(payload.get("auto_locate", False)),
                    cursor_word_id=start_wid,
                    start_word_id=start_wid,
                    furthest_word_id=start_wid,
                    current_page=w_obj["page_number"],
                    current_surah=w_obj["surah_number"],
                )
                await ws.send_json(
                    {
                        "type": "session_ready",
                        "session_id": state.session_id,
                        "cursor_word_id": state.cursor_word_id,
                        "cursor_page": state.current_page,
                        "cursor_surah": state.current_surah,
                        "expected_uthmani": w_obj["text_uthmani"],
                        "expected_qps": w_obj["qps_reference"],
                    }
                )

            elif action == "set_cursor":
                wid = max(1, min(engine.max_word_id, int(payload.get("word_id", 1))))
                w_obj = engine.words[wid]
                state.cursor_word_id = wid
                state.current_page = w_obj["page_number"]
                state.current_surah = w_obj["surah_number"]
                state.auto_locate = bool(payload.get("auto_locate", False))
                state.active_utterance_id = ""
                state.consumed_utterance_idx = 0
                await ws.send_json(
                    {
                        "type": "cursor_updated",
                        "cursor_word_id": wid,
                        "cursor_page": w_obj["page_number"],
                        "cursor_surah": w_obj["surah_number"],
                        "expected_uthmani": w_obj["text_uthmani"],
                    }
                )

            elif action == "stream_transcript":
                # معالجة الدفق المستمر من الميكروفون مع تلافي تكرار الكلمات المستهلكة في نفس الجملة
                utt_id = str(payload.get("utterance_id", "default"))
                text = str(payload.get("text", "")).strip()
                is_final = bool(payload.get("is_final", False))

                if utt_id != state.active_utterance_id:
                    state.active_utterance_id = utt_id
                    state.consumed_utterance_idx = 0

                all_tokens = [t for t in text.split() if normalize_quran_word(t)]
                new_tokens = all_tokens[state.consumed_utterance_idx :]

                if new_tokens:
                    prev_words_recited = state.words_recited
                    prev_mistakes = len(state.mistakes)
                    res = engine.process_spoken_tokens(
                        state,
                        raw_tokens=new_tokens,
                        is_final=is_final,
                    )
                    if is_final:
                        state.consumed_utterance_idx = len(all_tokens)
                    else:
                        # نستهلك فقط الكلمات التي تطابقت فعلاً وأحرزت تقدماً في المؤشر
                        progressed = (state.words_recited - prev_words_recited) + (
                            len(state.mistakes) - prev_mistakes
                        )
                        if progressed > 0:
                            state.consumed_utterance_idx = min(
                                len(all_tokens),
                                state.consumed_utterance_idx + progressed,
                            )
                    await ws.send_json({"type": "alignment_update", **res})

            elif action == "simulate_tokens":
                tokens = payload.get("tokens", [])
                dur_ratio = payload.get("duration_ratio")
                force_hint = payload.get("forced_mistake_hint")
                res = engine.process_spoken_tokens(
                    state,
                    raw_tokens=tokens,
                    is_final=True,
                    simulated_duration_ratio=dur_ratio,
                    forced_mistake_hint=force_hint,
                )
                await ws.send_json({"type": "alignment_update", **res})

            elif action == "end_session":
                dur = int(
                    payload.get(
                        "duration_seconds",
                        max(1, (datetime.utcnow() - state.started_at).seconds),
                    )
                )
                saved_summary = _persist_session_to_db(state, dur)
                await ws.send_json({"type": "session_saved", **saved_summary})
                # تهيئة جلسة جديدة نظيفة عند الموضع الحالي
                w_obj = engine.words[state.cursor_word_id]
                state = RecitationSessionState(
                    mode=state.mode,
                    cursor_word_id=state.cursor_word_id,
                    start_word_id=state.cursor_word_id,
                    furthest_word_id=state.cursor_word_id,
                    current_page=w_obj["page_number"],
                    current_surah=w_obj["surah_number"],
                )

    except WebSocketDisconnect:
        dur = max(1, (datetime.utcnow() - state.started_at).seconds)
        _persist_session_to_db(state, dur)


# ==============================================================================
# تقديم تطبيق الويب المبني (React SPA) من نفس المنفذ لضمان سرعة واستقرار المعاينة
# ==============================================================================

if WEB_BUNDLE_DIR.exists() and (WEB_BUNDLE_DIR / "assets").exists():
    app.mount(
        "/assets",
        StaticFiles(directory=str(WEB_BUNDLE_DIR / "assets")),
        name="web_assets",
    )


@app.api_route("/{full_path:path}", methods=["GET", "HEAD"])
async def serve_spa(full_path: str):
    if full_path.startswith("api/") or full_path.startswith("ws/"):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    target = WEB_BUNDLE_DIR / full_path
    if full_path and target.exists() and target.is_file():
        return FileResponse(str(target))
    index_file = WEB_BUNDLE_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return JSONResponse(
        {"message": "منصة إتقان القرآنية - الواجهة قيد التجهيز"}, status_code=200
    )
