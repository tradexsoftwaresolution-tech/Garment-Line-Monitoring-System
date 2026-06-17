import { useCallback, useEffect, useState } from "react";
import { getHikvisionEventsFromBackend } from "@/lib/backend/pipeline-api";
import { isBackendConfigured } from "@/lib/backend/env";
import type { HikvisionRecognitionEvent, HikvisionStatus } from "@/types/hikvision";

export function useHikvisionFaceEvents(limit = 500, enabled = true) {
  const backendConfigured = isBackendConfigured();
  const [events, setEvents] = useState<HikvisionRecognitionEvent[]>([]);
  const [status, setStatus] = useState<HikvisionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!backendConfigured || !enabled) {
      return;
    }

    try {
      const response = await getHikvisionEventsFromBackend(limit);
      setEvents(response.events);
      setStatus(response.status);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [backendConfigured, enabled, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!backendConfigured || !enabled) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void refresh();
    }, 10000);

    return () => window.clearInterval(timer);
  }, [backendConfigured, enabled, refresh]);

  return { events, status, error, refresh };
}
