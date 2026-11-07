import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  Award,
  CalendarCheck,
  CheckCircle2,
  Flame,
  RefreshCw,
  Target,
  Trash2,
} from "lucide-react";
import { toArabicDigits } from "../lib/audioAlerts";
import { apiUrl, safeFetchJson } from "../lib/apiConfig";

interface DashboardData {
  summary: {
    sessions_count: number;
    total_words: number;
    avg_accuracy: number;
    avg_tajweed: number;
    mastered_ayahs: number;
    tracked_ayahs: number;
    due_today_count: number;
  };
  active_plan: {
    id: number;
    title: string;
    target_juz: number;
    daily_ayahs_goal: number;
  } | null;
  due_reviews: Array<{
    ayah_id: number;
    surah_number: number;
    surah_name: string;
    ayah_number: number;
    page_number: number;
    stability: number;
    difficulty: number;
    last_accuracy: number;
    next_review_date: string;
    text_uthmani: string;
  }>;
  recent_sessions: Array<{
    id: string;
    surah_name?: string;
    page_number: number;
    words_recited_count: number;
    mistakes_count: number;
    accuracy_score: number;
    tajweed_score: number;
    created_at: string;
  }>;
  recent_mistakes: Array<{
    id: number;
    word_id: number;
    surah_name: string;
    ayah_number: number;
    page_number: number;
    mistake_type: string;
    expected_token: string;
    spoken_token: string;
    details: string;
  }>;
  weak_words: Array<{
    word_id: number;
    surah_name: string;
    ayah_number: number;
    page_number: number;
    text_uthmani: string;
    error_count: number;
  }>;
}

interface Props {
  darkMode: boolean;
  refreshTrigger: number;
  onJumpToWord: (page: number, wordId: number) => void;
  onJumpToPage: (page: number) => void;
}

export function PlannerAndAnalyticsView({
  darkMode,
  refreshTrigger,
  onJumpToWord,
  onJumpToPage,
}: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [planTitle, setPlanTitle] = useState("خطة إتقان الفاتحة وجزء عمّ بالتجويد");
  const [targetJuz, setTargetJuz] = useState(30);
  const [dailyGoal, setDailyGoal] = useState(12);
  const [savingPlan, setSavingPlan] = useState(false);

  const loadDashboard = async () => {
    const d = await safeFetchJson<DashboardData>("/api/analytics/dashboard");
    if (!d || !d.summary) return;
    setData(d);
    if (d.active_plan) {
      setPlanTitle(d.active_plan.title);
      setTargetJuz(d.active_plan.target_juz);
      setDailyGoal(d.active_plan.daily_ayahs_goal);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [refreshTrigger]);

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPlan(true);
    try {
      await fetch(apiUrl("/api/plans/update"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: planTitle,
          target_juz: targetJuz,
          daily_ayahs_goal: dailyGoal,
        }),
      });
      await loadDashboard();
    } finally {
      setSavingPlan(false);
    }
  };

  const handleClearMistakes = async () => {
    await fetch(apiUrl("/api/mistakes/reset"), { method: "DELETE" });
    await loadDashboard();
  };

  if (!data) {
    return <div className="p-12 text-center text-sm opacity-70">جاري تحميل لوحة الإحصائيات وخطة FSRS...</div>;
  }

  return (
    <div className="space-y-6">
      {/* بطاقات المؤشرات الرئيسية */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          className={`rounded-2xl p-4 border ${
            darkMode ? "bg-stone-900 border-stone-800" : "bg-white border-stone-200"
          }`}
        >
          <div className="text-xs opacity-70 flex items-center justify-between">
            <span>إجمالي الكلمات المسمّعة</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold mt-2 text-emerald-700 dark:text-emerald-400">
            {data.summary.total_words}
          </div>
          <div className="text-[11px] opacity-65 mt-1">
            عبر {data.summary.sessions_count} جلسة تسميع مسجلة
          </div>
        </div>

        <div
          className={`rounded-2xl p-4 border ${
            darkMode ? "bg-stone-900 border-stone-800" : "bg-white border-stone-200"
          }`}
        >
          <div className="text-xs opacity-70 flex items-center justify-between">
            <span>متوسط دقة الحفظ</span>
            <Target className="w-4 h-4 text-sky-600" />
          </div>
          <div className="text-2xl font-bold mt-2 text-sky-700 dark:text-sky-400">
            {data.summary.avg_accuracy}%
          </div>
          <div className="text-[11px] opacity-65 mt-1">
            متوسط إتقان التجويد: {data.summary.avg_tajweed}%
          </div>
        </div>

        <div
          className={`rounded-2xl p-4 border ${
            darkMode ? "bg-stone-900 border-stone-800" : "bg-white border-stone-200"
          }`}
        >
          <div className="text-xs opacity-70 flex items-center justify-between">
            <span>الآيات المستحقة اليوم (FSRS)</span>
            <CalendarCheck className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold mt-2 text-amber-700 dark:text-amber-400">
            {data.summary.due_today_count}
          </div>
          <div className="text-[11px] opacity-65 mt-1">
            مجدولة بخوارزمية التكرار المتباعد الذكي
          </div>
        </div>

        <div
          className={`rounded-2xl p-4 border ${
            darkMode ? "bg-stone-900 border-stone-800" : "bg-white border-stone-200"
          }`}
        >
          <div className="text-xs opacity-70 flex items-center justify-between">
            <span>الآيات الراسخة في الحفظ</span>
            <Award className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-bold mt-2 text-purple-700 dark:text-purple-400">
            {data.summary.mastered_ayahs}{" "}
            <span className="text-xs font-normal opacity-65">/ {data.summary.tracked_ayahs}</span>
          </div>
          <div className="text-[11px] opacity-65 mt-1">معامل رسوخ ≥ 7 أيام</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* جدول المراجعة المتباعدة اليومي (FSRS) + إعدادات الخطة (7 أعمدة) */}
        <div className="lg:col-span-7 space-y-5">
          <div
            className={`rounded-2xl p-5 border space-y-4 ${
              darkMode ? "bg-stone-900 border-stone-800" : "bg-white border-stone-200"
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold flex items-center gap-2">
                  <CalendarCheck className="w-5 h-5 text-emerald-600" />
                  ورد المراجعة الذكي المستحق اليوم (خوارزمية FSRS)
                </h2>
                <p className="text-xs opacity-75 mt-0.5">
                  تزداد أولوية الآية تلقائياً إذا تكررت الأخطاء فيها خلال جلسات التسميع، وتتباعد فتراتها كلما أتقنتها.
                </p>
              </div>
              <button
                type="button"
                onClick={loadDashboard}
                className="p-2 rounded-xl border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800"
                title="تحديث"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
              {data.due_reviews.map((item) => (
                <div
                  key={item.ayah_id}
                  className="rounded-xl p-3.5 border border-stone-200 dark:border-stone-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      <span>
                        سورة {item.surah_name} • الآية {toArabicDigits(item.ayah_number)}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300">
                        صعوبة {item.difficulty}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-800 dark:text-sky-300">
                        رسوخ {item.stability} يوم
                      </span>
                    </div>
                    <p className="font-quran text-xl leading-relaxed">{item.text_uthmani}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onJumpToPage(item.page_number)}
                    className="shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-700 text-white hover:bg-emerald-800"
                  >
                    سمّع الآن (ص {toArabicDigits(item.page_number)})
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* تخصيص خطة الحفظ اليومية */}
          <form
            onSubmit={handleSavePlan}
            className={`rounded-2xl p-5 border space-y-4 ${
              darkMode ? "bg-stone-900 border-stone-800" : "bg-white border-stone-200"
            }`}
          >
            <h3 className="text-sm font-bold">إعداد خطة الحفظ والورد اليومي</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="sm:col-span-2 space-y-1">
                <label className="font-semibold opacity-80">عنوان الخطة</label>
                <input
                  type="text"
                  value={planTitle}
                  onChange={(e) => setPlanTitle(e.target.value)}
                  className={`w-full rounded-xl px-3 py-2 border ${
                    darkMode ? "bg-stone-800 border-stone-700" : "bg-stone-50 border-stone-200"
                  }`}
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold opacity-80">الجزء المستهدف (1..30)</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={targetJuz}
                  onChange={(e) => setTargetJuz(Number(e.target.value))}
                  className={`w-full rounded-xl px-3 py-2 border ${
                    darkMode ? "bg-stone-800 border-stone-700" : "bg-stone-50 border-stone-200"
                  }`}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold">الورد اليومي (عدد الآيات):</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={dailyGoal}
                  onChange={(e) => setDailyGoal(Number(e.target.value))}
                  className={`w-20 rounded-xl px-3 py-1.5 border text-center font-bold ${
                    darkMode ? "bg-stone-800 border-stone-700" : "bg-stone-50 border-stone-200"
                  }`}
                />
              </div>
              <button
                type="submit"
                disabled={savingPlan}
                className="px-4 py-2 rounded-xl bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 font-bold"
              >
                {savingPlan ? "جاري الحفظ..." : "تحديث الخطة"}
              </button>
            </div>
          </form>
        </div>

        {/* أكثر الكلمات تعثراً + سجل الأخطاء التاريخي (5 أعمدة) */}
        <div className="lg:col-span-5 space-y-5">
          <div
            className={`rounded-2xl p-5 border space-y-4 ${
              darkMode ? "bg-stone-900 border-stone-800" : "bg-white border-stone-200"
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Flame className="w-5 h-5 text-rose-600" />
                أكثر الكلمات التي تعثرتَ فيها
              </h3>
              {data.recent_mistakes.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearMistakes}
                  className="inline-flex items-center gap-1 text-xs text-rose-600 hover:underline font-semibold"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  تصفير السجل
                </button>
              )}
            </div>

            {data.weak_words.length === 0 ? (
              <p className="text-xs opacity-70 py-4 text-center">
                لم تُسجّل أي أخطاء محفوظة بعد؛ جرّب التسميع وحفظ الجلسة في تبويب المصحف لتظهر نقاط الضعف وخريطتها الحرارية هنا.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.weak_words.map((ww) => (
                  <button
                    key={ww.word_id}
                    type="button"
                    onClick={() => onJumpToWord(ww.page_number, ww.word_id)}
                    className="px-3 py-2 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-right transition"
                  >
                    <div className="font-quran text-2xl font-bold text-rose-800 dark:text-rose-300">
                      {ww.text_uthmani}
                    </div>
                    <div className="text-[11px] opacity-80">
                      {ww.surah_name}:{ww.ayah_number} • {ww.error_count}× أخطاء
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            className={`rounded-2xl p-5 border space-y-3 ${
              darkMode ? "bg-stone-900 border-stone-800" : "bg-white border-stone-200"
            }`}
          >
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              سجل الأخطاء والملاحظات التجويدية التفصيلي
            </h3>
            <div className="space-y-2 max-h-[360px] overflow-y-auto text-xs pr-1">
              {data.recent_mistakes.length === 0 ? (
                <p className="opacity-65 py-4 text-center">السجل نظيف حالياً.</p>
              ) : (
                data.recent_mistakes.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => onJumpToWord(m.page_number, m.word_id)}
                    className="rounded-xl p-3 border border-stone-200 dark:border-stone-800 cursor-pointer hover:border-rose-500/40 transition"
                  >
                    <div className="flex items-center justify-between font-bold">
                      <span className="text-rose-700 dark:text-rose-400">
                        {m.mistake_type === "SKIPPED"
                          ? "تخطي كلمة"
                          : m.mistake_type === "SUBSTITUTED"
                          ? "إبدال كلمة"
                          : "ملاحظة تجويدية"}
                      </span>
                      <span className="opacity-70">
                        سورة {m.surah_name} • آية {toArabicDigits(m.ayah_number)}
                      </span>
                    </div>
                    <p className="mt-1 opacity-85">{m.details}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
