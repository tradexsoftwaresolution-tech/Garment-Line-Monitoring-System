import { useCallback, useEffect, useState } from "react";
import { isBackendConfigured } from "@/lib/backend/env";
import { getZktecoEventsFromBackend } from "@/lib/backend/pipeline-api";
import type { ZktecoFingerprintEvent } from "@/types/zkteco";

export function useZktecoFingerprintEvents(limit = 5000, enabled = true) {
  const backendConfigured = isBackendConfigured();
  const [events, setEvents] = useState<ZktecoFingerprintEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!backendConfigured || !enabled) {
      return;
    }

    try {
      const nextEvents = await getZktecoEventsFromBackend(limit);
      setEvents(nextEvents);
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

  return { events, error, refresh };
}
