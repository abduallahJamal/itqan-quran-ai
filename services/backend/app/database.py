"""
طبقة الوصول السريع إلى قاعدة البيانات القرآنية وجلسات المستخدمين.
"""

from __future__ import annotations
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional

ROOT_DIR = Path(__file__).resolve().parents[3]
DB_PATH = ROOT_DIR / "data" / "quran.db"


def dict_factory(cursor: sqlite3.Cursor, row: tuple) -> Dict[str, Any]:
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = dict_factory
    try:
        yield conn
    finally:
        conn.close()


def parse_word_row(row: Dict[str, Any]) -> Dict[str, Any]:
    if isinstance(row.get("tajweed_rules"), str):
        try:
            row["tajweed_rules"] = json.loads(row["tajweed_rules"])
        except Exception:
            row["tajweed_rules"] = []
    return row
