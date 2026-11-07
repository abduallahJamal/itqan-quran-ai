---
title: Itqan Quran AI
emoji: 📖
colorFrom: green
colorTo: yellow
sdk: docker
app_port: 7860
---

# منصة إتقان القرآنية (Itqan Quran AI)

منظومة متكاملة مفتوحة المعمارية ومستضافة ذاتياً (**ويب PWA + تطبيق جوال React Native + خادم مركزي FastAPI + محرك ذكاء اصطناعي GPU**) للتسميع الذكي، تتبع التلاوة كلمة بكلمة، اكتشاف أخطاء الحفظ والمتشابهات، وتصحيح أحكام التجويد بالخط الصوتي القرآني (`QPS`).

---

## هيكلية المستودع الموحد (Monorepo Structure)

```text
itqan-quran-ai/
├── data/
│   └── quran.db                     # قاعدة بيانات المصحف الموثقة (114 سورة، 6236 آية، 77,878 كلمة + التجويد + المتشابهات)
├── packages/
│   └── shared/                      # الأنواع المشتركة وأدوات تطبيع العربية بين الويب والجوال
├── services/
│   ├── backend/                     # الخادم المركزي (FastAPI + WebSocket + QuranAlignmentEngine + Tajweed QPS + FSRS)
│   └── ai-worker/                   # خدمة الاستدلال على GPU (Silero VAD + Faster-Whisper Quran + Muaalem QPS ONNX)
├── apps/
│   ├── web/                         # تطبيق الويب المتكامل (React + TypeScript + Tailwind CSS)
│   └── mobile/                      # نواة تطبيق الجوال (React Native / Expo + SQLite Offline-First)
└── docker-compose.gpu.yml           # تشغيل المنظومة كاملة على خادم GPU بأمر واحد
```

---

## التشغيل السريع

### 1. التشغيل المحلي (الخادم الموحد + الواجهة الأمامية)
```bash
# 1. بناء واجهة الويب (إن رغبت بتعديلها)
cd apps/web && npm install && npm run build

# 2. تشغيل الخادم المركزي وواجهة الويب و WebSockets على المنفذ 8000
cd ../../services/backend
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 2. التشغيل الإنتاجي مع خادم الذكاء الاصطناعي الخاص بك (NVIDIA GPU)
ضع ملف نموذج التجويد الاختياري `muaalem_tajweed_int8_fastattn.onnx` في مجلد `./models_onnx/`، ثم شغّل:
```bash
docker compose -f docker-compose.gpu.yml up -d --build
```
سيقوم `ai-worker` بتحميل نموذج **Silero VAD** ونموذج القرآن **`wasimlhr/whisper-quran-v1`** عبر محرك `CTranslate2 (faster-whisper)` على بطاقة الـ GPU تلقائياً وربطه مع الخادم المركزي.
