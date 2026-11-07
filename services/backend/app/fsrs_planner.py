"""
محرك الجدولة الذكية للحفظ والمراجعة المتباعدة (FSRS - Free Spaced Repetition Scheduler)
يضبط مواعيد مراجعة الآيات والسور تلقائياً حسب دقة تسميع المستخدم وأخطائه الفعلية.
"""

from __future__ import annotations
from datetime import date, datetime, timedelta
from typing import Dict


def compute_fsrs_update(
    prev_stability: float,
    prev_difficulty: float,
    reps: int,
    lapses: int,
    accuracy_pct: float,
) -> Dict[str, float | int | str]:
    """
    تقييم التسميع على مقياس FSRS (1: نسيان/أخطاء كثيرة .. 4: إتقان تام):
      - >= 97% : تقييم 4 (Easy / متقن جداً)
      - >= 90% : تقييم 3 (Good / جيد)
      - >= 75% : تقييم 2 (Hard / يحتاج تثبيتاً)
      - <  75% : تقييم 1 (Again / تعثر في الحفظ)
    """
    if accuracy_pct >= 97.0:
        grade = 4
    elif accuracy_pct >= 90.0:
        grade = 3
    elif accuracy_pct >= 75.0:
        grade = 2
    else:
        grade = 1

    # تحديث معامل الصعوبة [1.0 .. 10.0]
    new_diff = prev_difficulty - 0.65 * (grade - 3)
    new_diff = round(max(1.0, min(10.0, 0.85 * new_diff + 0.15 * 5.0)), 2)

    if grade == 1:
        new_lapses = lapses + 1
        new_stability = round(max(0.5, prev_stability * 0.35), 2)
        interval_days = 0  # تراجع في نفس اليوم أو الغد القريب
    else:
        new_lapses = lapses
        factor = {2: 1.25, 3: 2.15, 4: 3.10}[grade]
        diff_penalty = max(0.55, (11.0 - new_diff) / 8.0)
        new_stability = round(max(1.0, prev_stability * factor * diff_penalty), 2)
        interval_days = max(1, int(round(new_stability)))

    next_date = (date.today() + timedelta(days=interval_days)).isoformat()
    return {
        "stability": new_stability,
        "difficulty": new_diff,
        "reps": reps + 1,
        "lapses": new_lapses,
        "last_accuracy": round(accuracy_pct, 1),
        "next_review_date": next_date,
        "updated_at": datetime.utcnow().isoformat(timespec="seconds"),
        "grade": grade,
        "interval_days": interval_days,
    }
