import React, { useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Moon,
  Search,
  Sparkles,
  Sun,
} from "lucide-react";
import type { SurahMeta } from "../../../packages/shared/src/types";
import { MushafWorkspace } from "./components/MushafWorkspace";
import { PlannerAndAnalyticsView } from "./components/PlannerAndAnalyticsView";
import { SearchAndMutashabihatView } from "./components/SearchAndMutashabihatView";
import { TajweedLabView } from "./components/TajweedLabView";
import { safeFetchJson } from "./lib/apiConfig";

type ActiveTab = "MUSHAF" | "TAJWEED_LAB" | "SEARCH_MUTASHABIHAT" | "PLANNER";

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("MUSHAF");
  const [darkMode, setDarkMode] = useState(false);
  const [surahs, setSurahs] = useState<SurahMeta[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [targetCursorWordId, setTargetCursorWordId] = useState<number | null>(null);
  const [refreshAnalytics, setRefreshAnalytics] = useState(0);
  const [backendUnreachable, setBackendUnreachable] = useState(false);
  const [healthInfo, setHealthInfo] = useState<{
    ai_worker?: {
      connected: boolean;
      mode: string;
      worker_url: string;
      note?: string;
    };
  } | null>(null);

  useEffect(() => {
    safeFetchJson<SurahMeta[]>("/api/surahs").then((list) => {
      if (Array.isArray(list)) {
        setSurahs(list);
        setBackendUnreachable(false);
      } else {
        setBackendUnreachable(true);
      }
    });

    safeFetchJson<any>("/api/health").then((h) => {
      if (h && h.status === "ok") {
        setHealthInfo(h);
      }
    });
  }, []);

  const handleJumpToWord = (page: number, wordId: number) => {
    setTargetCursorWordId(wordId);
    setCurrentPage(page);
    setActiveTab("MUSHAF");
  };

  const handleJumpToPage = (page: number) => {
    setCurrentPage(page);
    setActiveTab("MUSHAF");
  };

  return (
    <div
      className={`min-h-screen transition-colors ${
        darkMode ? "dark bg-stone-950 text-stone-100" : "bg-[#f6f3ec] text-stone-900"
      }`}
    >
      {/* شريط التنقل الرئيسي العلوي */}
      <header
        className={`sticky top-0 z-30 border-b backdrop-blur-md transition-colors ${
          darkMode
            ? "bg-stone-900/90 border-stone-800"
            : "bg-white/90 border-stone-200/80"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* الهوية البصرية */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-700 to-emerald-900 text-amber-200 flex items-center justify-center font-quran text-2xl font-bold shadow-sm">
              إ
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold tracking-tight flex items-center gap-2">
                <span>منصة إتقان القرآنية</span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-800 dark:text-emerald-300">
                  ذكاء اصطناعي مستضاف ذاتياً
                </span>
              </h1>
              <p className="text-[11px] opacity-70">
                التسميع الغيبي اللحظي • كشف الأخطاء والمتشابهات • مختبر التجويد (QPS) • مراجعة FSRS
              </p>
            </div>
          </div>

          {/* التبويبات الأربع المتكاملة */}
          <nav className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab("MUSHAF")}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition ${
                activeTab === "MUSHAF"
                  ? "bg-emerald-700 text-white shadow-sm"
                  : "hover:bg-stone-200/60 dark:hover:bg-stone-800"
              }`}
            >
              <BookOpen className="w-4 h-4" />
              المصحف والتسميع
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("TAJWEED_LAB")}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition ${
                activeTab === "TAJWEED_LAB"
                  ? "bg-emerald-700 text-white shadow-sm"
                  : "hover:bg-stone-200/60 dark:hover:bg-stone-800"
              }`}
            >
              <Sparkles className="w-4 h-4" />
              مختبر التجويد (QPS)
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("SEARCH_MUTASHABIHAT")}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition ${
                activeTab === "SEARCH_MUTASHABIHAT"
                  ? "bg-emerald-700 text-white shadow-sm"
                  : "hover:bg-stone-200/60 dark:hover:bg-stone-800"
              }`}
            >
              <Search className="w-4 h-4" />
              البحث والمتشابهات
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("PLANNER")}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition ${
                activeTab === "PLANNER"
                  ? "bg-emerald-700 text-white shadow-sm"
                  : "hover:bg-stone-200/60 dark:hover:bg-stone-800"
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              خطة الحفظ والأخطاء
            </button>

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              title={darkMode ? "الوضع النهاري" : "الوضع الليلي"}
              className="p-2 rounded-xl border border-stone-300 dark:border-stone-700 hover:bg-stone-200/60 dark:hover:bg-stone-800 mr-1"
            >
              {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>
          </nav>
        </div>
      </header>

      {/* محتوى مساحة العمل النشطة */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {backendUnreachable && (
          <div className="rounded-2xl p-4 border border-amber-400 bg-amber-50 text-amber-950 dark:bg-amber-950/60 dark:border-amber-700 dark:text-amber-200 text-xs sm:text-sm leading-relaxed">
            <strong>تنبيه استضافة:</strong> تم تحميل الواجهة الأمامية بنجاح، لكنها غير متصلة حالياً بخادم الخلفية (FastAPI + WebSocket + قاعدة بيانات المصحف). إذا كنت تستضيف الواجهة على <code>Vercel</code>، يرجى رفع الخادم الخلفي على منصة تدعم الخوادم الدائمة وWebSockets (مثل <code>Render</code> أو <code>Railway</code> أو <code>Hugging Face Spaces</code>) ثم إضافة رابطه في إعدادات Vercel باسم <code>VITE_API_BASE_URL</code>.
          </div>
        )}

        {activeTab === "MUSHAF" && (
          <MushafWorkspace
            surahs={surahs}
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            targetCursorWordId={targetCursorWordId}
            clearTargetCursorWordId={() => setTargetCursorWordId(null)}
            darkMode={darkMode}
            gpuWorkerConnected={Boolean(healthInfo?.ai_worker?.connected)}
            onSessionSaved={() => setRefreshAnalytics((n) => n + 1)}
          />
        )}

        {activeTab === "TAJWEED_LAB" && (
          <TajweedLabView
            currentPage={currentPage}
            darkMode={darkMode}
            gpuWorkerStatus={healthInfo?.ai_worker || null}
            onJumpToWord={handleJumpToWord}
          />
        )}

        {activeTab === "SEARCH_MUTASHABIHAT" && (
          <SearchAndMutashabihatView
            currentPage={currentPage}
            darkMode={darkMode}
            onJumpToWord={handleJumpToWord}
            onJumpToPage={handleJumpToPage}
          />
        )}

        {activeTab === "PLANNER" && (
          <PlannerAndAnalyticsView
            darkMode={darkMode}
            refreshTrigger={refreshAnalytics}
            onJumpToWord={handleJumpToWord}
            onJumpToPage={handleJumpToPage}
          />
        )}
      </main>
    </div>
  );
}
