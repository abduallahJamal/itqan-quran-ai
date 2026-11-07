/**
 * خطاف (Hook) البث الصوتي اللحظي لتطبيق الجوال عبر WebSocket مع الاهتزاز الحسي عند الخطأ (Haptics)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import type { RecitationEvent } from "../../../../packages/shared/src/types";

export function useMobileRecitationSocket(wsBaseUrl: string, initialWordId = 1) {
  const wsRef = useRef<WebSocket | null>(null);
  const [cursorWordId, setCursorWordId] = useState<number>(initialWordId);
  const [revealedIds, setRevealedIds] = useState<Set<number>>(new Set());
  const [mistakes, setMistakes] = useState<RecitationEvent[]>([]);

  const connect = useCallback(() => {
    const ws = new WebSocket(`${wsBaseUrl}/ws/recitation`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          action: "init",
          mode: "MEMORIZATION",
          start_word_id: initialWordId,
        })
      );
    };

    ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.cursor_word_id) setCursorWordId(data.cursor_word_id);
      if (Array.isArray(data.revealed_word_ids)) {
        setRevealedIds(new Set(data.revealed_word_ids));
      }
      if (Array.isArray(data.events)) {
        for (const ev of data.events as RecitationEvent[]) {
          if (ev.event === "MISTAKE_DETECTED") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            setMistakes((prev) => [ev, ...prev]);
          }
        }
      }
    };
  }, [wsBaseUrl, initialWordId]);

  const sendPcmChunk = useCallback((pcmBuffer: ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(pcmBuffer);
    }
  }, []);

  useEffect(() => {
    return () => wsRef.current?.close();
  }, []);

  return { connect, sendPcmChunk, cursorWordId, revealedIds, mistakes };
}
