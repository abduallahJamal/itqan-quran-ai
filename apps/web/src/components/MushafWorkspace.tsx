import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Flame,
  Mic,
  MicOff,
  Palette,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Volume2,
  Wand2,
} from "lucide-react";
import type {
  HideMode,
  QuranAyah,
  QuranWord,
  RecitationEvent,
  SurahMeta,
} from "../../../../packages/shared/src/types";
import {
  playMistakeAlertTone,
  startMicrophoneCapture,
  toArabicDigits,
  type MicMeterHandle,
} from "../lib/audioAlerts";
import { safeFetchJson, wsUrl } from "../lib/apiConfig";

interface PagePayload {
  page_number: number;
  juz_number: number;
  primary_surah: SurahMeta | null;
  surahs_on_page: SurahMeta[];
  first_word_id: number;
  last_word_id: number;
  word_count: number;
  ayahs: QuranAyah[];
  heatmap: Record<string, { count: number; types: string[] }>;
}

interface Props {
  surahs: SurahMeta[];
  currentPage: number;
  setCurrentPage: (page: number) => void;
  targetCursorWordId: number | null;
  clearTargetCursorWordId: () => void;
  darkMode: boolean;
  gpuWorkerConnected: boolean;
  onSessionSaved: () => void;
}

const QARIS = [
  { id: "ar.husary", name: "محمود خليل الحصري (مرتل واضح)" },
  { id: "ar.alafasy", name: "مشاري راشد العفاسي" },
  { id: "ar.minshawi", name: "محمد صديق المنشاوي" },
  { id: "ar.abdulbasitmurattal", name: "عبد الباسط عبد الصمد" },
];

export function MushafWorkspace({
  surahs,
  currentPage,
  setCurrentPage,
  targetCursorWordId,
  clearTargetCursorWordId,
  darkMode,
  gpuWorkerConnected,
  onSessionSaved,
}: Props) {
  const [pageData, setPageData] = useState<PagePayload | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);

  // خيارات عرض المصحف والتسميع
  const [layoutMode, setLayoutMode] = useState<"MUSHAF_FLOW" | "AYAH_CARDS">("MUSHAF_FLOW");
  const [hideMode, setHideMode] = useState<HideMode>("NONE");
  const [showTajweedColors, setShowTajweedColors] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [peekWordId, setPeekWordId] = useState<number | null>(null);
  const [selectedWord, setSelectedWord] = useState<QuranWord | null>(null);

  // حالة جلسة التسميع اللحظية عبر WebSocket
  const wsRef = useRef<WebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [cursorWordId, setCursorWordId] = useState<number>(1);
  const [revealedIds, setRevealedIds] = useState<Set<number>>(new Set());
  const [mistakeMap, setMistakeMap] = useState<Record<number, "SKIPPED" | "SUBSTITUTED">>({});
  const [tajweedWarnSet, setTajweedWarnSet] = useState<Set<number>>(new Set());
  const [wordsRecited, setWordsRecited] = useState(0);
  const [accuracyScore, setAccuracyScore] = useState(100);
  const [tajweedScore, setTajweedScore] = useState(100);
  const [liveEvents, setLiveEvents] = useState<RecitationEvent[]>([]);
  const [autoLocateVoice, setAutoLocateVoice] = useState(false);

  // الميكروفون والتعرف الصوتي
  const [micActive, setMicActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [interimSpeech, setInterimSpeech] = useState("");
  const [micWarning, setMicWarning] = useState<string | null>(null);
  const micHandleRef = useRef<MicMeterHandle | null>(null);
  const speechRecRef = useRef<any>(null);
  const utteranceCounterRef = useRef(1);

  // المحاكاة النصية والتدفق الآلي للاختبار
  const [manualInput, setManualInput] = useState("");
  const [autoSimRunning, setAutoSimRunning] = useState(false);
  const autoSimTimerRef = useRef<number | null>(null);

  // مشغل القارئ المعلم والتكرار
  const [selectedQari, setSelectedQari] = useState(QARIS[0].id);
  const [repeatPerAyah, setRepeatPerAyah] = useState<number>(1);
  const [playingAyahId, setPlayingAyahId] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const repeatCounterRef = useRef<number>(0);

  // استرجاع بيانات الصفحة من الخادم
  const fetchPage = useCallback(async (pNum: number) => {
    setLoadingPage(true);
    try {
      const data = await safeFetchJson<PagePayload>(`/api/mushaf/page/${pNum}`);
      if (data && Array.isArray(data.ayahs)) {
        setPageData(data);
        return data;
      }
      return null;
    } finally {
      setLoadingPage(false);
    }
  }, []);

  useEffect(() => {
    fetchPage(currentPage).then((data) => {
      if (!data) return;
      if (targetCursorWordId !== null) {
        setCursorWordId(targetCursorWordId);
        sendWs({ action: "set_cursor", word_id: targetCursorWordId, auto_locate: false });
        clearTargetCursorWordId();
      } else if (
        cursorWordId < data.first_word_id ||
        cursorWordId > data.last_word_id
      ) {
        setCursorWordId(data.first_word_id);
        sendWs({ action: "set_cursor", word_id: data.first_word_id, auto_locate: autoLocateVoice });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  // قائمة مسطحة بجميع كلمات الصفحة الحالية للوصول السريع
  const pageWords = useMemo(() => {
    if (!pageData) return [];
    const list: QuranWord[] = [];
    for (const a of pageData.ayahs) {
      for (const w of a.words) list.push(w);
    }
    return list;
  }, [pageData]);

  const wordById = useMemo(() => {
    const map = new Map<number, QuranWord>();
    for (const w of pageWords) map.set(w.id, w);
    return map;
  }, [pageWords]);

  // إنشاء اتصال WebSocket دائم مع الخادم المركزي
  const sendWs = useCallback((payload: Record<string, any>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  useEffect(() => {
    const ws = new WebSocket(wsUrl("/ws/recitation"));
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      ws.send(
        JSON.stringify({
          action: "init",
          mode: "MEMORIZATION",
          start_word_id: cursorWordId,
          auto_locate: autoLocateVoice,
        })
      );
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);

      if (msg.type === "session_ready" || msg.type === "cursor_updated") {
        setCursorWordId(msg.cursor_word_id);
        return;
      }

      if (msg.type === "session_saved") {
        onSessionSaved();
        fetchPage(currentPage);
        return;
      }

      if (msg.type === "alignment_update") {
        if (typeof msg.cursor_word_id === "number") {
          setCursorWordId(msg.cursor_word_id);
        }
        if (typeof msg.cursor_page === "number" && msg.cursor_page !== currentPage) {
          setCurrentPage(msg.cursor_page);
        }
        if (typeof msg.words_recited === "number") setWordsRecited(msg.words_recited);
        if (typeof msg.accuracy_score === "number") setAccuracyScore(msg.accuracy_score);
        if (typeof msg.tajweed_score === "number") setTajweedScore(msg.tajweed_score);

        if (Array.isArray(msg.revealed_word_ids)) {
          setRevealedIds((prev) => {
            const next = new Set(prev);
            for (const id of msg.revealed_word_ids) next.add(id);
            return next;
          });
        }

        if (Array.isArray(msg.events) && msg.events.length > 0) {
          const incoming: RecitationEvent[] = msg.events;
          setLiveEvents((prev) => [...incoming.slice().reverse(), ...prev].slice(0, 30));

          for (const ev of incoming) {
            if (ev.event === "WORD_MATCHED" && ev.word_id) {
              // إذا صحّح القارئ كلمة كانت مخطئة سابقاً نزيل عنها اللون الأحمر
              setMistakeMap((prev) => {
                if (!prev[ev.word_id!]) return prev;
                const copy = { ...prev };
                delete copy[ev.word_id!];
                return copy;
              });
            } else if (ev.event === "MISTAKE_DETECTED" && ev.word_id && ev.mistake_type) {
              playMistakeAlertTone("mistake");
              setMistakeMap((prev) => ({
                ...prev,
                [ev.word_id!]: ev.mistake_type!,
              }));
            } else if (ev.event === "TAJWEED_NOTE" && ev.word_id) {
              playMistakeAlertTone("tajweed");
              setTajweedWarnSet((prev) => new Set(prev).add(ev.word_id!));
            } else if (ev.event === "VERSE_LOCATED") {
              playMistakeAlertTone("located");
              if (ev.page_number && ev.page_number !== currentPage) {
                setCurrentPage(ev.page_number);
              }
            }
          }
        }
      }
    };

    return () => {
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // تشغيل / إيقاف الميكروفون الحقيقي وبث الكلمات العربية لحظياً
  const stopLiveMic = useCallback(() => {
    setMicActive(false);
    setInterimSpeech("");
    micHandleRef.current?.stop();
    micHandleRef.current = null;
    if (speechRecRef.current) {
      try {
        speechRecRef.current.onend = null;
        speechRecRef.current.stop();
      } catch {
        // ignore
      }
      speechRecRef.current = null;
    }
  }, []);

  const startLiveMic = useCallback(async () => {
    setMicWarning(null);
    try {
      const handle = await startMicrophoneCapture(
        (lvl) => setMicLevel(lvl),
        gpuWorkerConnected
          ? (pcmBuf) => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(pcmBuf);
              }
            }
          : undefined
      );
      micHandleRef.current = handle;
      setMicActive(true);

      // تشغيل التعرف الصوتي العربي المتدفق في المتصفح (يعمل فوراً بدون GPU خارجي)
      const SpeechRec =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (!SpeechRec && !gpuWorkerConnected) {
        setMicWarning(
          "متصفحك الحالي لا يدعم واجهة Web Speech المباشرة؛ يرجى فتح المعاينة في Chrome أو Edge للتسميع الصوتي الحي، أو استخدام أزرار المحاكاة والإملاء الفوري أدناه."
        );
        return;
      }

      if (SpeechRec && !gpuWorkerConnected) {
        const rec = new SpeechRec();
        rec.lang = "ar-SA";
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;

        rec.onresult = (event: any) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i];
            const transcript = res[0]?.transcript?.trim() || "";
            if (!transcript) continue;
            setInterimSpeech(transcript);
            const uttId = `utt-${utteranceCounterRef.current}-${i}`;
            sendWs({
              action: "stream_transcript",
              utterance_id: uttId,
              text: transcript,
              is_final: res.isFinal,
            });
          }
        };

        rec.onerror = (err: any) => {
          if (err?.error === "not-allowed") {
            setMicWarning("لم يتم منح صلاحية الميكروفون في المتصفح.");
            stopLiveMic();
          }
        };

        rec.onend = () => {
          // إعادة التشغيل التلقائي طالما الجلسة الصوتية نشطة
          if (micHandleRef.current) {
            utteranceCounterRef.current += 1;
            try {
              rec.start();
            } catch {
              // ignore
            }
          }
        };

        speechRecRef.current = rec;
        rec.start();
      }
    } catch {
      setMicWarning(
        "تعذر الوصول إلى الميكروفون (قد يمنع إطار المعاينة صلاحية الميكروفون حتى تفتح الرابط في علامة تبويب مستقلة، أو استخدم مختبر المحاكاة المباشر بالأسفل)."
      );
      setMicActive(false);
    }
  }, [gpuWorkerConnected, sendWs, stopLiveMic]);

  useEffect(() => {
    return () => {
      stopLiveMic();
      if (autoSimTimerRef.current) window.clearInterval(autoSimTimerRef.current);
      audioRef.current?.pause();
    };
  }, [stopLiveMic]);

  // النقر على أي كلمة في المصحف لتعيين المؤشر وعرض تفاصيلها
  const handleWordClick = (w: QuranWord) => {
    setSelectedWord(w);
    setCursorWordId(w.id);
    sendWs({ action: "set_cursor", word_id: w.id, auto_locate: false });
  };

  // زر التلميح السريع (Peek) عند التوقف في وضع الإخفاء
  const triggerPeek = () => {
    setPeekWordId(cursorWordId);
    window.setTimeout(() => {
      setPeekWordId((cur) => (cur === cursorWordId ? null : cur));
    }, 2400);
  };

  // إعادة ضبط الجلسة الحالية على الصفحة
  const resetPageSession = () => {
    if (!pageData) return;
    setRevealedIds(new Set());
    setMistakeMap({});
    setTajweedWarnSet(new Set());
    setWordsRecited(0);
    setAccuracyScore(100);
    setTajweedScore(100);
    setLiveEvents([]);
    setCursorWordId(pageData.first_word_id);
    sendWs({
      action: "init",
      mode: "MEMORIZATION",
      start_word_id: pageData.first_word_id,
      auto_locate: autoLocateVoice,
    });
  };

  const saveAndFinishSession = () => {
    stopLiveMic();
    if (autoSimTimerRef.current) {
      window.clearInterval(autoSimTimerRef.current);
      autoSimTimerRef.current = null;
      setAutoSimRunning(false);
    }
    sendWs({ action: "end_session" });
  };

  // ===========================================================================
  // أدوات المحاكاة التفاعلية لاختبار محرك المطابقة والتجويد بضغطة زر
  // ===========================================================================
  const toggleSmoothAyahSimulation = () => {
    if (autoSimRunning) {
      if (autoSimTimerRef.current) window.clearInterval(autoSimTimerRef.current);
      autoSimTimerRef.current = null;
      setAutoSimRunning(false);
      return;
    }

    setAutoSimRunning(true);
    let localId = cursorWordId;
    autoSimTimerRef.current = window.setInterval(() => {
      const w = wordById.get(localId);
      if (!w) {
        if (autoSimTimerRef.current) window.clearInterval(autoSimTimerRef.current);
        autoSimTimerRef.current = null;
        setAutoSimRunning(false);
        return;
      }
      sendWs({ action: "simulate_tokens", tokens: [w.text_imlaei], duration_ratio: 1.0 });
      localId += 1;
    }, 440);
  };

  const simulateSkipWord = () => {
    const nextAfterSkip = wordById.get(cursorWordId + 1);
    if (!nextAfterSkip) return;
    sendWs({
      action: "simulate_tokens",
      tokens: [nextAfterSkip.text_imlaei],
    });
  };

  const simulateSubstitutionMistake = () => {
    sendWs({
      action: "simulate_tokens",
      tokens: ["الغفور"],
      forced_mistake_hint: "FORCE_SUBSTITUTION",
    });
  };

  const simulateBacktrack = () => {
    const prev1 = wordById.get(cursorWordId - 2);
    const prev2 = wordById.get(cursorWordId - 1);
    const cur = wordById.get(cursorWordId);
    const seq = [prev1, prev2, cur].filter(Boolean).map((w) => w!.text_imlaei);
    if (seq.length === 0) return;
    sendWs({ action: "simulate_tokens", tokens: seq });
  };

  const simulateTajweedShortMaddOrGhunnah = () => {
    // يبحث عن أقرب كلمة قادمة في الصفحة فيها مد أو غنة ويحاكي قصر زمنها الصوتي (0.45)
    let target = wordById.get(cursorWordId);
    if (target && target.tajweed_rules.length === 0) {
      for (let id = cursorWordId + 1; id <= cursorWordId + 12; id++) {
        const cand = wordById.get(id);
        if (cand && cand.tajweed_rules.some((r) => r.code.startsWith("MADD_") || r.code === "GHUNNAH" || r.code === "IKHFA")) {
          setCursorWordId(cand.id);
          sendWs({ action: "set_cursor", word_id: cand.id, auto_locate: false });
          target = cand;
          break;
        }
      }
    }
    if (!target) return;
    window.setTimeout(() => {
      sendWs({
        action: "simulate_tokens",
        tokens: [target!.text_imlaei],
        duration_ratio: 0.45,
      });
    }, 80);
  };

  const handleManualSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    sendWs({
      action: "simulate_tokens",
      tokens: manualInput.trim().split(/\s+/),
    });
    setManualInput("");
  };

  // ===========================================================================
  // مشغل القراء المزامن بالآيات مع التكرار للحفظ
  // ===========================================================================
  const playAyahAudio = useCallback(
    (ayahGlobalId: number) => {
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      const audio = audioRef.current;
      audio.pause();
      setPlayingAyahId(ayahGlobalId);
      repeatCounterRef.current = 1;

      audio.src = `https://cdn.islamic.network/quran/audio/128/${selectedQari}/${ayahGlobalId}.mp3`;
      audio.onended = () => {
        if (repeatCounterRef.current < repeatPerAyah) {
          repeatCounterRef.current += 1;
          audio.currentTime = 0;
          audio.play().catch(() => {});
          return;
        }
        // الانتقال التلقائي للآية التالية في نفس الصفحة
        if (pageData) {
          const idx = pageData.ayahs.findIndex((a) => a.id === ayahGlobalId);
          if (idx >= 0 && idx + 1 < pageData.ayahs.length) {
            playAyahAudio(pageData.ayahs[idx + 1].id);
            return;
          }
        }
        setPlayingAyahId(null);
      };
      audio.play().catch(() => {
        setPlayingAyahId(null);
      });
    },
    [pageData, repeatPerAyah, selectedQari]
  );

  const togglePageRecitationAudio = () => {
    if (playingAyahId !== null) {
      audioRef.current?.pause();
      setPlayingAyahId(null);
      return;
    }
    if (pageData && pageData.ayahs.length > 0) {
      // نبدأ من الآية التي يقع فيها المؤشر الحالي
      const curWord = wordById.get(cursorWordId);
      const startAyahId = curWord ? curWord.ayah_id : pageData.ayahs[0].id;
      playAyahAudio(startAyahId);
    }
  };

  // حساب عرض الكلمة في وضع الإخفاء للتسميع
  const renderWordContent = (w: QuranWord) => {
    const isRevealed =
      hideMode === "NONE" ||
      revealedIds.has(w.id) ||
      w.id < cursorWordId ||
      peekWordId === w.id ||
      Boolean(mistakeMap[w.id]);

    if (isRevealed) {
      return w.display_uthmani;
    }

    if (hideMode === "AYAH_HEADS" && w.word_position === 1) {
      return w.display_uthmani;
    }

    if (hideMode === "FIRST_LETTER") {
      const firstChar = w.text_uthmani.slice(0, 2);
      return `${firstChar}•••`;
    }

    return w.display_uthmani;
  };

  const isWordBlurred = (w: QuranWord) => {
    if (hideMode === "NONE") return false;
    if (revealedIds.has(w.id) || w.id < cursorWordId || peekWordId === w.id || mistakeMap[w.id]) {
      return false;
    }
    if (hideMode === "AYAH_HEADS" && w.word_position === 1) return false;
    if (hideMode === "FIRST_LETTER") return false;
    return true;
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
      {/* العمود الرئيسي: المصحف الشريف وأدوات التحكم (8 أعمدة) */}
      <div className="xl:col-span-8 space-y-4">
        {/* شريط التنقل وخيارات المصحف */}
        <div
          className={`rounded-2xl p-3.5 border shadow-sm transition-colors ${
            darkMode
              ? "bg-stone-900/90 border-stone-800 text-stone-100"
              : "bg-white border-stone-200/90 text-stone-800"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* اختيار السورة والصفحة والجزء */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="اختيار السورة"
                value={pageData?.primary_surah?.number || 1}
                onChange={(e) => {
                  const s = surahs.find((x) => x.number === Number(e.target.value));
                  if (s) setCurrentPage(s.start_page);
                }}
                className={`rounded-xl px-3 py-2 text-sm font-semibold border focus:outline-none focus:ring-2 focus:ring-emerald-600 ${
                  darkMode
                    ? "bg-stone-800 border-stone-700 text-stone-100"
                    : "bg-stone-50 border-stone-200 text-stone-900"
                }`}
              >
                {surahs.map((s) => (
                  <option key={s.number} value={s.number}>
                    {s.number}. سورة {s.name_ar} ({s.revelation_type} • {s.ayah_count} آية)
                  </option>
                ))}
              </select>

              <div className="flex items-center rounded-xl border border-stone-200 dark:border-stone-700 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage <= 1}
                  title="الصفحة السابقة"
                  className="px-2.5 py-2 hover:bg-emerald-50 dark:hover:bg-stone-800 disabled:opacity-40"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <div className="px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5">
                  <span>صفحة</span>
                  <input
                    type="number"
                    min={1}
                    max={604}
                    value={currentPage}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 1 && val <= 604) setCurrentPage(val);
                    }}
                    className="w-14 text-center rounded-md border border-stone-300 dark:border-stone-600 bg-transparent py-0.5 font-bold"
                  />
                  <span className="opacity-60">/ 604</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCurrentPage(Math.min(604, currentPage + 1))}
                  disabled={currentPage >= 604}
                  title="الصفحة التالية"
                  className="px-2.5 py-2 hover:bg-emerald-50 dark:hover:bg-stone-800 disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>

              {pageData && (
                <span className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/20">
                  الجزء {toArabicDigits(pageData.juz_number)}
                </span>
              )}
            </div>

            {/* أوضاع الإخفاء للتسميع وتلوين التجويد والخريطة الحرارية */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                {hideMode === "NONE" ? (
                  <Eye className="w-4 h-4 text-emerald-600" />
                ) : (
                  <EyeOff className="w-4 h-4 text-amber-600" />
                )}
                <select
                  aria-label="وضع الإخفاء للتسميع"
                  value={hideMode}
                  onChange={(e) => setHideMode(e.target.value as HideMode)}
                  className={`rounded-xl px-2.5 py-1.5 text-xs font-semibold border ${
                    hideMode !== "NONE"
                      ? "bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950/50 dark:border-amber-700 dark:text-amber-200"
                      : darkMode
                      ? "bg-stone-800 border-stone-700 text-stone-200"
                      : "bg-stone-50 border-stone-200 text-stone-700"
                  }`}
                >
                  <option value="NONE">وضع القراءة (إظهار الكلمات)</option>
                  <option value="BLUR_ALL">وضع التسميع (إخفاء ضبابي)</option>
                  <option value="FIRST_LETTER">تسميع بإظهار أول حرف</option>
                  <option value="AYAH_HEADS">تسميع بإظهار رؤوس الآيات</option>
                </select>
              </div>

              {hideMode !== "NONE" && (
                <button
                  type="button"
                  onClick={triggerPeek}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-amber-100 text-amber-900 hover:bg-amber-200 transition"
                >
                  <Eye className="w-3.5 h-3.5" />
                  تلميح كلمة
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowTajweedColors((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition ${
                  showTajweedColors
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "border-stone-300 dark:border-stone-700 opacity-75"
                }`}
              >
                <Palette className="w-3.5 h-3.5" />
                تلوين التجويد
              </button>

              <button
                type="button"
                onClick={() => setShowHeatmap((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition ${
                  showHeatmap
                    ? "bg-rose-600 text-white border-rose-600"
                    : "border-stone-300 dark:border-stone-700 opacity-75"
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
                خريطة الأخطاء
              </button>

              <button
                type="button"
                onClick={() =>
                  setLayoutMode((m) => (m === "MUSHAF_FLOW" ? "AYAH_CARDS" : "MUSHAF_FLOW"))
                }
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium border border-stone-300 dark:border-stone-700"
              >
                <BookOpen className="w-3.5 h-3.5" />
                {layoutMode === "MUSHAF_FLOW" ? "آيات مفصلة" : "مصحف متصل"}
              </button>
            </div>
          </div>
        </div>

        {/* صحيفة المصحف الشريف */}
        <div
          className={`rounded-3xl p-6 sm:p-10 min-h-[540px] transition-all relative ${
            darkMode ? "mushaf-parchment-dark text-stone-100" : "mushaf-parchment text-stone-900"
          }`}
        >
          {loadingPage && !pageData ? (
            <div className="py-32 text-center text-stone-500 font-medium">
              جاري تحميل صفحة المصحف الشريف...
            </div>
          ) : (
            pageData && (
              <div className="space-y-5">
                {/* ترويسة الصفحة العلوية على طراز المصحف الشريف */}
                <div className="flex items-center justify-between text-xs font-semibold tracking-wide border-b border-amber-700/20 pb-2.5 text-amber-900/80 dark:text-amber-300/80">
                  <span>
                    الجزء {toArabicDigits(pageData.juz_number)}
                  </span>
                  <span>
                    {pageData.surahs_on_page.map((s) => `سورة ${s.name_ar}`).join(" • ")}
                  </span>
                  <span>صفحة {toArabicDigits(pageData.page_number)}</span>
                </div>

                {/* عرض المصحف المتصل أو البطاقات المفصلة */}
                <div
                  className={
                    layoutMode === "MUSHAF_FLOW"
                      ? "font-quran text-[29px] sm:text-[33px] leading-[2.35] text-justify"
                      : "space-y-4"
                  }
                >
                  {pageData.ayahs.map((ayah) => {
                    const isPlayingThisAyah = playingAyahId === ayah.id;
                    return (
                      <React.Fragment key={ayah.id}>
                        {/* إطار اسم السورة والبسملة عند بداية كل سورة جديدة */}
                        {ayah.is_surah_start && (
                          <div className="my-5 block w-full text-center select-none">
                            <div
                              className={`mx-auto max-w-xl rounded-2xl py-2.5 px-6 border-2 ${
                                darkMode
                                  ? "bg-emerald-950/60 border-amber-600/50 text-amber-200"
                                  : "bg-gradient-to-r from-amber-100/80 via-emerald-50 to-amber-100/80 border-amber-600/40 text-emerald-950"
                              }`}
                            >
                              <div className="font-quran text-2xl sm:text-3xl font-bold">
                                {ayah.surah_name_uthmani}
                              </div>
                            </div>
                            {ayah.show_basmalah && (
                              <div className="font-quran text-2xl sm:text-3xl mt-3 mb-1 text-emerald-900 dark:text-emerald-300">
                                بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
                              </div>
                            )}
                          </div>
                        )}

                        {layoutMode === "MUSHAF_FLOW" ? (
                          <span
                            className={`inline ${
                              isPlayingThisAyah
                                ? "bg-emerald-500/10 rounded-lg px-1"
                                : ""
                            }`}
                          >
                            {ayah.words.map((w) => {
                              const isCurrent = w.id === cursorWordId;
                              const mistakeType = mistakeMap[w.id];
                              const hasTjWarn = tajweedWarnSet.has(w.id);
                              const heatCount = pageData.heatmap[String(w.id)]?.count || 0;
                              const blurred = isWordBlurred(w);
                              const topRule =
                                showTajweedColors && w.tajweed_rules.length > 0
                                  ? w.tajweed_rules[0]
                                  : null;

                              return (
                                <span
                                  key={w.id}
                                  onClick={() => handleWordClick(w)}
                                  title={`انقر لوضع المؤشر أو فحص التجويد (${w.text_uthmani})`}
                                  style={
                                    topRule && !mistakeType && !blurred
                                      ? { color: topRule.color }
                                      : undefined
                                  }
                                  className={`inline-block mx-[3px] px-1.5 rounded-lg cursor-pointer transition-all duration-150 relative ${
                                    isCurrent
                                      ? "bg-emerald-500/20 ring-2 ring-emerald-600 cursor-word-active font-bold"
                                      : "hover:bg-amber-500/10"
                                  } ${
                                    mistakeType
                                      ? "bg-rose-600 text-white !important mistake-flash shadow-sm"
                                      : ""
                                  } ${
                                    hasTjWarn && !mistakeType
                                      ? "underline decoration-wavy decoration-amber-500 underline-offset-8"
                                      : ""
                                  } ${
                                    showHeatmap && heatCount > 0 && !mistakeType
                                      ? heatCount >= 2
                                        ? "bg-rose-500/25 ring-1 ring-rose-500"
                                        : "bg-amber-400/25 ring-1 ring-amber-500"
                                      : ""
                                  } ${
                                    blurred
                                      ? "blur-[7px] select-none bg-stone-400/20 text-stone-500"
                                      : ""
                                  }`}
                                >
                                  {renderWordContent(w)}
                                  {showHeatmap && heatCount > 0 && (
                                    <sup className="text-[10px] font-sans font-bold bg-rose-600 text-white rounded-full px-1 -top-3 right-0">
                                      {heatCount}
                                    </sup>
                                  )}
                                </span>
                              );
                            })}
                            {/* وسام نهاية الآية مع إمكانية تشغيل صوت الآية عند النقر */}
                            <button
                              type="button"
                              onClick={() => playAyahAudio(ayah.id)}
                              title="استمع لتلاوة هذه الآية"
                              className={`inline-flex items-center justify-center mx-1.5 px-1.5 text-xl sm:text-2xl font-quran rounded-full transition ${
                                isPlayingThisAyah
                                  ? "text-emerald-700 bg-emerald-200/70 scale-110"
                                  : "text-amber-700 dark:text-amber-400 hover:text-emerald-700"
                              }`}
                            >
                              ﴿{toArabicDigits(ayah.ayah_number)}﴾
                            </button>
                          </span>
                        ) : (
                          /* وضع الآيات المفصّلة */
                          <div
                            className={`p-4 rounded-2xl border transition ${
                              isPlayingThisAyah
                                ? "border-emerald-500 bg-emerald-500/5"
                                : "border-amber-700/15 bg-white/40 dark:bg-stone-900/40"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2 text-xs opacity-75">
                              <span>
                                سورة {ayah.surah_name_ar} • الآية {toArabicDigits(ayah.ayah_number)}
                              </span>
                              <button
                                type="button"
                                onClick={() => playAyahAudio(ayah.id)}
                                className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold"
                              >
                                <Volume2 className="w-3.5 h-3.5" />
                                استماع
                              </button>
                            </div>
                            <div className="font-quran text-3xl leading-[2.2]">
                              {ayah.words.map((w) => {
                                const isCurrent = w.id === cursorWordId;
                                const mistakeType = mistakeMap[w.id];
                                const blurred = isWordBlurred(w);
                                const topRule =
                                  showTajweedColors && w.tajweed_rules.length > 0
                                    ? w.tajweed_rules[0]
                                    : null;
                                return (
                                  <span
                                    key={w.id}
                                    onClick={() => handleWordClick(w)}
                                    style={
                                      topRule && !mistakeType && !blurred
                                        ? { color: topRule.color }
                                        : undefined
                                    }
                                    className={`inline-block mx-1 px-1.5 rounded-lg cursor-pointer ${
                                      isCurrent ? "bg-emerald-500/20 ring-2 ring-emerald-600" : ""
                                    } ${mistakeType ? "bg-rose-600 text-white" : ""} ${
                                      blurred ? "blur-[7px] select-none bg-stone-400/20" : ""
                                    }`}
                                  >
                                    {renderWordContent(w)}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>

                {/* مفتاح ألوان أحكام التجويد السريع أسفل الصفحة */}
                {showTajweedColors && (
                  <div className="pt-4 border-t border-amber-700/15 flex flex-wrap items-center justify-center gap-3 text-[11px] font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#dc2626]" /> مد واجب/لازم (4-6 حركات)
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#ea580c]" /> مد جائز منفصل
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#16a34a]" /> غنّة / إخفاء / إدغام بغنّة
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#0284c7]" /> إقلاب
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#2563eb]" /> قلقلة (قطب جد)
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#9333ea]" /> لفظ الجلالة
                    </span>
                  </div>
                )}
              </div>
            )
          )}
        </div>

        {/* شريط المقرئ المعلم مع التكرار للحفظ */}
        <div
          className={`rounded-2xl p-3.5 border flex flex-wrap items-center justify-between gap-3 ${
            darkMode
              ? "bg-stone-900 border-stone-800 text-stone-100"
              : "bg-white border-stone-200 text-stone-800"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={togglePageRecitationAudio}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-emerald-700 hover:bg-emerald-800 text-white transition shadow-sm"
            >
              {playingAyahId !== null ? (
                <>
                  <Pause className="w-4 h-4" /> إيقاف التلاوة الصوتية
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" /> استمع للمقرئ من موضع المؤشر
                </>
              )}
            </button>

            <select
              aria-label="اختيار القارئ"
              value={selectedQari}
              onChange={(e) => setSelectedQari(e.target.value)}
              className={`rounded-xl px-3 py-2 text-xs font-semibold border ${
                darkMode
                  ? "bg-stone-800 border-stone-700 text-stone-200"
                  : "bg-stone-50 border-stone-200 text-stone-800"
              }`}
            >
              {QARIS.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 text-xs font-semibold">
            <Repeat className="w-4 h-4 text-emerald-600" />
            <span>تكرار كل آية للحفظ:</span>
            {[1, 3, 5].map((cnt) => (
              <button
                key={cnt}
                type="button"
                onClick={() => setRepeatPerAyah(cnt)}
                className={`px-2.5 py-1 rounded-lg border ${
                  repeatPerAyah === cnt
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "border-stone-300 dark:border-stone-700"
                }`}
              >
                {cnt}×
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* العمود الجانبي: استوديو التسميع الصوتي اللحظي + المحاكاة + فاحص الكلمة (4 أعمدة) */}
      <div className="xl:col-span-4 space-y-4">
        {/* بطاقة التحكم بالتسميع الصوتي اللحظي */}
        <div
          className={`rounded-2xl p-5 border shadow-sm space-y-4 ${
            darkMode
              ? "bg-stone-900 border-stone-800 text-stone-100"
              : "bg-white border-stone-200 text-stone-900"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                استوديو التسميع الذكي اللحظي
              </h2>
              <p className="text-xs opacity-70 mt-0.5">
                متصل بمحرك المطابقة والتجويد عبر WebSocket ({wsConnected ? "نشط" : "جاري الاتصال"})
              </p>
            </div>
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                wsConnected ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
          </div>

          {/* مؤشرات الأداء الفورية للجلسة */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl p-2.5 bg-stone-100/80 dark:bg-stone-800/80">
              <div className="text-[11px] opacity-70">الكلمات المسمّعة</div>
              <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                {wordsRecited}
              </div>
            </div>
            <div className="rounded-xl p-2.5 bg-stone-100/80 dark:bg-stone-800/80">
              <div className="text-[11px] opacity-70">دقة الحفظ</div>
              <div className="text-lg font-bold text-sky-700 dark:text-sky-400">
                {accuracyScore}%
              </div>
            </div>
            <div className="rounded-xl p-2.5 bg-stone-100/80 dark:bg-stone-800/80">
              <div className="text-[11px] opacity-70">إتقان التجويد</div>
              <div className="text-lg font-bold text-amber-700 dark:text-amber-400">
                {tajweedScore}%
              </div>
            </div>
          </div>

          {/* الكلمة المتوقعة حالياً عند المؤشر */}
          <div className="rounded-xl p-3 bg-emerald-500/10 border border-emerald-600/20 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-medium text-emerald-900/70 dark:text-emerald-200/70">
                موضع المؤشر الحالي (الكلمة #{cursorWordId}):
              </div>
              <div className="font-quran text-2xl font-bold text-emerald-900 dark:text-emerald-300 mt-0.5">
                {hideMode !== "NONE" && peekWordId !== cursorWordId
                  ? "﴿ مخفية للتسميع ﴾"
                  : wordById.get(cursorWordId)?.text_uthmani || "..."}
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={autoLocateVoice}
                onChange={(e) => {
                  const val = e.target.checked;
                  setAutoLocateVoice(val);
                  sendWs({
                    action: "set_cursor",
                    word_id: cursorWordId,
                    auto_locate: val,
                  });
                }}
                className="rounded accent-emerald-600"
              />
              تحديد السورة تلقائياً
            </label>
          </div>

          {/* زر تشغيل الميكروفون ومؤشر الموجة الصوتية */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={micActive ? stopLiveMic : startLiveMic}
              className={`w-full py-3.5 px-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2.5 shadow-md transition ${
                micActive
                  ? "bg-rose-600 hover:bg-rose-700 text-white"
                  : "bg-emerald-700 hover:bg-emerald-800 text-white"
              }`}
            >
              {micActive ? (
                <>
                  <MicOff className="w-5 h-5 animate-pulse" />
                  إيقاف الميكروفون الصوتي
                </>
              ) : (
                <>
                  <Mic className="w-5 h-5" />
                  ابدأ التسميع الصوتي المباشر
                </>
              )}
            </button>

            {micActive && (
              <div className="rounded-xl p-2.5 bg-stone-100 dark:bg-stone-800 space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                    جاري الاستماع لتلاوتك...
                  </span>
                  <span>مستوى الصوت: {Math.round(micLevel * 100)}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-stone-300 dark:bg-stone-700 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-75"
                    style={{ width: `${Math.max(6, Math.round(micLevel * 100))}%` }}
                  />
                </div>
                {interimSpeech && (
                  <p className="text-xs text-stone-600 dark:text-stone-300 truncate">
                    ما سُمِع: «{interimSpeech}»
                  </p>
                )}
              </div>
            )}

            {micWarning && (
              <div className="rounded-xl p-2.5 text-xs bg-amber-50 text-amber-900 border border-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800">
                {micWarning}
              </div>
            )}
          </div>

          {/* أزرار حفظ الجلسة وإعادة الضبط */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveAndFinishSession}
              disabled={wordsRecited === 0 && Object.keys(mistakeMap).length === 0}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 disabled:opacity-40"
            >
              <Save className="w-3.5 h-3.5" />
              حفظ الجلسة وتحديث FSRS
            </button>
            <button
              type="button"
              onClick={resetPageSession}
              className="inline-flex items-center justify-center gap-1 py-2 px-3 rounded-xl text-xs font-semibold border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              إعادة
            </button>
          </div>
        </div>

        {/* مختبر المحاكاة السريعة (لاختبار جميع حالات المحرك فوراً حتى بدون ميكروفون!) */}
        <div
          className={`rounded-2xl p-4 border space-y-3 ${
            darkMode
              ? "bg-stone-900 border-stone-800 text-stone-100"
              : "bg-white border-stone-200 text-stone-900"
          }`}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
              <Wand2 className="w-4 h-4" />
              مختبر اختبار المحرك (بدون ميكروفون)
            </h3>
          </div>
          <p className="text-[11px] opacity-75 leading-relaxed">
            جرّب استجابة محرك المطابقة واكتشاف الأخطاء والتجويد عبر WebSocket مباشرة على الصفحة المفتوحة:
          </p>

          <div className="grid grid-cols-2 gap-2 text-xs font-semibold">
            <button
              type="button"
              onClick={toggleSmoothAyahSimulation}
              className={`col-span-2 py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition ${
                autoSimRunning
                  ? "bg-amber-600 text-white"
                  : "bg-emerald-600/15 text-emerald-900 dark:text-emerald-300 hover:bg-emerald-600/25"
              }`}
            >
              <Play className="w-3.5 h-3.5" />
              {autoSimRunning ? "إيقاف التدفق الآلي" : "محاكاة تلاوة صحيحة متدفقة"}
            </button>

            <button
              type="button"
              onClick={simulateSkipWord}
              className="py-2 px-2.5 rounded-xl bg-rose-500/10 text-rose-800 dark:text-rose-300 hover:bg-rose-500/20 text-right"
            >
              ⏭️ محاكاة تخطي كلمة
            </button>

            <button
              type="button"
              onClick={simulateSubstitutionMistake}
              className="py-2 px-2.5 rounded-xl bg-rose-500/10 text-rose-800 dark:text-rose-300 hover:bg-rose-500/20 text-right"
            >
              ❌ محاكاة إبدال خاطئ
            </button>

            <button
              type="button"
              onClick={simulateBacktrack}
              className="py-2 px-2.5 rounded-xl bg-sky-500/10 text-sky-800 dark:text-sky-300 hover:bg-sky-500/20 text-right"
            >
              ↩️ محاكاة ترديد للمراجعة
            </button>

            <button
              type="button"
              onClick={simulateTajweedShortMaddOrGhunnah}
              className="py-2 px-2.5 rounded-xl bg-amber-500/15 text-amber-900 dark:text-amber-300 hover:bg-amber-500/25 text-right"
            >
              🎵 محاكاة قصر مد/غنة
            </button>
          </div>

          <form onSubmit={handleManualSend} className="flex gap-1.5 pt-1">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="أو اكتب كلمات منطوقة للاختبار..."
              className={`flex-1 rounded-xl px-3 py-1.5 text-xs border focus:outline-none focus:ring-2 focus:ring-emerald-600 ${
                darkMode
                  ? "bg-stone-800 border-stone-700 text-stone-100"
                  : "bg-stone-50 border-stone-200 text-stone-900"
              }`}
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-xl bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1"
            >
              <Send className="w-3.5 h-3.5" />
              إرسال
            </button>
          </form>
        </div>

        {/* بطاقة فحص الكلمة المحددة وأحكامها التجويدية */}
        {selectedWord && (
          <div
            className={`rounded-2xl p-4 border space-y-2.5 ${
              darkMode
                ? "bg-stone-900 border-stone-800 text-stone-100"
                : "bg-white border-stone-200 text-stone-900"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                تحليل الكلمة القرآنية (#{selectedWord.id})
              </span>
              <span className="text-[11px] font-mono opacity-65">
                {selectedWord.qps_reference}
              </span>
            </div>
            <div className="flex items-baseline justify-between border-b border-stone-200 dark:border-stone-800 pb-2">
              <span className="font-quran text-3xl font-bold">
                {selectedWord.text_uthmani}
              </span>
              <span className="text-xs opacity-75">
                إملائي: <strong>{selectedWord.text_imlaei}</strong>
              </span>
            </div>
            {selectedWord.tajweed_rules.length > 0 ? (
              <div className="space-y-2">
                {selectedWord.tajweed_rules.map((r) => (
                  <div
                    key={r.code}
                    className="rounded-xl p-2.5 text-xs bg-stone-50 dark:bg-stone-800/80 border-r-4"
                    style={{ borderRightColor: r.color }}
                  >
                    <div className="font-bold flex items-center justify-between">
                      <span>{r.name_ar}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-stone-200/70 dark:bg-stone-700">
                        {r.harakat}
                      </span>
                    </div>
                    <p className="opacity-80 mt-1 leading-relaxed">{r.guide}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs opacity-70">
                تُنطق بالحكم الطبيعي القياسي للحروف والحركات دون مد زائد أو غنة زائدة.
              </p>
            )}
          </div>
        )}

        {/* سجل الأحداث اللحظي للجلسة */}
        <div
          className={`rounded-2xl p-4 border space-y-2.5 ${
            darkMode
              ? "bg-stone-900 border-stone-800 text-stone-100"
              : "bg-white border-stone-200 text-stone-900"
          }`}
        >
          <h3 className="text-xs font-bold opacity-80">سجل المتابعة اللحظية</h3>
          <div className="max-h-52 overflow-y-auto space-y-1.5 text-xs pr-1">
            {liveEvents.length === 0 ? (
              <p className="opacity-60 py-4 text-center">
                ابدأ التسميع بالصوت أو اضغط أحد أزرار المحاكاة لرؤية تحليل الكلمات والأخطاء فوراً.
              </p>
            ) : (
              liveEvents.map((ev, i) => {
                if (ev.event === "WORD_MATCHED") {
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-emerald-500/10 text-emerald-900 dark:text-emerald-300"
                    >
                      <span className="inline-flex items-center gap-1.5 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        تطابق صحيح: <span className="font-quran text-base">{ev.uthmani}</span>
                      </span>
                      <span className="text-[10px] opacity-75">آية {ev.ayah_number}</span>
                    </div>
                  );
                }
                if (ev.event === "MISTAKE_DETECTED") {
                  return (
                    <div
                      key={i}
                      className="py-2 px-2.5 rounded-lg bg-rose-500/15 text-rose-900 dark:text-rose-200 border border-rose-500/30"
                    >
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                        {ev.mistake_type === "SKIPPED" ? "تخطي / نسيان كلمة" : "إبدال كلمة"}
                      </div>
                      <p className="mt-0.5 opacity-90">{ev.details}</p>
                    </div>
                  );
                }
                if (ev.event === "TAJWEED_NOTE") {
                  return (
                    <div
                      key={i}
                      className="py-2 px-2.5 rounded-lg bg-amber-500/15 text-amber-950 dark:text-amber-200 border border-amber-500/30"
                    >
                      <div className="font-bold">🔔 تنبيه تجويدي: {ev.rule_name}</div>
                      <p className="mt-0.5 opacity-90">{ev.message}</p>
                    </div>
                  );
                }
                if (ev.event === "BACKTRACK_DETECTED") {
                  return (
                    <div
                      key={i}
                      className="py-1.5 px-2.5 rounded-lg bg-sky-500/10 text-sky-900 dark:text-sky-200"
                    >
                      ↩️ تم رصد ترديد طبيعي للمراجعة («{ev.spoken}») ومزامنة المؤشر دون احتساب خطأ.
                    </div>
                  );
                }
                if (ev.event === "VERSE_LOCATED") {
                  return (
                    <div
                      key={i}
                      className="py-2 px-2.5 rounded-lg bg-emerald-600 text-white font-semibold"
                    >
                      📍 تم التعرف على الموضع تلقائياً: سورة {ev.surah_name} — الآية {ev.ayah_number} (صفحة {ev.page_number})
                    </div>
                  );
                }
                return null;
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
