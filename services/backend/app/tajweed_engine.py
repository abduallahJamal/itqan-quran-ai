"""
محرك تحليل وتقييم أحكام التجويد والخط الصوتي القرآني (QPS - Quran Phonetic Script)
يدعم:
1. الاستخراج الآلي الدقيق لأحكام التجويد من الرسم العثماني وسياق الكلمات المتتالية.
2. توليد التوصيف الصوتي القياسي (QPS Reference) لكل كلمة وآية.
3. تقييم المخرجات الصوتية ومقارنة أزمنة المدود والغنة والقلقلة والإدغام والإخفاء.
"""

from __future__ import annotations
import json
from typing import Dict, List, Optional

SHADDAH = "\u0651"
SUKOON_MARKS = {"\u0652", "\u06e1"}
MADDAH = "\u0653"
IQLAB_MEEM = "\u06e2"  # ۢ ميم الإقلاب العلوية في رسم مصحف المدينة
TANWEEN_MARKS = {"\u064b", "\u064c", "\u064d", "\u06e2", "\u06ed"}
KASRA = "\u0650"
FATHA = "\u064e"
DAMMA = "\u064f"

QALQALAH_LETTERS = set("قطبجد")
IDGHAM_GHUNNAH_LETTERS = set("ينمو")
IDGHAM_NO_GHUNNAH_LETTERS = set("لر")
IKHFA_LETTERS = set("صذثكجشقسدطزفتضظ")
HAMZAH_FORMS = set("ءأإؤئ")

TAJWEED_RULE_CATALOG: Dict[str, Dict[str, str]] = {
    "MADD_LAZIM": {
        "name_ar": "مد لازم",
        "color": "#991b1b",
        "badge_bg": "#fee2e2",
        "harakat": "6 حركات لزوماً",
        "guide": "يُمدّ بمقدار ست حركات مشبعة وصلاً ووقفاً بسبب مجيء السكون الأصلي أو الشدة بعد حرف المد.",
    },
    "MADD_MUTTASIL": {
        "name_ar": "مد واجب متصل",
        "color": "#dc2626",
        "badge_bg": "#fee2e2",
        "harakat": "4 – 5 حركات",
        "guide": "اجتمع حرف المد والهمزة في كلمة واحدة؛ يجب مدّه أربع أو خمس حركات.",
    },
    "MADD_MUNFASIL": {
        "name_ar": "مد جائز منفصل",
        "color": "#ea580c",
        "badge_bg": "#ffedd5",
        "harakat": "4 – 5 حركات (حفص من الشاطبية)",
        "guide": "جاء حرف المد في آخر الكلمة والهمزة في أول الكلمة التي تليها.",
    },
    "GHUNNAH": {
        "name_ar": "غنّة مشدّدة",
        "color": "#16a34a",
        "badge_bg": "#dcfce7",
        "harakat": "حركتان",
        "guide": "إظهار الغنّة من الخيشوم بمقدار حركتين كاملتين في النون أو الميم المشدّدة.",
    },
    "IKHFA": {
        "name_ar": "إخفاء حقيقي بغنّة",
        "color": "#059669",
        "badge_bg": "#d1fae5",
        "harakat": "حركتان",
        "guide": "النطق بالنون الساكنة أو التنوين بحالة بين الإظهار والإدغام مع غنّة بمقدار حركتين تابعة لما بعدها تفخيماً وترقيقاً.",
    },
    "IDGHAM_GHUNNAH": {
        "name_ar": "إدغام بغنّة",
        "color": "#0d9488",
        "badge_bg": "#ccfbf1",
        "harakat": "حركتان",
        "guide": "إدخال النون الساكنة أو التنوين في أحد حروف (ينمو) مع بقاء الغنّة بمقدار حركتين.",
    },
    "IDGHAM_NO_GHUNNAH": {
        "name_ar": "إدغام بغير غنّة",
        "color": "#64748b",
        "badge_bg": "#f1f5f9",
        "harakat": "إدغام كامل بلا غنة",
        "guide": "إدغام النون الساكنة أو التنوين إدغاماً كاملاً في اللام أو الراء دون غنّة.",
    },
    "IQLAB": {
        "name_ar": "إقلاب",
        "color": "#0284c7",
        "badge_bg": "#e0f2fe",
        "harakat": "حركتان",
        "guide": "قلب النون الساكنة أو التنوين ميماً مخفاة بغنّة بمقدار حركتين عند ملاقاتها لحرف الباء.",
    },
    "QALQALAH_SUGHRA": {
        "name_ar": "قلقلة صغرى",
        "color": "#2563eb",
        "badge_bg": "#dbeafe",
        "harakat": "نبرة سريعة",
        "guide": "اضطراب المخرج عند النطق بأحد حروف (قطب جد) ساكناً في وسط الكلمة أو الكلام.",
    },
    "QALQALAH_KUBRA": {
        "name_ar": "قلقلة كبرى (عند الوقف)",
        "color": "#1d4ed8",
        "badge_bg": "#dbeafe",
        "harakat": "نبرة واضحة عند الوقف",
        "guide": "تظهر القلقلة أوضح وأقوى عند الوقف بالسكون على أحد حروف (قطب جد) في آخر الكلمة.",
    },
    "LAFZ_JALALAH_TARQEEQ": {
        "name_ar": "ترقيق لام لفظ الجلالة",
        "color": "#7c3aed",
        "badge_bg": "#ede9fe",
        "harakat": "ترقيق اللام",
        "guide": "تُرقّق لام لفظ الجلالة (الله) لأنها سُبقت بكسر.",
    },
    "LAFZ_JALALAH_TAFKHEEM": {
        "name_ar": "تفخيم لام لفظ الجلالة",
        "color": "#9333ea",
        "badge_bg": "#f3e8ff",
        "harakat": "تفخيم اللام",
        "guide": "تُفخّم لام لفظ الجلالة (الله) لأنها سُبقت بفتح أو ضم أو ابتُدئ بها.",
    },
}


def _first_arabic_letter(uthmani_word: str) -> Optional[str]:
    """استخراج أول حرف هجائي منطوق في الكلمة التالية (مع تخطي همزة الوصل واللام الشمسية)."""
    if not uthmani_word:
        return None
    letters = [ch for ch in uthmani_word if "\u0621" <= ch <= "\u064a" or ch == "ٱ"]
    if not letters:
        return None
    # إذا بدأت الكلمة بـ (ٱلْ / ٱلّ) مثل (ٱلرَّحِيمِ) نأخذ الحرف المنطوق الأول إن كانت همزة وصل
    if letters[0] == "ٱ" and len(letters) >= 3 and letters[1] == "ل":
        return letters[2]
    if letters[0] == "ٱ" and len(letters) >= 2:
        return letters[1]
    return letters[0]


def _last_arabic_letter(uthmani_word: str) -> Optional[str]:
    letters = [ch for ch in uthmani_word if "\u0621" <= ch <= "\u064a"]
    return letters[-1] if letters else None


def extract_word_tajweed_rules(
    uthmani_word: str,
    prev_uthmani_word: Optional[str] = None,
    next_uthmani_word: Optional[str] = None,
    is_ayah_end: bool = False,
) -> List[Dict[str, str]]:
    """
    استخراج قائمة الأحكام التجويدية الموجودة في الكلمة القرآنية الواحدة
    اعتماداً على ضبط مصحف المدينة النبوية وسياق الوصل والوقف.
    """
    rules: List[Dict[str, str]] = []
    seen_codes = set()

    def add_rule(code: str, letter_hint: str = "") -> None:
        if code in seen_codes or code not in TAJWEED_RULE_CATALOG:
            return
        seen_codes.add(code)
        meta = TAJWEED_RULE_CATALOG[code]
        rules.append(
            {
                "code": code,
                "name_ar": meta["name_ar"],
                "color": meta["color"],
                "harakat": meta["harakat"],
                "letter_hint": letter_hint,
                "guide": meta["guide"],
            }
        )

    n = len(uthmani_word)

    # 1. فحص علامة المد (ٓ) وتصنيف نوع المد (لازم / متصل / منفصل)
    if MADDAH in uthmani_word:
        idx = uthmani_word.find(MADDAH)
        after = uthmani_word[idx + 1 :]
        if SHADDAH in after[:4] or any(sk in after[:3] for sk in SUKOON_MARKS) or (
            len([c for c in uthmani_word if "\u0621" <= c <= "\u064a"]) <= 4
            and not any(h in uthmani_word for h in HAMZAH_FORMS)
            and next_uthmani_word is None
        ):
            # مثل: ٱلضَّآلِّينَ، ٱلْحَآقَّةُ، الٓمٓ
            if any(h in after for h in HAMZAH_FORMS):
                add_rule("MADD_MUTTASIL", "مد + همزة")
            else:
                add_rule("MADD_LAZIM", "مد مشبع 6 حركات")
        elif any(h in after for h in HAMZAH_FORMS):
            # إذا كانت من نحو (يَٰٓأَيُّهَا / هَٰٓؤُلَآءِ) فالأولى منفصل حكماً والثانية متصل
            if uthmani_word.startswith("يَٰٓأَ") or uthmani_word.startswith("هَٰٓأَ"):
                add_rule("MADD_MUNFASIL", "يا النداء + همزة")
            else:
                add_rule("MADD_MUTTASIL", "مد + همزة في كلمة")
        else:
            add_rule("MADD_MUNFASIL", "مد + همزة في الكلمة التالية")

    # 2. فحص الغنة المشددة (نّ / مّ)
    for i, ch in enumerate(uthmani_word):
        if ch in ("ن", "م"):
            window = uthmani_word[i + 1 : i + 4]
            if SHADDAH in window:
                add_rule("GHUNNAH", f"{ch}ّ")

    # 3. فحص الإقلاب المرسوم بميم صغيرة علوية (ۢ)
    if IQLAB_MEEM in uthmani_word and not is_ayah_end:
        add_rule("IQLAB", "ن/تنوين + ب")

    # 4. فحص النون الساكنة في وسط الكلمة (ن عارية من الحركة قبل حروف الإخفاء)
    for i, ch in enumerate(uthmani_word):
        if ch == "ن":
            # ننظر إلى العلامات المباشرة على النون قبل الحرف التالي
            j = i + 1
            diacs = []
            while j < n and not ("\u0621" <= uthmani_word[j] <= "\u064a" or uthmani_word[j] == "ٱ"):
                diacs.append(uthmani_word[j])
                j += 1
            next_letter = uthmani_word[j] if j < n else None
            # النون العارية من الحركة في رسم المصحف داخل الكلمة تدل على الإخفاء (مثل: يُنفِقُونَ، أُنزِلَ، مَنشُورًا)
            if next_letter and not diacs and next_letter in IKHFA_LETTERS:
                add_rule("IKHFA", f"ن + {next_letter}")

    # 5. فحص النون الساكنة أو التنوين في آخر الكلمة مع أول الكلمة التالية (وصلاً)
    if next_uthmani_word and not is_ayah_end:
        next_first = _first_arabic_letter(next_uthmani_word)
        last_let = _last_arabic_letter(uthmani_word)
        tail_marks = uthmani_word[-3:]
        has_tanween_or_bare_noon = (
            any(tm in tail_marks for tm in ("\u064b", "\u064c", "\u064d", "\u06ed", "\u06ea", "\u06eb"))
            or (last_let == "ن" and not any(v in tail_marks[-2:] for v in ({FATHA, DAMMA, KASRA, SHADDAH} | SUKOON_MARKS)))
        )
        if has_tanween_or_bare_noon and next_first:
            if next_first == "ب":
                add_rule("IQLAB", f"تنوين/ن + ب")
            elif next_first in IDGHAM_GHUNNAH_LETTERS:
                add_rule("IDGHAM_GHUNNAH", f"إدغام في ({next_first})")
            elif next_first in IDGHAM_NO_GHUNNAH_LETTERS:
                add_rule("IDGHAM_NO_GHUNNAH", f"إدغام في ({next_first})")
            elif next_first in IKHFA_LETTERS:
                add_rule("IKHFA", f"إخفاء عند ({next_first})")

    # 6. فحص القلقلة (قطب جد)
    for i, ch in enumerate(uthmani_word):
        if ch in QALQALAH_LETTERS:
            window = uthmani_word[i + 1 : i + 3]
            if any(sk in window for sk in SUKOON_MARKS):
                add_rule("QALQALAH_SUGHRA", ch)

    if is_ayah_end:
        last_let = _last_arabic_letter(uthmani_word)
        if last_let in QALQALAH_LETTERS:
            add_rule("QALQALAH_KUBRA", f"{last_let} (وقفاً)")

    # 7. لفظ الجلالة (الله / لله) تفخيماً وترقيقاً
    if "للَّه" in uthmani_word or "ٱللَّه" in uthmani_word:
        if uthmani_word.startswith("لِلَّهِ") or uthmani_word.startswith("بِٱللَّهِ") or (
            prev_uthmani_word and KASRA in prev_uthmani_word[-3:]
        ):
            add_rule("LAFZ_JALALAH_TARQEEQ", "لفظ الجلالة")
        else:
            add_rule("LAFZ_JALALAH_TAFKHEEM", "لفظ الجلالة")

    return rules


def build_qps_descriptor(norm_word: str, rules: List[Dict[str, str]]) -> str:
    """
    بناء التوصيف المرجعي للخط الصوتي القرآني (Quran Phonetic Script - QPS)
    الذي يقارن به نموذج Multi-Level CTC الصوت المنطوق.
    """
    if not rules:
        return f"QPS[{norm_word}:STD]"
    tags = "+".join(r["code"] for r in rules)
    return f"QPS[{norm_word}:{tags}]"


def evaluate_tajweed_on_word(
    word_record: dict,
    spoken_token: str,
    phonetic_score: float,
    had_makhraj_shift: bool,
    simulated_duration_ratio: Optional[float] = None,
) -> List[dict]:
    """
    تقييم مدى التزام القارئ بالأحكام التجويدية ومخارج الحروف في الكلمة الحالية.
    يدمج مخرجات المسافة المخرجية أو نسب أزمنة الإطارات الصوتية من نموذج QPS/CTC.
    """
    findings: List[dict] = []
    raw_rules = word_record.get("tajweed_rules")
    if isinstance(raw_rules, str):
        try:
            rules = json.loads(raw_rules)
        except Exception:
            rules = []
    else:
        rules = raw_rules or []

    # 1. رصد تقارب/انحراف مخرج الحرف (مثل ترقيق الصاد سيناً أو الطاء تاءً)
    if had_makhraj_shift and 0.72 <= phonetic_score < 1.0:
        findings.append(
            {
                "rule_code": "MAKHRAJ_TAFKHEEM",
                "rule_name": "دقة المخرج والتفخيم والترقيق",
                "severity": "warning",
                "word_id": word_record["id"],
                "word_uthmani": word_record["text_uthmani"],
                "message": (
                    f"لوحظ تقارب مخرجي في نطق ﴿{word_record['text_uthmani']}﴾ "
                    f"(سُمِعت قريبة من «{spoken_token}»): انتبه لتمييز التفخيم والترقيق ومخرج الحرف."
                ),
            }
        )

    # 2. تقييم زمن المد أو الغنة عند توفر قياس زمن الإطارات الصوتية (من خادم QPS أو المحاكي)
    if simulated_duration_ratio is not None:
        for r in rules:
            code = r["code"]
            if code in ("MADD_LAZIM", "MADD_MUTTASIL", "MADD_MUNFASIL") and simulated_duration_ratio < 0.70:
                findings.append(
                    {
                        "rule_code": code,
                        "rule_name": r["name_ar"],
                        "severity": "error",
                        "word_id": word_record["id"],
                        "word_uthmani": word_record["text_uthmani"],
                        "message": (
                            f"قصر في {r['name_ar']} في كلمة ﴿{word_record['text_uthmani']}﴾ — "
                            f"المقدار المطلوب: {r['harakat']}."
                        ),
                    }
                )
            elif code in ("GHUNNAH", "IKHFA", "IDGHAM_GHUNNAH", "IQLAB") and simulated_duration_ratio < 0.75:
                findings.append(
                    {
                        "rule_code": code,
                        "rule_name": r["name_ar"],
                        "severity": "warning",
                        "word_id": word_record["id"],
                        "word_uthmani": word_record["text_uthmani"],
                        "message": (
                            f"نقص في زمن {r['name_ar']} في ﴿{word_record['text_uthmani']}﴾ — "
                            f"أتمّ الغنّة بمقدار حركتين."
                        ),
                    }
                )

    return findings
