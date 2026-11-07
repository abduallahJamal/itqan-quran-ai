import React, { useEffect, useState } from "react";
import { ArrowLeft, GitCompare, Mic, Search } from "lucide-react";
import { toArabicDigits } from "../lib/audioAlerts";
import { safeFetchJson } from "../lib/apiConfig";

interface SearchResult {
  ayah_id: number;
  surah_number: number;
  surah_name: string;
  ayah_number: number;
  page_number: number;
  juz_number: number;
  text_uthmani: string;
  match_score: number;
  matched_start_word_id: number;
}

interface MutashabihatLink {
  source_ayah_id: number;
  target_ayah_id: number;
  shared_phrase: string;
  similarity_score: number;
  src_surah: number;
  src_surah_name: string;
  src_ayah: number;
  src_text: string;
  tgt_surah: number;
  tgt_surah_name: string;
  tgt_ayah: number;
  tgt_page: number;
  tgt_text: string;
}

interface Props {
  currentPage: number;
  darkMode: boolean;
  onJumpToWord: (page: number, wordId: number) => void;
  onJumpToPage: (page: number) => void;
}

const QUICK_EXAMPLES = [
  "الله لا إله إلا هو الحي القيوم",
  "ولقد يسرنا القرآن للذكر فهل من مدكر",
  "إن مع العسر يسرا",
  "قل هو الله أحد",
  "نور على نور",
];

export function SearchAndMutashabihatView({
  currentPage,
  darkMode,
  onJumpToWord,
  onJumpToPage,
}: Props) {
  const [query, setQuery] = useState("ولقد يسرنا القرآن للذكر");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [pageMutashabihat, setPageMutashabihat] = useState<MutashabihatLink[]>([]);

  const runSearch = async (qText: string) => {
    if (qText.trim().length < 2) return;
    setSearching(true);
    try {
      const d = await safeFetchJson<{ results?: SearchResult[] }>(
        `/api/search?q=${encodeURIComponent(qText.trim())}&limit=14`
      );
      setResults(Array.isArray(d?.results) ? d!.results! : []);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    runSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    safeFetchJson<MutashabihatLink[]>(`/api/mutashabihat/page/${currentPage}`).then(
      (rows) => setPageMutashabihat(Array.isArray(rows) ? rows : [])
    );
  }, [currentPage]);

  const startVoiceSearch = () => {
    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return;
    const rec = new SpeechRec();
    rec.lang = "ar-SA";
    rec.interimResults = false;
    setVoiceListening(true);
    rec.onresult = (e: any) => {
      const spk = e.results[0]?.[0]?.transcript || "";
      if (spk) {
        setQuery(spk);
        runSearch(spk);
      }
      setVoiceListening(false);
    };
    rec.onerror = () => setVoiceListening(false);
    rec.onend = () => setVoiceListening(false);
    rec.start();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* القسم الأيمن: محرك البحث القرآني الذكي والبحث بالصوت (7 أعمدة) */}
      <div className="lg:col-span-7 space-y-4">
        <div
          className={`rounded-2xl p-5 border space-y-4 ${
            darkMode
              ? "bg-stone-900 border-stone-800 text-stone-100"
              : "bg-white border-stone-200 text-stone-900"
          }`}
        >
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Search className="w-5 h-5 text-emerald-600" />
              البحث القرآني الصوتي والنصي الفوري (6,236 آية)
            </h2>
            <p className="text-xs opacity-75 mt-1">
              يدعم البحث بدون تشكيل، وتوحيد الهمزات والرسم العثماني، والتسامح مع التقارب الصوتي وكشف المتشابهات.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(query);
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="اتلُ أو اكتب جزءاً من أي آية..."
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm border focus:outline-none focus:ring-2 focus:ring-emerald-600 ${
                darkMode
                  ? "bg-stone-800 border-stone-700 text-stone-100"
                  : "bg-stone-50 border-stone-200 text-stone-900"
              }`}
            />
            <button
              type="button"
              onClick={startVoiceSearch}
              title="البحث بالصوت"
              className={`px-3.5 py-2.5 rounded-xl border transition ${
                voiceListening
                  ? "bg-rose-600 text-white border-rose-600 animate-pulse"
                  : "border-stone-300 dark:border-stone-700 hover:bg-emerald-50 dark:hover:bg-stone-800"
              }`}
            >
              <Mic className="w-4 h-4" />
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold"
            >
              بحث
            </button>
          </form>

          <div className="flex flex-wrap gap-1.5 text-xs">
            {QUICK_EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setQuery(ex);
                  runSearch(ex);
                }}
                className="px-2.5 py-1 rounded-lg bg-stone-100 dark:bg-stone-800 hover:bg-emerald-500/15 transition"
              >
                «{ex}»
              </button>
            ))}
          </div>
        </div>

        {/* نتائج البحث */}
        <div className="space-y-3">
          {searching ? (
            <div className="p-8 text-center text-sm opacity-70">جاري البحث في الفهرس العكسي...</div>
          ) : (
            results.map((r) => (
              <div
                key={r.ayah_id}
                className={`rounded-2xl p-4 border space-y-2.5 transition hover:border-emerald-600/50 ${
                  darkMode
                    ? "bg-stone-900 border-stone-800 text-stone-100"
                    : "bg-white border-stone-200 text-stone-900"
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">
                    سورة {r.surah_name} • الآية {toArabicDigits(r.ayah_number)} (صفحة{" "}
                    {toArabicDigits(r.page_number)} • الجزء {toArabicDigits(r.juz_number)})
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 font-semibold">
                    تطابق {Math.round(r.match_score * 100)}%
                  </span>
                </div>
                <p className="font-quran text-2xl leading-[2.1]">{r.text_uthmani}</p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => onJumpToWord(r.page_number, r.matched_start_word_id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-700 text-white hover:bg-emerald-800"
                  >
                    انتقل وابدأ التسميع من هنا
                    <ArrowLeft className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* القسم الأيسر: كاشف المتشابهات اللفظية للصفحة المفتوحة (5 أعمدة) */}
      <div className="lg:col-span-5 space-y-4">
        <div
          className={`rounded-2xl p-5 border space-y-4 ${
            darkMode
              ? "bg-stone-900 border-stone-800 text-stone-100"
              : "bg-white border-stone-200 text-stone-900"
          }`}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold flex items-center gap-2">
              <GitCompare className="w-5 h-5 text-amber-600" />
              متشابهات الصفحة الحالية (صفحة {toArabicDigits(currentPage)})
            </h3>
            <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300 font-bold">
              {pageMutashabihat.length} رابط
            </span>
          </div>
          <p className="text-xs opacity-75 leading-relaxed">
            يرصد المحرك الآيات التي تشترك في مطالعها أو تراكيبها اللفظية مع سور أخرى لمنع التباس السور على الحافظ أثناء التسميع الغيبي:
          </p>

          {pageMutashabihat.length === 0 ? (
            <div className="rounded-xl p-6 text-center text-xs bg-stone-50 dark:bg-stone-800/60 opacity-75">
              لا توجد متشابهات لفظية مطابقة في الصفحة {toArabicDigits(currentPage)}؛ جرّب الانتقال إلى صفحة ٢ (البقرة) أو صفحة ٥٢٩ (القمر) أو ٥٣١ (الرحمن) لرؤية روابط المتشابهات الكثيفة.
              <div className="mt-3 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => onJumpToPage(2)}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-900 dark:text-amber-200 font-bold"
                >
                  معاينة صفحة ٢ (البقرة)
                </button>
                <button
                  type="button"
                  onClick={() => onJumpToPage(529)}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-900 dark:text-amber-200 font-bold"
                >
                  معاينة صفحة ٥٢٩ (القمر)
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">
              {pageMutashabihat.map((m, idx) => (
                <div
                  key={idx}
                  className="rounded-xl p-3.5 border border-amber-600/25 bg-amber-500/5 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between font-bold text-amber-900 dark:text-amber-300">
                    <span>
                      {m.src_surah_name} ({toArabicDigits(m.src_ayah)}) ⇄ {m.tgt_surah_name} (
                      {toArabicDigits(m.tgt_ayah)})
                    </span>
                    <span>تشابه {Math.round(m.similarity_score * 100)}%</span>
                  </div>
                  <div className="font-quran text-xl leading-relaxed opacity-90 border-b border-amber-600/15 pb-1.5">
                    • {m.src_text}
                  </div>
                  <div className="font-quran text-xl leading-relaxed text-emerald-900 dark:text-emerald-300">
                    • {m.tgt_text}
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="opacity-70">المشترك: «{m.shared_phrase}»</span>
                    <button
                      type="button"
                      onClick={() => onJumpToPage(m.tgt_page)}
                      className="text-emerald-700 dark:text-emerald-400 font-bold hover:underline"
                    >
                      افتح صفحة {toArabicDigits(m.tgt_page)} ←
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
