import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  addProductionLineOutputEntry,
  addWorkerNote,
  assignAlert,
  assignWorkerToLine,
  getOperationsSnapshot,
  markWorkerException,
  transferWorkerBetweenLines,
  updateProductionLineStyle,
  updateAlertStatus,
  updateWorkerAttendanceStatus,
  updateOperationalSetting,
} from "@/server/operations/operations-service";
import type { OperationsActionResult, OperationsSnapshot } from "@/types/operations";
import type {
  AlertRecord,
  AttendanceOverview,
  AlertState,
  AttendanceSummary,
  AuditLogEntry,
  DepartmentAttendanceSummary,
  FaceEvent,
  FingerprintEvent,
  IncentiveRecord,
  LeaveRecord,
  LineAssignmentRecord,
  OvertimeRecord,
  ProductionLineRecord,
  ReportSeries,
  SmartInsight,
  SystemSettings,
  TransferLog,
  ValidationRecord,
  ValidationStatus,
  WorkerProfile,
} from "./types";
import { useAuth } from "./auth";

type OperationsContextValue = OperationsSnapshot & {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  assignWorker: (args: {
    workerId: string;
    lineId: string;
    reason: string;
    actor: string;
  }) => Promise<OperationsActionResult>;
  transferWorker: (args: {
    workerId: string;
    destinationLineId: string;
    reason: string;
    actor: string;
  }) => Promise<OperationsActionResult>;
  markValidationVerified: (args: {
    validationId: string;
    actor: string;
  }) => Promise<OperationsActionResult>;
  resolveValidation: (args: {
    validationId: string;
    status: ValidationStatus;
    reason: string;
    actor: string;
  }) => Promise<OperationsActionResult>;
  escalateValidation: (args: {
    validationId: string;
    actor: string;
  }) => Promise<OperationsActionResult>;
  updateAlertStatus: (args: {
    alertId: string;
    status: AlertState;
    actor: string;
  }) => Promise<OperationsActionResult>;
  assignAlert: (args: {
    alertId: string;
    assignedToUserId: string;
    actor: string;
  }) => Promise<OperationsActionResult>;
  addWorkerNote: (args: {
    workerId: string;
    note: string;
    actor: string;
  }) => Promise<OperationsActionResult>;
  markWorkerException: (args: {
    workerId: string;
    note: string;
    actor: string;
  }) => Promise<OperationsActionResult>;
  updateSetting: <K extends keyof SystemSettings>(args: {
    key: K;
    value: SystemSettings[K];
    actor: string;
  }) => Promise<OperationsActionResult>;
  updateLineStyle: (args: {
    lineId: string;
    allocatedStyle: string;
    actor: string;
  }) => Promise<OperationsActionResult>;
  addLineOutputEntry: (args: {
    lineId: string;
    productionDate: string;
    entryTime: string;
    outputQuantity: number;
    note?: string;
    actor: string;
  }) => Promise<OperationsActionResult>;
  updateWorkerAttendanceStatus: (args: {
    workerId: string;
    employeeCode: string;
    status: "Present" | "Absent";
    actor: string;
  }) => Promise<OperationsActionResult>;
};

const EMPTY_SNAPSHOT: OperationsSnapshot = {
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

const OperationsContext = createContext<OperationsContextValue | null>(null);
const LIVE_REFRESH_INTERVAL_MS = 10_000;
const REALTIME_REFRESH_DEBOUNCE_MS = 750;
const LIVE_REFRESH_TABLES = [
  "attendance_reconciliation",
  "hikvision_face_events",
  "zkteco_fingerprint_events",
  "fingerprint_daily_attendance",
  "face_daily_summary",
  "production_lines",
  "line_assignments",
  "production_line_output_entries",
  "operations_alerts",
  "operations_alert_history",
  "employee_profiles",
  "employee_notes",
  "employees",
  "transfer_logs",
];

function createUnavailableResult(message: string): OperationsActionResult {
  return { ok: false, message };
}

function toAttendanceRate(presentWorkers: number, lateWorkers: number, totalWorkers: number) {
  if (totalWorkers <= 0) {
    return 0;
  }

  return Math.round(((presentWorkers + lateWorkers) / totalWorkers) * 100);
}

function countAttendance(workers: WorkerProfile[]) {
  return workers.reduce(
    (summary, worker) => {
      summary.totalWorkers += 1;

      if (worker.attendanceStatus === "Present") {
        summary.presentWorkers += 1;
      } else if (worker.attendanceStatus === "Late") {
        summary.lateWorkers += 1;
      } else if (worker.attendanceStatus === "On Leave") {
        summary.onLeaveWorkers += 1;
      } else {
        summary.absentWorkers += 1;
      }

      return summary;
    },
    {
      totalWorkers: 0,
      presentWorkers: 0,
      lateWorkers: 0,
      onLeaveWorkers: 0,
      absentWorkers: 0,
    }
  );
}

function currentStatusForAttendanceOverride(
  worker: WorkerProfile,
  status: WorkerProfile["attendanceStatus"]
): WorkerProfile["currentStatus"] {
  if (status === "On Leave") {
    return "On Leave";
  }

  if (status === "Absent") {
    return "Off Shift";
  }

  if (worker.currentLineId) {
    return worker.currentStatus === "Transferred" ? "Transferred" : "On Line";
  }

  return "Pending Assignment";
}

function buildDepartmentAttendanceFromWorkers(
  workers: WorkerProfile[]
): DepartmentAttendanceSummary[] {
  const byDepartment = new Map<string, DepartmentAttendanceSummary>();

  workers.forEach((worker) => {
    const department = worker.department || "Unassigned";
    const current =
      byDepartment.get(department) || {
        department,
        totalWorkers: 0,
        presentWorkers: 0,
        lateWorkers: 0,
        onLeaveWorkers: 0,
        absentWorkers: 0,
        attendanceRate: 0,
      };

    current.totalWorkers += 1;

    if (worker.attendanceStatus === "Present") {
      current.presentWorkers += 1;
    } else if (worker.attendanceStatus === "Late") {
      current.lateWorkers += 1;
    } else if (worker.attendanceStatus === "On Leave") {
      current.onLeaveWorkers += 1;
    } else {
      current.absentWorkers += 1;
    }

    byDepartment.set(department, current);
  });

  return Array.from(byDepartment.values())
    .map((department) => ({
      ...department,
      attendanceRate: toAttendanceRate(
        department.presentWorkers,
        department.lateWorkers,
        department.totalWorkers
      ),
    }))
    .sort((a, b) => {
      if (b.totalWorkers !== a.totalWorkers) {
        return b.totalWorkers - a.totalWorkers;
      }

      return a.department.localeCompare(b.department);
    });
}

function applyAttendanceOverrideToSnapshot(
  current: OperationsSnapshot,
  override: NonNullable<OperationsActionResult["attendanceOverride"]>
): OperationsSnapshot {
  let workerWasFound = false;
  const workers = current.workers.map((worker) => {
    if (worker.id !== override.workerId) {
      return worker;
    }

    workerWasFound = true;

    return {
      ...worker,
      attendanceStatus: override.status,
      currentStatus: currentStatusForAttendanceOverride(worker, override.status),
    };
  });

  if (!workerWasFound) {
    return current;
  }

  const overviewCounts = countAttendance(workers);
  const lines = current.lines.map((line) => {
    const lineWorkers = workers.filter((worker) => worker.currentLineId === line.id);
    const lineCounts = countAttendance(lineWorkers);
    const assignedWorkers = lineCounts.totalWorkers;
    const presentTotal = lineCounts.presentWorkers + lineCounts.lateWorkers;
    const status: ProductionLineRecord["status"] =
      assignedWorkers === 0 || presentTotal === 0
        ? "Idle"
        : presentTotal >= Math.min(line.targetManpower, assignedWorkers)
          ? "Active"
          : "Partial";
    const gap = Math.max(assignedWorkers - presentTotal, 0);
    const risk: ProductionLineRecord["risk"] =
      gap >= 3 ? "Critical" : gap >= 1 ? "Watch" : "Stable";

    return {
      ...line,
      status,
      risk,
      actualManpower: assignedWorkers,
      assignedWorkers,
      presentWorkers: lineCounts.presentWorkers,
      lateWorkers: lineCounts.lateWorkers,
      onLeaveWorkers: lineCounts.onLeaveWorkers,
      absentWorkers: lineCounts.absentWorkers,
      attendanceRate: toAttendanceRate(
        lineCounts.presentWorkers,
        lineCounts.lateWorkers,
        assignedWorkers
      ),
    };
  });

  return {
    ...current,
    workers,
    lines,
    attendanceOverview: {
      ...current.attendanceOverview,
      ...overviewCounts,
    },
    departmentAttendance: buildDepartmentAttendanceFromWorkers(workers),
  };
}

export function OperationsProvider({ children }: { children: ReactNode }) {
  const { currentUser, isAuthenticated, isConfigured, loading: authLoading } = useAuth();
  const [snapshot, setSnapshot] = useState<OperationsSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadInFlightRef = useRef(false);
  const queuedRefreshRef = useRef(false);
  const realtimeRefreshTimerRef = useRef<number | null>(null);

  const loadSnapshot = useCallback(async (options: { silent?: boolean } = {}) => {
    if (loadInFlightRef.current) {
      queuedRefreshRef.current = true;
      return;
    }

    if (!isConfigured || !isAuthenticated) {
      setSnapshot(EMPTY_SNAPSHOT);
      setError(null);
      setLoading(false);
      return;
    }

    const client = getSupabaseBrowserClient();

    if (!client) {
      setSnapshot(EMPTY_SNAPSHOT);
      setError("Supabase browser client is not available.");
      setLoading(false);
      return;
    }

    loadInFlightRef.current = true;
    if (!options.silent) {
      setLoading(true);
    }
    setError(null);

    try {
      const nextSnapshot = await getOperationsSnapshot(client, {
        includeAuditLogs: currentUser.role === "admin",
        includeEmployeeNotes: currentUser.role !== "viewer",
        includeSystemSettings: currentUser.role === "admin",
        includeProfileDirectory: currentUser.role !== "viewer",
        syncReconciliationAlerts: ["admin", "hr", "supervisor"].includes(currentUser.role),
      });
      setSnapshot(nextSnapshot);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      if (!options.silent) {
        setSnapshot(EMPTY_SNAPSHOT);
      }
    } finally {
      loadInFlightRef.current = false;
      if (!options.silent) {
        setLoading(false);
      }
      if (queuedRefreshRef.current) {
        queuedRefreshRef.current = false;
        window.setTimeout(() => {
          void loadSnapshot({ silent: true });
        }, 0);
      }
    }
  }, [currentUser.role, isAuthenticated, isConfigured]);

  useEffect(() => {
    if (!authLoading) {
      void loadSnapshot();
    }
  }, [authLoading, loadSnapshot]);

  useEffect(() => {
    if (authLoading || !isConfigured || !isAuthenticated) {
      return undefined;
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void loadSnapshot({ silent: true });
      }
    };

    const timer = window.setInterval(refreshWhenVisible, LIVE_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
    };
  }, [authLoading, isAuthenticated, isConfigured, loadSnapshot]);

  useEffect(() => {
    if (authLoading || !isConfigured || !isAuthenticated) {
      return undefined;
    }

    const client = getSupabaseBrowserClient();
    if (!client) {
      return undefined;
    }

    const scheduleRealtimeRefresh = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }

      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        realtimeRefreshTimerRef.current = null;
        void loadSnapshot({ silent: true });
      }, REALTIME_REFRESH_DEBOUNCE_MS);
    };

    const channel = client.channel("operations-live-refresh");
    LIVE_REFRESH_TABLES.forEach((table) => {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
        },
        scheduleRealtimeRefresh
      );
    });
    channel.subscribe();

    return () => {
      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }
      void client.removeChannel(channel);
    };
  }, [authLoading, isAuthenticated, isConfigured, loadSnapshot]);

  const withClient = useCallback(
    async (
      action: (client: NonNullable<ReturnType<typeof getSupabaseBrowserClient>>) => Promise<OperationsActionResult>
    ) => {
      if (!isSupabaseConfigured() || !isAuthenticated) {
        return createUnavailableResult("Sign in with a configured Supabase project to continue.");
      }

      const client = getSupabaseBrowserClient();

      if (!client) {
        return createUnavailableResult("Supabase browser client is not available.");
      }

      try {
        const result = await action(client);
        if (result.ok) {
          await loadSnapshot({ silent: true });
          if (result.attendanceOverride) {
            setSnapshot((current) =>
              applyAttendanceOverrideToSnapshot(current, result.attendanceOverride!)
            );
          }
        }
        return result;
      } catch (nextError) {
        return {
          ok: false,
          message: nextError instanceof Error ? nextError.message : String(nextError),
        };
      }
    },
    [isAuthenticated, loadSnapshot]
  );

  const value = useMemo<OperationsContextValue>(
    () => ({
      ...snapshot,
      loading,
      error,
      refresh: () => loadSnapshot(),
      assignWorker: async ({ workerId, lineId, reason }) =>
        withClient((client) =>
          assignWorkerToLine(client, {
            employeeId: workerId,
            lineId,
            reason,
          })
        ),
      transferWorker: async ({ workerId, destinationLineId, reason }) =>
        withClient((client) =>
          transferWorkerBetweenLines(client, {
            employeeId: workerId,
            destinationLineId,
            reason,
          })
        ),
      markValidationVerified: async () =>
        createUnavailableResult(
          "Validation verification now runs through the live Validation Center override controls."
        ),
      resolveValidation: async () =>
        createUnavailableResult(
          "Validation resolution now runs through the live Validation Center override controls."
        ),
      escalateValidation: async () =>
        createUnavailableResult(
          "Validation escalation now runs through the live Validation Center exception workflow."
        ),
      updateAlertStatus: async ({ alertId, status }) =>
        withClient((client) =>
          updateAlertStatus(client, {
            alertId,
            status,
            actorUserId: currentUser.id,
          })
        ),
      assignAlert: async ({ alertId, assignedToUserId }) =>
        withClient((client) =>
          assignAlert(client, {
            alertId,
            assignedToUserId,
            actorUserId: currentUser.id,
          })
        ),
      addWorkerNote: async ({ workerId, note }) =>
        withClient((client) =>
          addWorkerNote(client, {
            employeeId: workerId,
            note,
          })
        ),
      markWorkerException: async ({ workerId, note }) =>
        withClient((client) =>
          markWorkerException(client, {
            employeeId: workerId,
            note,
          })
        ),
      updateSetting: async ({ key, value: nextValue }) =>
        withClient((client) =>
          updateOperationalSetting(client, {
            key,
            value: nextValue,
          })
        ),
      updateLineStyle: async ({ lineId, allocatedStyle }) =>
        withClient((client) =>
          updateProductionLineStyle(client, {
            lineId,
            allocatedStyle,
          })
        ),
      addLineOutputEntry: async ({ lineId, productionDate, entryTime, outputQuantity, note }) =>
        withClient((client) =>
          addProductionLineOutputEntry(client, {
            lineId,
            productionDate,
            entryTime,
            outputQuantity,
            note,
            actorUserId: currentUser.id,
          })
        ),
      updateWorkerAttendanceStatus: async ({ workerId, employeeCode, status }) =>
        withClient((client) =>
          updateWorkerAttendanceStatus(client, {
            employeeId: workerId,
            employeeCode,
            status,
            actorUserId: currentUser.id,
          })
        ),
    }),
    [currentUser.id, error, loadSnapshot, loading, snapshot, withClient]
  );

  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>;
}

export function useOperations() {
  const context = useContext(OperationsContext);
  if (!context) throw new Error("useOperations must be used inside OperationsProvider");
  return context;
}

export function findWorker(workers: WorkerProfile[], workerId?: string) {
  return workers.find((worker) => worker.id === workerId);
}

export function findLine(lines: ProductionLineRecord[], lineId?: string) {
  return lines.find((line) => line.id === lineId);
}

export type {
  AlertRecord,
  AttendanceOverview,
  AttendanceSummary,
  AuditLogEntry,
  DepartmentAttendanceSummary,
  FaceEvent,
  FingerprintEvent,
  IncentiveRecord,
  LeaveRecord,
  LineAssignmentRecord,
  OvertimeRecord,
  ProductionLineRecord,
  ReportSeries,
  SmartInsight,
  TransferLog,
  ValidationRecord,
};
