# حاوية شاملة جاهزة للنشر المجاني المباشر على Render / Railway / Hugging Face Spaces / Koyeb
# تجمع الواجهة الأمامية المبنية + خادم FastAPI + WebSockets + قاعدة بيانات المصحف الكاملة في مكان واحد

# 1. بناء واجهة الويب (React + TypeScript + Vite)
FROM node:20-slim AS web-builder
WORKDIR /build
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
WORKDIR /build/apps/web
RUN npm install --no-audit --no-fund && npm run build

# 2. تشغيل الخادم المركزي وتوليد قاعدة البيانات القرآنية إن لم تكن مرفوعة
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PORT=7860

WORKDIR /app
COPY services/backend/requirements.txt ./services/backend/requirements.txt
RUN pip install --no-cache-dir -r ./services/backend/requirements.txt

COPY services/backend ./services/backend
COPY --from=web-builder /build/apps/web/public_bundle ./apps/web/public_bundle

# بناء قاعدة بيانات المصحف الكاملة (6,236 آية + التجويد + المتشابهات) أثناء بناء الصورة
RUN mkdir -p /app/data && python3 /app/services/backend/scripts/build_quran_db.py && chmod -R 777 /app/data

WORKDIR /app/services/backend
EXPOSE 7860

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
