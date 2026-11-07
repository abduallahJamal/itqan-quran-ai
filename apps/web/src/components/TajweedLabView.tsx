import React, { useEffect, useMemo, useState } from "react";
import { Cpu, Filter, Layers, Play, Server, Sparkles } from "lucide-react";
import type { QuranAyah, QuranWord } from "../../../../packages/shared/src/types";
import { toArabicDigits } from "../lib/audioAlerts";
import { safeFetchJson } from "../lib/apiConfig";

interface Props {
  currentPage: number;
  darkMode: boolean;
  gpuWorkerStatus: {
    connected: boolean;
    mode: string;
    worker_url: string;
    note?: string;
  } | null;
  onJumpToWord: (page: number, wordId: number) => void;
}

export function TajweedLabView({
  currentPage,
  darkMode,
  gpuWorkerStatus,
  onJumpToWord,
}: Props) {
  const [ayahs, setAyahs] = useState<QuranAyah[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>("ALL");
  const [playingAyah, setPlayingAyah] = useState<number | null>(null);

  useEffect(() => {
    safeFetchJson<{ ayahs?: QuranAyah[] }>(`/api/mushaf/page/${currentPage}`).then(
      (d) => setAyahs(Array.isArray(d?.ayahs) ? d!.ayahs! : [])
    );
  }, [currentPage]);

  const annotatedWords = useMemo(() => {
    const out: Array<QuranWord & { surah_name: string }> = [];
    for (const a of ayahs) {
      for (const w of a.words) {
        if (w.tajweed_rules && w.tajweed_rules.length > 0) {
          out.push({ ...w, surah_name: a.surah_name_ar });
        }
      }
    }
    return out;
  }, [ayahs]);

  const ruleStats = useMemo(() => {
    const counts: Record<string, { name_ar: string; color: string; count: number }> = {};
    for (const w of annotatedWords) {
      for (const r of w.tajweed_rules) {
        if (!counts[r.code]) {
          counts[r.code] = { name_ar: r.name_ar, color: r.color, count: 0 };
        }
        counts[r.code].count += 1;
      }
    }
    return counts;
  }, [annotatedWords]);

  const filteredWords = useMemo(() => {
    if (activeFilter === "ALL") return annotatedWords;
    return annotatedWords.filter((w) =>
      w.tajweed_rules.some((r) => r.code === activeFilter)
    );
  }, [activeFilter, annotatedWords]);

  const playReferenceAudio = (ayahGlobalId: number) => {
    setPlayingAyah(ayahGlobalId);
    const audio = new Audio(
      `https://cdn.islamic.network/quran/audio/128/ar.husary/${ayahGlobalId}.mp3`
    );
    audio.onended = () => setPlayingAyah(null);
    audio.play().catch(() => setPlayingAyah(null));
  };

  return (
    <div className="space-y-6">
      {/* بطاقة البنية التحتية لمحرك الذكاء الاصطناعي المستضاف ذاتياً */}
      <div
        className={`rounded-2xl p-6 border grid grid-cols-1 lg:grid-cols-12 gap-5 items-center ${
          darkMode
            ? "bg-stone-900 border-stone-800 text-stone-100"
            : "bg-white border-stone-200 text-stone-900"
        }`}
      >
        <div className="lg:col-span-7 space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-800 dark:text-emerald-300">
            <Cpu className="w-3.5 h-3.5" />
            معمارية التجويد والخط الصوتي القرآني (Multi-Level CTC + QPS)
          </div>
          <h2 className="text-xl font-bold">
            مختبر تحليل أحكام التجويد ومخارج الحروف — الصفحة {toArabicDigits(currentPage)}
          </h2>
          <p className="text-sm opacity-80 leading-relaxed">
            يستخرج هذا المختبر جميع الأحكام التجويدية القياسية في الصفحة الحالية ويبني لكل كلمة توصيفها الصوتي المرجعي{" "}
            <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-stone-200/70 dark:bg-stone-800">
              QPS[...]
            </code>{" "}
            الذي يقارن به خادم الذكاء الاصطناعي أزمنة المدود (٢ / ٤-٥ / ٦ حركات) والغنّة والقلقلة والإخفاء.
          </p>
        </div>

        <div
          className={`lg:col-span-5 rounded-2xl p-4 border text-xs space-y-2 ${
            darkMode
              ? "bg-stone-950/60 border-stone-800"
              : "bg-stone-50 border-stone-200/80"
          }`}
        >
          <div className="flex items-center justify-between font-bold">
            <span className="inline-flex items-center gap-1.5">
              <Server className="w-4 h-4 text-emerald-600" />
              حالة حاوية GPU المستضافة ذاتياً
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] ${
                gpuWorkerStatus?.connected
                  ? "bg-emerald-600 text-white"
                  : "bg-amber-500/20 text-amber-800 dark:text-amber-300"
              }`}
            >
              {gpuWorkerStatus?.connected ? "متصل (CUDA GPU)" : "وضع المعاينة المدمج"}
            </span>
          </div>
          <p className="opacity-75 leading-relaxed">
            لربط نماذج <span className="font-mono">whisper-quran-v1</span> و{" "}
            <span className="font-mono">muaalem_tajweed_int8.onnx</span> على خادمك الخاص ببطاقة GPU، شغّل:
          </p>
          <pre className="p-2.5 rounded-xl bg-stone-900 text-emerald-300 font-mono text-[11px] overflow-x-auto dir-ltr text-left">
            docker compose -f docker-compose.gpu.yml up -d
          </pre>
        </div>
      </div>

      {/* شريط تصفية الأحكام المستخرجة في الصفحة */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2">
          <Filter className="w-4 h-4 text-emerald-600" />
          تصفية حسب الحكم التجويدي ({annotatedWords.length} موضع في الصفحة):
        </span>
        <button
          type="button"
          onClick={() => setActiveFilter("ALL")}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
            activeFilter === "ALL"
              ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
              : "border-stone-300 dark:border-stone-700"
          }`}
        >
          جميع الأحكام ({annotatedWords.length})
        </button>

        {Object.entries(ruleStats).map(([code, meta]) => (
          <button
            key={code}
            type="button"
            onClick={() => setActiveFilter(code)}
            style={
              activeFilter === code
                ? { backgroundColor: meta.color, borderColor: meta.color, color: "#fff" }
                : undefined
            }
            className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-stone-300 dark:border-stone-700 transition"
          >
            {meta.name_ar} ({meta.count})
          </button>
        ))}
      </div>

      {/* شبكة بطاقات الكلمات والأحكام التجويدية */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredWords.map((w) => (
          <div
            key={w.id}
            className={`rounded-2xl p-4 border flex flex-col justify-between space-y-3 transition hover:shadow-md ${
              darkMode
                ? "bg-stone-900 border-stone-800 text-stone-100"
                : "bg-white border-stone-200 text-stone-900"
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs opacity-70">
                <span>
                  سورة {w.surah_name} • آية {toArabicDigits(w.ayah_number)}
                </span>
                <span className="font-mono text-[10px]">{w.qps_reference}</span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-stone-200/70 dark:border-stone-800">
                <span
                  className="font-quran text-3xl font-bold"
                  style={{ color: w.tajweed_rules[0]?.color }}
                >
                  {w.text_uthmani}
                </span>
                <button
                  type="button"
                  onClick={() => playReferenceAudio(w.ayah_id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-500/20"
                >
                  <Play className="w-3 h-3" />
                  {playingAyah === w.ayah_id ? "يتلو الآن..." : "نطق الحصري"}
                </button>
              </div>

              <div className="space-y-2 pt-1">
                {w.tajweed_rules.map((r) => (
                  <div
                    key={r.code}
                    className="rounded-xl p-2.5 text-xs bg-stone-50 dark:bg-stone-800/70 border-r-4"
                    style={{ borderRightColor: r.color }}
                  >
                    <div className="flex items-center justify-between font-bold">
                      <span>{r.name_ar}</span>
                      <span className="text-[11px] opacity-80">{r.harakat}</span>
                    </div>
                    <p className="opacity-80 mt-1 leading-relaxed">{r.guide}</p>
                  </div>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onJumpToWord(w.page_number, w.id)}
              className="w-full py-2 rounded-xl text-xs font-bold border border-emerald-600/30 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-500/10 flex items-center justify-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              تدرّب على هذه الكلمة في المصحف
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
