/**
 * أدوات الصوت التفاعلية:
 * 1. تنبيهات صوتية لطيفة مدمجة عبر Web Audio API عند اكتشاف خطأ حفظ أو ملاحظة تجويد.
 * 2. التقاط الميكروفون وقياس مستوى الموجة الصوتية وبث شرائح 16kHz PCM لخادم الـ GPU إن كان متصلاً.
 * 3. محول الأرقام الهندية العربية لعرض أرقام الآيات والصفحات بأناقة.
 */

let sharedAudioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === "suspended") {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function playMistakeAlertTone(kind: "mistake" | "tajweed" | "located"): void {
  const ctx = getAudioCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  if (kind === "mistake") {
    osc.type = "triangle";
    osc.frequency.setValueAtTime(310, now);
    osc.frequency.exponentialRampToValueAtTime(210, now + 0.22);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.start(now);
    osc.stop(now + 0.25);
  } else if (kind === "tajweed") {
    osc.type = "sine";
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(370, now + 0.18);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.21);
  } else {
    osc.type = "sine";
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.16);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.start(now);
    osc.stop(now + 0.19);
  }
}

export function toArabicDigits(num: number | string): string {
  const map = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  return String(num).replace(/\d/g, (d) => map[Number(d)]);
}

export interface MicMeterHandle {
  stop: () => void;
}

export async function startMicrophoneCapture(
  onLevel: (level: number) => void,
  onPcm16Chunk?: (pcmBytes: ArrayBuffer) => void
): Promise<MicMeterHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      channelCount: 1,
      sampleRate: 16000,
    },
  });

  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new Ctx({ sampleRate: 16000 });
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const dataArr = new Uint8Array(analyser.frequencyBinCount);
  let active = true;

  const tick = () => {
    if (!active) return;
    analyser.getByteTimeDomainData(dataArr);
    let sumSq = 0;
    for (let i = 0; i < dataArr.length; i++) {
      const v = (dataArr[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / dataArr.length);
    onLevel(Math.min(1, rms * 4.2));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // إرسال شرائح PCM 16-bit إذا كان خادم الـ GPU متصلاً
  let processor: ScriptProcessorNode | null = null;
  if (onPcm16Chunk) {
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    let pcmAccum: Int16Array[] = [];
    let totalSamples = 0;

    processor.onaudioprocess = (e) => {
      if (!active) return;
      const input = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      pcmAccum.push(int16);
      totalSamples += int16.length;
      // كل ~1.2 ثانية (19200 عينة) نرسل شريحة
      if (totalSamples >= 19200) {
        const merged = new Int16Array(totalSamples);
        let offset = 0;
        for (const arr of pcmAccum) {
          merged.set(arr, offset);
          offset += arr.length;
        }
        pcmAccum = [];
        totalSamples = 0;
        onPcm16Chunk(merged.buffer);
      }
    };
    source.connect(processor);
    processor.connect(audioCtx.destination);
  }

  return {
    stop: () => {
      active = false;
      processor?.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      audioCtx.close().catch(() => {});
      onLevel(0);
    },
  };
}
