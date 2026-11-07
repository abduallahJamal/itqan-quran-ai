"""
بوابة الاستدلال الصوتي المعيارية (Self-Hosted AI Worker Gateway)
تربط الخادم المركزي بحاوية الذكاء الاصطناعي المستضافة على خادم الـ GPU الخاص بك
(Silero VAD + Faster-Whisper Quran + Muaalem QPS Multi-Level CTC ONNX).
"""

from __future__ import annotations
import os
from typing import Any, Dict, Optional

import httpx

AI_WORKER_URL = os.getenv("AI_WORKER_URL", "http://127.0.0.1:8090")


class SelfHostedASRGateway:
    def __init__(self, worker_url: str = AI_WORKER_URL) -> None:
        self.worker_url = worker_url.rstrip("/")

    async def check_worker_health(self) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=1.5) as client:
                r = await client.get(f"{self.worker_url}/health")
                if r.status_code == 200:
                    data = r.json()
                    return {
                        "connected": True,
                        "mode": "self_hosted_gpu_worker",
                        "worker_url": self.worker_url,
                        "models": data.get("models", {}),
                    }
        except Exception:
            pass
        return {
            "connected": False,
            "mode": "browser_stream_and_simulator_active",
            "worker_url": self.worker_url,
            "note": (
                "خادم الـ GPU المستقل غير متصل في بيئة المعاينة الحالية (CPU Sandbox)؛ "
                "البث الصوتي المباشر من المتصفح ومحرّك المطابقة والتجويد عبر WebSocket يعملان بكامل طاقتهما، "
                "ويمكن تشغيل حاوية الـ GPU عبر docker-compose.gpu.yml."
            ),
        }

    async def transcribe_pcm_chunk(
        self, pcm16_bytes: bytes, expected_qps: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        إرسال شريحة صوتية خام (16kHz Mono 16-bit PCM) إلى خادم الـ GPU المحلي
        للحصول على:
          1. الكلمات القرآنية المنطوقة (Whisper-Quran / NeMo)
          2. رموز الخط الصوتي التجويدي QPS ونسب أزمنة المدود والغنة (Muaalem ONNX)
        """
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                files = {"audio": ("chunk.pcm", pcm16_bytes, "application/octet-stream")}
                data = {"expected_qps": expected_qps or ""}
                r = await client.post(
                    f"{self.worker_url}/v1/infer_stream", files=files, data=data
                )
                if r.status_code == 200:
                    return r.json()
        except Exception:
            return None
        return None
