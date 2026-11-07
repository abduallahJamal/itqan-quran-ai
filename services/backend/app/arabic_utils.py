"""
أدوات المعالجة اللغوية والصوتية للنص القرآني (العثماني والإملائي)
Quranic Arabic Orthographic, Phonetic & Muqatta'at Normalization Utilities.
"""

from __future__ import annotations
import re
from typing import List, Tuple

# علامات الوقف والزخارف القرآنية غير المنطوقة ككلمات مستقلة
WAQF_AND_ORNAMENT_CHARS = set("ۖۗۘۙۚۛۜ۩۞٭۝")

# التشكيل وعلامات الضبط العثماني
TASHKEEL_AND_UTHMANI_MARKS_RE = re.compile(
    r"[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED\u0640\ufeff]"
)

# الألف الخنجرية في الرسم العثماني (تُنطق ألفاً مدية في الإملائي)
DAGGER_ALIF = "\u0670"

# إبدالات الرسم العثماني الشهيرة (الواو المرسومة بدلاً من الألف، إلخ)
UTHMANI_SPECIAL_SUBS = [
    (re.compile(r"صلو" + DAGGER_ALIF + r"([ةت])"), r"صلا\1"),
    (re.compile(r"زكو" + DAGGER_ALIF + r"([ةت])"), r"زكا\1"),
    (re.compile(r"حيو" + DAGGER_ALIF + r"([ةت])"), r"حيا\1"),
    (re.compile(r"غدو" + DAGGER_ALIF + r"([ةت])"), r"غدا\1"),
    (re.compile(r"نجو" + DAGGER_ALIF + r"([ةت])"), r"نجا\1"),
    (re.compile(r"مشكو" + DAGGER_ALIF + r"([ةت])"), r"مشكا\1"),
    (re.compile(r"منو" + DAGGER_ALIF + r"([ةت])"), r"منا\1"),
    (re.compile(r"ربو" + DAGGER_ALIF + r"ا?"), "ربا"),
]

# الحروف المقطعة في أوائل السور وتمثيل نطقها الصوتي الكامل
MUQATTAAT_EXPANSIONS = {
    "الم": "الف لام ميم",
    "المص": "الف لام ميم صاد",
    "الر": "الف لام را",
    "المر": "الف لام ميم را",
    "كهيعص": "كاف ها يا عين صاد",
    "طه": "طا ها",
    "طسم": "طا سين ميم",
    "طس": "طا سين",
    "يس": "يا سين",
    "ص": "صاد",
    "حم": "حا ميم",
    "عسق": "عين سين قاف",
    "ق": "قاف",
    "ن": "نون",
}

# عبارات الاستعاذة والبسملة المستثناة من احتساب الأخطاء أثناء التلاوة
IGNORED_RECITATION_PHRASES = {
    "اعوذ", "بالله", "من", "الشيطان", "الرجيم",
    "صدق", "الله", "العظيم",
}

# مجموعات التقارب الصوتي لمخارج الحروف العربية (لحساب المسافة الصوتية الموزونة)
PHONETIC_GROUPS = [
    set("تط"),
    set("دض"),
    set("ذظز"),
    set("سصث"),
    set("قك"),
    set("هح"),
    set("ءعاه"),
    set("غخ"),
]


def is_pure_ornament(token: str) -> bool:
    """هل الرمز مجرد علامة وقف أو حزب وليس كلمة منطوقة؟"""
    cleaned = token.strip().replace("\ufeff", "")
    if not cleaned:
        return True
    return all((ch in WAQF_AND_ORNAMENT_CHARS) or not ch.strip() for ch in cleaned)


def clean_uthmani_display(text: str) -> str:
    """إزالة محرف BOM مع الحفاظ الكامل على الرسم العثماني وعلامات الضبط."""
    return text.replace("\ufeff", "").strip()


def normalize_quran_word(text: str, unify_ta_marbuta: bool = True) -> str:
    """
    تطبيع الكلمة القرآنية أو المنطوقة (من العثماني أو الإملائي أو مخرجات ASR)
    إلى جذع إملائي موحّد يصلح للمطابقة الدقيقة والبحث السريع.
    """
    if not text:
        return ""

    s = text.replace("\ufeff", "").strip()

    # معالجة الكلمات العثمانية الخاصة مثل الصلوٰة -> الصلاة قبل إزالة الألف الخنجرية
    # نزيل التشكيل ما عدا الألف الخنجرية مؤقتاً
    s_keep_dagger = re.sub(
        r"[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED\u0640]", "", s
    )
    for pattern, repl in UTHMANI_SPECIAL_SUBS:
        s_keep_dagger = pattern.sub(repl, s_keep_dagger)

    # تحويل الألف الخنجرية إلى ألف عادية إن لم يسبقها أو يلحقها حرف علة مرسوم
    out_chars: List[str] = []
    for idx, ch in enumerate(s_keep_dagger):
        if ch == DAGGER_ALIF:
            prev_ch = out_chars[-1] if out_chars else ""
            next_ch = s_keep_dagger[idx + 1] if idx + 1 < len(s_keep_dagger) else ""
            if prev_ch not in ("ا", "آ", "أ", "إ", "ٱ", "ى") and next_ch not in ("ا", "ى"):
                out_chars.append("ا")
        elif ch not in WAQF_AND_ORNAMENT_CHARS:
            out_chars.append(ch)

    s = "".join(out_chars)

    # إزالة واو الجماعة الزائدة المرسومة بعد همزة أو حروف العلة الصامتة الصغيرة (ۥ ۦ)
    s = s.replace("ءا", "ا")

    # توحيد الهمزات والألفات
    s = re.sub(r"[أإآٱ]", "ا", s)
    s = s.replace("ؤ", "و").replace("ئ", "ي")
    s = s.replace("ى", "ي")
    if unify_ta_marbuta:
        s = s.replace("ة", "ه")

    # الإبقاء على الحروف العربية والمسافات فقط
    s = re.sub(r"[^\u0621-\u064A\s]", "", s)
    # تقليص تكرار الألف الناتج أحياناً عن الألف الخنجرية + الألف المرسومة
    s = re.sub(r"ا{2,}", "ا", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_quran_phrase(text: str) -> str:
    """تطبيع جملة كاملة من الكلمات القرآنية أو المنطوقة."""
    words = [normalize_quran_word(w) for w in text.split()]
    return " ".join(w for w in words if w)


def char_substitution_cost(c1: str, c2: str) -> float:
    """تكلفة استبدال حرف بآخر مع مراعاة التقارب الصوتي لمخارج الحروف."""
    if c1 == c2:
        return 0.0
    for grp in PHONETIC_GROUPS:
        if c1 in grp and c2 in grp:
            return 0.45  # تقارب صوتي في المخرج (مثل ت/ط أو س/ص)
    return 1.0


def phonetic_similarity(w1: str, w2: str) -> Tuple[float, bool]:
    """
    حساب نسبة التشابه الصوتي والنصي [0.0 .. 1.0] بين كلمتين مطبّعتين،
    مع إرجاع راية تشير إلى وجود تقارب مخرجي (للتنبيه على دقة المخرج/التفخيم).
    """
    a = normalize_quran_word(w1)
    b = normalize_quran_word(w2)
    if not a and not b:
        return 1.0, False
    if not a or not b:
        return 0.0, False
    if a == b:
        return 1.0, False

    # فحص الحروف المقطعة (مثل: "الم" مقابل "الف لام ميم" أو جزء منها)
    if a in MUQATTAAT_EXPANSIONS and b in MUQATTAAT_EXPANSIONS[a].replace(" ", ""):
        return 0.95, False
    if b in MUQATTAAT_EXPANSIONS and a in MUQATTAAT_EXPANSIONS[b].replace(" ", ""):
        return 0.95, False

    m, n = len(a), len(b)
    dp = [[0.0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = float(i)
    for j in range(n + 1):
        dp[0][j] = float(j)

    had_makhraj_proximity = False
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            cost = char_substitution_cost(a[i - 1], b[j - 1])
            if 0.0 < cost < 1.0:
                had_makhraj_proximity = True
            dp[i][j] = min(
                dp[i - 1][j] + 0.85,          # حذف حرف (كألف مدية)
                dp[i][j - 1] + 0.85,          # إضافة حرف
                dp[i - 1][j - 1] + cost,      # استبدال
            )

    max_len = max(m, n)
    score = max(0.0, 1.0 - (dp[m][n] / max_len))
    return round(score, 4), had_makhraj_proximity


def tokenize_ayah_uthmani_and_simple(
    uthmani_text: str, simple_text: str
) -> List[dict]:
    """
    تقسيم الآية إلى كلمات متطابقة مع دمج علامات الوقف والحزب بالعرض البصري
    حتى لا تعيق مؤشر التلاوة الصوتي كلمة بكلمة.
    """
    raw_u = clean_uthmani_display(uthmani_text).split()
    raw_s = clean_uthmani_display(simple_text).split()

    # تصفية علامات الوقف في النص البسيط للحصول على قائمة الكلمات المنطوقة
    clean_s = [tok for tok in raw_s if not is_pure_ornament(tok)]

    words: List[dict] = []
    pending_prefix_ornament = ""

    for tok in raw_u:
        if is_pure_ornament(tok):
            if "۞" in tok and not words:
                pending_prefix_ornament = tok + " "
            elif words:
                words[-1]["display_uthmani"] = f"{words[-1]['display_uthmani']} {tok}"
                words[-1]["waqf_mark"] = tok
            else:
                pending_prefix_ornament = tok + " "
            continue

        display_tok = f"{pending_prefix_ornament}{tok}" if pending_prefix_ornament else tok
        pending_prefix_ornament = ""
        norm_tok = normalize_quran_word(tok)

        words.append(
            {
                "text_uthmani": tok,
                "display_uthmani": display_tok,
                "waqf_mark": None,
                "text_imlaei": tok,  # يُحدَّث أدناه إن تطابق عدد الكلمات مع البسيط
                "text_normalized": norm_tok,
            }
        )

    # إذا تطابق عدد الكلمات بين العثماني والإملائي نربط النص الإملائي المشكول مباشرة
    if len(clean_s) == len(words):
        for idx, s_tok in enumerate(clean_s):
            words[idx]["text_imlaei"] = s_tok
            # نأخذ التطبيع من الإملائي لأنه أوضح في الألفات والهمزات
            norm_s = normalize_quran_word(s_tok)
            if norm_s:
                words[idx]["text_normalized"] = norm_s
    else:
        # في الآيات التي تحتوي على "يَٰٓأَيُّهَا" (كلمة في العثماني وكلمتان "يَا أَيُّهَا" في الإملائي)
        # نعتمد تطبيعنا العثماني المتقدم الذي يحولها بدقة إلى "يايها" مع حفظ المرادف المدمج
        s_idx = 0
        for w in words:
            if s_idx < len(clean_s):
                cand1 = normalize_quran_word(clean_s[s_idx])
                if cand1 == w["text_normalized"]:
                    w["text_imlaei"] = clean_s[s_idx]
                    s_idx += 1
                    continue
                elif s_idx + 1 < len(clean_s):
                    cand2 = normalize_quran_word(clean_s[s_idx] + clean_s[s_idx + 1])
                    if cand2 == w["text_normalized"] or phonetic_similarity(cand2, w["text_normalized"])[0] >= 0.82:
                        w["text_imlaei"] = f"{clean_s[s_idx]} {clean_s[s_idx + 1]}"
                        w["text_normalized"] = cand2
                        s_idx += 2
                        continue
                w["text_imlaei"] = clean_s[s_idx]
                s_idx += 1

    return words
