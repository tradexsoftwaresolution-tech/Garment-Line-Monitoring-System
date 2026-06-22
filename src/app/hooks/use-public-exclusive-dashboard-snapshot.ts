import { useCallback, useEffect, useState } from "react";
import { getPublicExclusiveDashboardSnapshotFromBackend } from "@/lib/backend/pipeline-api";
import { isBackendConfigured } from "@/lib/backend/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getOperationsSnapshot } from "@/server/operations/operations-service";
import type { OperationsSnapshot } from "@/types/operations";

export const EMPTY_PUBLIC_OPERATIONS_SNAPSHOT: OperationsSnapshot = {
  attendanceOverview: {
    attendanceDate: "",
    totalWorkers: 0,
    presentWorkers: 0,
    lateWorkers: 0,
    onLeaveWorkers: 0,
    absentWorkers: 0,
  },
  departmentAttendance: [],
  workers: [],
  lines: [],
  faceEvents: [],
  fingerprintDeviceSummary: {
    attendanceDate: "",
    totalDevicePins: 0,
    registeredDevicePins: 0,
    unregisteredDevicePins: 0,
    totalPunches: 0,
    registeredPunches: 0,
    unregisteredPunches: 0,
    unregisteredPins: [],
  },
  fingerprintEvents: [],
  validationRecords: [],
  lineAssignments: [],
  lineOutputEntries: [],
  transferLogs: [],
  alerts: [],
  attendanceSummaries: [],
  overtimeRecords: [],
  leaveRecords: [],
  incentiveRecords: [],
  auditLogs: [],
  smartInsights: [],
  announcements: [],
  settings: {
    faceRecognition: true,
    fingerprintVerification: true,
    dualValidationRequired: true,
    autoRejectUnknownFaces: false,
    manualVerificationFallback: true,
    autoMarkAbsent: false,
    morningShiftStart: "07:30",
    morningShiftEnd: "17:30",
    lateArrivalThreshold: 10,
    gracePeriod: 5,
    failedEntryAlerts: true,
    lowEfficiencyWarnings: true,
    workerAbsenceAlerts: true,
    dailySummaryReport: true,
  },
  reportSeries: {
    weeklyAttendance: [],
    departmentAttendance: [],
    lineAttendance: [],
    transferHistory: [],
  },
};

export function usePublicExclusiveDashboardSnapshot(
  attendanceDate?: string,
  refreshMs = 10_000
) {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot>(EMPTY_PUBLIC_OPERATIONS_SNAPSHOT);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const nextSnapshot = isBackendConfigured()
        ? await getPublicExclusiveDashboardSnapshotFromBackend(attendanceDate)
        : await getPublicExclusiveDashboardSnapshotFromSupabase();
      setSnapshot(nextSnapshot);
      setError(null);
    } catch (requestError) {
      if (isBackendConfigured()) {
        try {
          const fallbackSnapshot = await getPublicExclusiveDashboardSnapshotFromSupabase();
          setSnapshot(fallbackSnapshot);
          setError(null);
          return;
        } catch (_fallbackError) {
          // Keep the backend error visible; it is the primary data path for this public page.
        }
      }

      setError(requestError instanceof Error ? requestError.message : "Could not load dashboard data.");
    } finally {
      setIsLoading(false);
    }
  }, [attendanceDate]);

  useEffect(() => {
    setIsLoading(true);
    void refresh();
    if (refreshMs <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void refresh();
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [refresh, refreshMs]);

  return { snapshot, isLoading, error, refresh };
}

async function getPublicExclusiveDashboardSnapshotFromSupabase() {
  const client = getSupabaseBrowserClient();

  if (!client) {
    throw new Error("Supabase is not configured.");
  }

  return getOperationsSnapshot(client, {
    includeAuditLogs: false,
    includeEmployeeNotes: false,
    includeSystemSettings: false,
    includeProfileDirectory: false,
    syncReconciliationAlerts: false,
  });
}
