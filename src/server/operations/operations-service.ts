import type {
  AlertRecord,
  AppUser,
  AttendanceOverview,
  AttendanceSummary,
  AuditLogEntry,
  DepartmentRecord,
  DepartmentAttendanceSummary,
  FaceEvent,
  FingerprintDeviceSummary,
  FingerprintEvent,
  OvertimeRecord,
  ProductionLineRecord,
  ReportSeriesPoint,
  SmartInsight,
  SystemSettings,
  TimelineEvent,
  ValidationStatus,
  VerificationState,
  WorkerProfile,
} from "@/app/types";
import type { Database, Json } from "@/types/database";
import type { OperationsActionResult, OperationsSnapshot } from "@/types/operations";
import { saveCalculationFromBackend } from "@/lib/backend/calculation-api";
import { isBackendConfigured } from "@/lib/backend/env";
import type { AppSupabaseClient } from "../repositories/base-repository";
import { logAuditEvent } from "../reconciliation/audit-service";
import {
  createEmployee,
  createEmployeeNote,
  createDepartment,
  createOperationsAlertHistory,
  createProductionLineOutputEntry,
  deactivateDepartment,
  fetchAttendanceReconciliationForEmployeeDate,
  fetchLatestFingerprintAttendanceForEmployee,
  fetchOperationsAlert,
  fetchProductionLine,
  fetchSystemSettings,
  listAnnouncements,
  listAttendanceReconciliationRows,
  listAuditLogs,
  listDepartments,
  listEmployeeNotes,
  listEmployeeProfiles,
  listEmployeeRoster,
  listEmployees,
  listFingerprintAttendanceRows,
  listZktecoFingerprintEventsForDate,
  listIncentiveRecords,
  listLineAssignments,
  listOperationsAlertHistory,
  listOperationsAlerts,
  listProductionLineMetrics,
  listProductionLineOutputEntries,
  listProductionLineOutputEntriesForDay,
  listProductionLines,
  listProfiles,
  listTransferLogs,
  runAssignWorkerToLineRpc,
  runReactivateEmployeeRpc,
  runResignEmployeeRpc,
  runSetEmployeeInactiveRpc,
  runSyncInactiveAbsenceAlertsRpc,
  runSyncReconciliationAlertsRpc,
  runTransferWorkerLineRpc,
  updateDepartment,
  updateEmployee,
  updateOperationsAlert,
  updateAttendanceReconciliationForEmployeeDate,
  updateFingerprintAttendanceRowsForEmployeeDate,
  upsertEmployeeProfile,
  updateProductionLine,
  updateProductionLineOutputEntry,
  updateSystemSettings,
} from "../repositories/operations-repository";

type ReconciliationRow =
  Awaited<ReturnType<typeof listAttendanceReconciliationRows>>[number];
type EmployeeRow = Awaited<ReturnType<typeof listEmployees>>[number];
type DepartmentRow = Awaited<ReturnType<typeof listDepartments>>[number];
type EmployeeProfileRow = Awaited<ReturnType<typeof listEmployeeProfiles>>[number];
type EmployeeNoteRow = Awaited<ReturnType<typeof listEmployeeNotes>>[number];
type FingerprintAttendanceRow =
  Awaited<ReturnType<typeof listFingerprintAttendanceRows>>[number];
type ZktecoFingerprintEventRow =
  Awaited<ReturnType<typeof listZktecoFingerprintEventsForDate>>[number];
type LineAssignmentRow = Awaited<ReturnType<typeof listLineAssignments>>[number];
type TransferLogRow = Awaited<ReturnType<typeof listTransferLogs>>[number];
type ProductionLineRow = Awaited<ReturnType<typeof listProductionLines>>[number];
type ProductionLineMetricRow = Awaited<ReturnType<typeof listProductionLineMetrics>>[number];
type ProductionLineOutputEntryRow = Awaited<ReturnType<typeof listProductionLineOutputEntries>>[number];

const LATE_FACE_ARRIVAL_CUTOFF = "08:00:00";
const ATTENDANCE_TIME_ZONE = "Asia/Colombo";

export type WorkerHrDetailsInput = {
  employeeCode: string;
  epfNo?: string | null;
  fullName: string;
  departmentId?: string | null;
  department: string;
  roleTitle: string;
  phone?: string | null;
  shift?: "Shift A" | "Shift B";
  hireDate?: string | null;
  photoUrl?: string | null;
  hrNotes?: string | null;
};

export type DepartmentInput = {
  code?: string | null;
  name: string;
  description?: string | null;
  isActive?: boolean;
};

function currentAttendanceDate() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: ATTENDANCE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function currentTimeText() {
  return new Date().toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function cleanText(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  return trimmed || null;
}

function normalizeDepartmentCode(value: string | null | undefined, fallbackName?: string | null) {
  const source = cleanText(value) || cleanText(fallbackName) || "";
  const normalized = source
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return normalized || "DEPARTMENT";
}

function normalizeEmployeeCode(value: string | null | undefined) {
  const normalized = cleanText(value)?.replace(/\s+/g, "");
  return normalized || "";
}

function withManualAttendanceOverrideFlag(value: Json | null): Json {
  const flags = Array.isArray(value) ? value : [];
  if (flags.includes("manual_attendance_override")) {
    return flags;
  }
  return [...flags, "manual_attendance_override"];
}

function normalizeFingerprintPin(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  return trimmed.replace(/^0+(?=\d)/, "");
}

function buildFingerprintDeviceSummary(
  events: ZktecoFingerprintEventRow[],
  attendanceDate: string
): FingerprintDeviceSummary {
  const groups = new Map<
    string,
    {
      pin: string;
      firstPunch: string;
      lastPunch: string;
      punchCount: number;
      registeredPunches: number;
      deviceIps: Set<string>;
      matched: boolean;
    }
  >();

  events.forEach((event) => {
    const pin = normalizeFingerprintPin(event.employee_pin);
    if (!pin) {
      return;
    }

    const punchAt = event.event_time || `${event.attendance_date}T${event.punch_time}`;
    const current =
      groups.get(pin) ||
      {
        pin,
        firstPunch: punchAt,
        lastPunch: punchAt,
        punchCount: 0,
        registeredPunches: 0,
        deviceIps: new Set<string>(),
        matched: false,
      };

    current.punchCount += 1;
    if (event.match_status === "matched" || event.employee_code || event.employee_id) {
      current.matched = true;
      current.registeredPunches += 1;
    }
    if (event.device_ip) {
      current.deviceIps.add(event.device_ip);
    }
    if (punchAt < current.firstPunch) {
      current.firstPunch = punchAt;
    }
    if (punchAt > current.lastPunch) {
      current.lastPunch = punchAt;
    }
    groups.set(pin, current);
  });

  const pinGroups = Array.from(groups.values());
  const unregisteredPins = pinGroups
    .filter((group) => !group.matched)
    .map((group) => ({
      pin: group.pin,
      firstPunch: group.firstPunch,
      lastPunch: group.lastPunch,
      punchCount: group.punchCount,
      deviceIps: Array.from(group.deviceIps).sort(),
    }))
    .sort((a, b) => a.pin.localeCompare(b.pin, undefined, { numeric: true }));

  return {
    attendanceDate,
    totalDevicePins: pinGroups.length,
    registeredDevicePins: pinGroups.filter((group) => group.matched).length,
    unregisteredDevicePins: unregisteredPins.length,
    totalPunches: events.length,
    registeredPunches: pinGroups.reduce((sum, group) => sum + group.registeredPunches, 0),
    unregisteredPunches: unregisteredPins.reduce((sum, group) => sum + group.punchCount, 0),
    unregisteredPins,
  };
}
type OperationsAlertRow = Awaited<ReturnType<typeof listOperationsAlerts>>[number];
type OperationsAlertHistoryRow =
  Awaited<ReturnType<typeof listOperationsAlertHistory>>[number];
type IncentiveRecordRow = Awaited<ReturnType<typeof listIncentiveRecords>>[number];
type AuditLogRow = Awaited<ReturnType<typeof listAuditLogs>>[number];
type ProfileRow = Awaited<ReturnType<typeof listProfiles>>[number];

const DEFAULT_SETTINGS: SystemSettings = {
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
};

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function roleTitle(role: AppUser["role"]) {
  if (role === "admin") return "Factory Systems Administrator";
  if (role === "supervisor") return "Floor Supervisor";
  if (role === "hr") return "HR Operations Lead";
  if (role === "ie") return "Industrial Engineering Planner";
  return "Management Read-Only";
}

function roleDepartment(role: AppUser["role"]) {
  if (role === "admin") return "Operations";
  if (role === "supervisor") return "Production";
  if (role === "hr") return "Human Resources";
  if (role === "ie") return "Industrial Engineering";
  return "Management";
}

function toAppUser(profile: ProfileRow): AppUser {
  const name = profile.full_name || "Active User";
  return {
    id: profile.id,
    name,
    role: profile.role,
    title: roleTitle(profile.role),
    department: roleDepartment(profile.role),
    initials: getInitials(name),
  };
}

function toLocalTimestamp(date: string, time?: string | null) {
  return time ? `${date}T${time}` : `${date}T00:00:00`;
}

function isAfterLateFaceArrivalCutoff(time?: string | null) {
  if (!time) {
    return false;
  }

  return time.slice(0, 8) > LATE_FACE_ARRIVAL_CUTOFF;
}

function toNumber(value: number | null | undefined, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringifyAuditValue(value: Json | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch (_error) {
    return "Structured value";
  }
}

function titleCaseStatus(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mapConfidenceScore(value: ReconciliationRow["confidence_level"]) {
  if (value === "high") return 95;
  if (value === "medium") return 75;
  return 45;
}

function mapValidationStatus(
  row: ReconciliationRow | undefined,
  workerFlags: EmployeeNoteRow[]
): ValidationStatus {
  if (workerFlags.some((note) => note.note_type === "flag")) {
    return "Unresolved Exception";
  }

  if (!row) {
    return "Pending Validation";
  }

  const effectiveStatus = row.manual_override_status || row.reconciliation_status;

  if (effectiveStatus === "validated" || effectiveStatus === "leave" || effectiveStatus === "absent") {
    return "Fully Validated";
  }

  if (effectiveStatus === "face_only") {
    return "Face Only";
  }

  if (effectiveStatus === "fingerprint_only") {
    return "Fingerprint Only";
  }

  if (effectiveStatus === "anomaly") {
    return "Unresolved Exception";
  }

  if (
    Array.isArray(row.rule_flags) &&
    row.rule_flags.some((flag) =>
      ["suspicious_timing_mismatch", "zero_times_without_leave"].includes(String(flag))
    )
  ) {
    return "Time Mismatch";
  }

  return "Pending Validation";
}

function isPresentAttendanceStatus(status: WorkerProfile["attendanceStatus"]) {
  return status === "Present" || status === "Late";
}

function mapAttendanceStatus(args: {
  fingerprintRow?: FingerprintAttendanceRow;
  reconciliationRow?: ReconciliationRow;
}): WorkerProfile["attendanceStatus"] {
  if (args.reconciliationRow) {
    const effectiveStatus =
      args.reconciliationRow.manual_override_status || args.reconciliationRow.reconciliation_status;

    if (effectiveStatus === "leave") {
      return "On Leave";
    }

    if (effectiveStatus === "absent") {
      return "Absent";
    }

    if (args.reconciliationRow.fingerprint_time_in || args.reconciliationRow.fingerprint_time_out) {
      return toNumber(args.reconciliationRow.late_early_hours) > 0 ? "Late" : "Present";
    }

    if (args.reconciliationRow.face_first_seen) {
      return isAfterLateFaceArrivalCutoff(args.reconciliationRow.face_first_seen) ? "Late" : "Present";
    }
  }

  if (args.fingerprintRow) {
    if (args.fingerprintRow.attendance_state === "leave") {
      return "On Leave";
    }

    if (args.fingerprintRow.attendance_state === "present") {
      return toNumber(args.fingerprintRow.late_early_hours) > 0 ? "Late" : "Present";
    }

    if (args.reconciliationRow?.face_first_seen) {
      return isAfterLateFaceArrivalCutoff(args.reconciliationRow.face_first_seen) ? "Late" : "Present";
    }

    return "Absent";
  }

  return "Absent";
}

function mapFaceVerification(row: ReconciliationRow | undefined): VerificationState {
  if (!row) {
    return "Pending";
  }

  if (toNumber(row.face_event_count) > 0) {
    return "Verified";
  }

  return "Missing";
}

function mapFingerprintVerification(
  fingerprintRow: FingerprintAttendanceRow | undefined,
  reconciliationRow: ReconciliationRow | undefined
): VerificationState {
  if (!fingerprintRow && !reconciliationRow) {
    return "Pending";
  }

  if (
    fingerprintRow?.time_in ||
    fingerprintRow?.time_out ||
    fingerprintRow?.leave_type ||
    reconciliationRow?.fingerprint_time_in ||
    reconciliationRow?.fingerprint_time_out ||
    reconciliationRow?.leave_type
  ) {
    return "Verified";
  }

  return "Missing";
}

function mapCurrentStatus(args: {
  attendanceStatus: WorkerProfile["attendanceStatus"];
  currentLineId?: string;
  hasRecentTransfer: boolean;
}): WorkerProfile["currentStatus"] {
  if (args.attendanceStatus === "On Leave") {
    return "On Leave";
  }

  if (args.attendanceStatus === "Absent") {
    return "Off Shift";
  }

  if (args.currentLineId) {
    return args.hasRecentTransfer ? "Transferred" : "On Line";
  }

  return "Pending Assignment";
}

function buildTimeline(args: {
  row?: ReconciliationRow;
  notes: EmployeeNoteRow[];
  transfers: TransferLogRow[];
}): TimelineEvent[] {
  const items: TimelineEvent[] = [];
  const row = args.row;

  if (row?.face_first_seen) {
    items.push({
      id: `${row.id}-face`,
      type: "face",
      timestamp: toLocalTimestamp(row.attendance_date, row.face_first_seen),
      label: "Face activity recorded",
      detail: `First face event captured at ${row.face_first_seen}.`,
    });
  }

  if (row?.fingerprint_time_in) {
    items.push({
      id: `${row.id}-fingerprint`,
      type: "fingerprint",
      timestamp: toLocalTimestamp(row.attendance_date, row.fingerprint_time_in),
      label: "Fingerprint attendance captured",
      detail: `Fingerprint time-in recorded at ${row.fingerprint_time_in}.`,
    });
  }

  if (row) {
    items.push({
      id: `${row.id}-reconciliation`,
      type: "validation",
      timestamp: row.updated_at,
      label: "Reconciliation classified",
      detail: `Status ${titleCaseStatus(
        row.manual_override_status || row.reconciliation_status
      )}${row.exception_reason ? ` · ${row.exception_reason}` : ""}`,
    });
  }

  if (row?.manual_override_status && row.manual_override_at) {
    items.push({
      id: `${row.id}-override`,
      type: "exception",
      timestamp: row.manual_override_at,
      label: "Manual override applied",
      detail: row.manual_override_reason || "A manual override updated the reconciliation status.",
    });
  }

  args.transfers.slice(0, 2).forEach((transfer) => {
    items.push({
      id: `${transfer.id}-transfer`,
      type: "transfer",
      timestamp: transfer.transferred_at,
      label: "Worker transferred",
      detail: transfer.reason,
    });
  });

  args.notes.slice(0, 3).forEach((note) => {
    items.push({
      id: note.id,
      type: note.note_type === "flag" ? "exception" : "note",
      timestamp: note.created_at,
      label:
        note.note_type === "flag"
          ? "Exception flagged"
          : note.note_type === "remark"
            ? "Supervisor remark"
            : "Worker note added",
      detail: note.note,
    });
  });

  return items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

const CONSECUTIVE_NO_SIGNAL_ALERT_DAYS = 7;

function getLatestAttendanceDates(rows: ReconciliationRow[], latestAttendanceDate: string) {
  return Array.from(
    new Set(
      rows
        .map((row) => row.attendance_date)
        .filter((date): date is string => Boolean(date) && date <= latestAttendanceDate)
    )
  )
    .sort()
    .slice(-CONSECUTIVE_NO_SIGNAL_ALERT_DAYS);
}

function hasFaceAttendanceSignal(row: ReconciliationRow) {
  return Boolean(row.face_first_seen || row.face_last_seen || toNumber(row.face_event_count) > 0);
}

function hasFingerprintAttendanceSignal(row: ReconciliationRow) {
  return Boolean(row.fingerprint_time_in || row.fingerprint_time_out);
}

function isApprovedLeaveReconciliation(row: ReconciliationRow) {
  const status = row.manual_override_status || row.reconciliation_status;
  return status === "leave" || Boolean(row.leave_type);
}

function buildConsecutiveNoSignalAlerts(args: {
  workers: WorkerProfile[];
  linesById: Map<string, ProductionLineRecord>;
  rowsByEmployeeCode: Map<string, ReconciliationRow[]>;
  allReconciliationRows: ReconciliationRow[];
  latestAttendanceDate: string;
}): AlertRecord[] {
  const attendanceDates = getLatestAttendanceDates(
    args.allReconciliationRows,
    args.latestAttendanceDate
  );

  if (attendanceDates.length < CONSECUTIVE_NO_SIGNAL_ALERT_DAYS) {
    return [];
  }

  const firstDate = attendanceDates[0];
  const lastDate = attendanceDates[attendanceDates.length - 1];

  return args.workers.flatMap((worker) => {
    if (worker.joinDate && worker.joinDate > firstDate) {
      return [];
    }

    const workerRows = args.rowsByEmployeeCode.get(worker.employeeId) || [];
    const missedDates: string[] = [];

    for (const date of attendanceDates) {
      const dayRows = workerRows.filter((row) => row.attendance_date === date);

      if (dayRows.some(isApprovedLeaveReconciliation)) {
        return [];
      }

      const hasAnySignal = dayRows.some(
        (row) => hasFaceAttendanceSignal(row) || hasFingerprintAttendanceSignal(row)
      );

      if (!hasAnySignal) {
        missedDates.push(date);
      }
    }

    if (missedDates.length !== CONSECUTIVE_NO_SIGNAL_ALERT_DAYS) {
      return [];
    }

    const line = worker.currentLineId ? args.linesById.get(worker.currentLineId) : undefined;
    const lineText = line ? ` Current line: ${line.name} (${line.code}).` : "";
    const alertId = `derived-seven-day-no-signal-${worker.id}`;

    return [
      {
        id: alertId,
        type: "attendance anomaly",
        priority: "critical",
        title: "No face or fingerprint attendance for 7 days",
        description: `${worker.fullName} (${worker.employeeId}) has no face recognition or fingerprint attendance signal for seven consecutive attendance days (${firstDate} to ${lastDate}).${lineText}`,
        createdAt: toLocalTimestamp(lastDate, "00:00:00"),
        status: "Open",
        workerId: worker.id,
        lineId: worker.currentLineId,
        derived: true,
        history: [
          {
            id: `${alertId}-history`,
            timestamp: toLocalTimestamp(lastDate, "00:00:00"),
            user: "System",
            action:
              "Detected seven consecutive attendance days without face recognition or fingerprint verification.",
          },
        ],
      } satisfies AlertRecord,
    ];
  });
}

function mapLine(args: {
  line: ProductionLineRow;
  latestMetric?: ProductionLineMetricRow;
  latestIncentive?: IncentiveRecordRow;
  activeCount: number;
}): ProductionLineRecord {
  const targetManpower = args.line.target_manpower;
  const actualManpower = args.activeCount;
  const efficiency = Math.round(
    toNumber(
      typeof args.latestMetric?.actual_efficiency === "number"
        ? args.latestMetric.actual_efficiency * 100
        : args.latestMetric?.efficiency,
      args.line.current_efficiency
    )
  );
  const output = Math.round(
    toNumber(args.latestMetric?.actual_pcs, toNumber(args.latestMetric?.output, args.line.current_output))
  );
  const targetOutput = Math.round(
    toNumber(args.latestMetric?.planned_pcs, toNumber(args.latestMetric?.target_output, args.line.target_output))
  );

  let status: ProductionLineRecord["status"] = "Idle";
  let risk: ProductionLineRecord["risk"] = "Watch";

  if (actualManpower > 0 && actualManpower >= targetManpower) {
    status = "Active";
    risk = efficiency >= 85 && !args.line.issue ? "Stable" : "Watch";
  } else if (actualManpower > 0) {
    status = "Partial";
    risk = targetManpower - actualManpower >= 2 ? "Critical" : "Watch";
  } else if (args.line.issue) {
    risk = "Critical";
  }

  if (efficiency < 70 && actualManpower > 0) {
    risk = "Critical";
  }

  return {
    id: args.line.id,
    code: args.line.code,
    name: args.line.name,
    department: args.line.department_name,
    allocatedStyle: args.line.allocated_style || undefined,
    status,
    targetManpower,
    actualManpower,
    assignedWorkers: actualManpower,
    presentWorkers: 0,
    lateWorkers: 0,
    onLeaveWorkers: 0,
    absentWorkers: actualManpower,
    attendanceRate: 0,
    efficiency,
    output,
    targetOutput,
    shift: args.line.shift_name,
    supervisor: args.line.supervisor_name || "Unassigned",
    risk,
    issue: args.line.issue || undefined,
    latestMetricId: args.latestMetric?.id,
    latestMetricDate: args.latestMetric?.production_date || args.latestMetric?.metric_date,
    plannedMo: toNumber(args.latestMetric?.planned_mo),
    plannedHel: toNumber(args.latestMetric?.planned_hel),
    actualMo: toNumber(args.latestMetric?.actual_mo),
    actualHel: toNumber(args.latestMetric?.actual_hel),
    teamMembers: toNumber(args.latestMetric?.team_members),
    workingHours: toNumber(args.latestMetric?.working_hours),
    smv: toNumber(args.latestMetric?.smv),
    plannedPcs: toNumber(args.latestMetric?.planned_pcs),
    forecastPcs: toNumber(args.latestMetric?.forecast_pcs),
    actualPcs: toNumber(args.latestMetric?.actual_pcs),
    plannedCadreTotal: toNumber(args.latestMetric?.planned_cadre_total),
    actualCadreTotal: toNumber(args.latestMetric?.actual_cadre_total),
    clockHours: toNumber(args.latestMetric?.clock_hours),
    plannedSah: toNumber(args.latestMetric?.planned_sah),
    forecastSah: toNumber(args.latestMetric?.forecast_sah),
    actualSah: toNumber(args.latestMetric?.actual_sah),
    plannedEfficiencyRatio: toNumber(args.latestMetric?.planned_efficiency),
    forecastEfficiencyRatio: toNumber(args.latestMetric?.forecast_efficiency),
    actualEfficiencyRatio: toNumber(args.latestMetric?.actual_efficiency),
    pieceVariance: toNumber(args.latestMetric?.piece_variance),
    sahVariance: toNumber(args.latestMetric?.sah_variance),
    incentiveAmount:
      typeof args.latestIncentive?.incentive_amount === "number"
        ? args.latestIncentive.incentive_amount
        : undefined,
    incentiveBand: args.latestIncentive?.incentive_band_label || undefined,
    metricWarnings: Array.isArray(args.latestMetric?.warnings)
      ? args.latestMetric?.warnings.map((item) => String(item))
      : [],
    formulaRuleSetId: args.latestMetric?.formula_rule_set_id || undefined,
    formulaRuleVersion: args.latestMetric?.formula_rule_version || undefined,
    incentiveRuleSetId: args.latestIncentive?.incentive_rule_set_id || undefined,
    incentiveRuleVersion: args.latestIncentive?.incentive_rule_version || undefined,
  };
}

function mapLineOutputEntry(row: ProductionLineOutputEntryRow) {
  return {
    id: row.id,
    lineId: row.production_line_id,
    productionDate: row.production_date,
    entryTime: row.entry_time,
    outputQuantity: row.output_quantity,
    cumulativeOutput: row.cumulative_output,
    note: row.note || undefined,
    createdBy: row.created_by || undefined,
    createdAt: row.created_at,
  };
}

function toAttendanceRate(presentWorkers: number, lateWorkers: number, totalWorkers: number) {
  if (totalWorkers <= 0) {
    return 0;
  }

  return Math.round(((presentWorkers + lateWorkers) / totalWorkers) * 100);
}

function buildWeeklyAttendanceSeries(rows: FingerprintAttendanceRow[]): ReportSeriesPoint[] {
  const byDate = new Map<
    string,
    { label: string; value: number; secondaryValue: number; tertiaryValue: number }
  >();

  rows.forEach((row) => {
    const key = row.attendance_date;
    const entry =
      byDate.get(key) ||
      {
        label: key.slice(5),
        value: 0,
        secondaryValue: 0,
        tertiaryValue: 0,
      };

    if (row.attendance_state === "present" && toNumber(row.late_early_hours) <= 0) {
      entry.value += 1;
    }

    if (row.attendance_state === "present" && toNumber(row.late_early_hours) > 0) {
      entry.tertiaryValue += 1;
    }

    if (row.attendance_state !== "present") {
      entry.secondaryValue += 1;
    }

    byDate.set(key, entry);
  });

  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([, value]) => value);
}

function buildTransferSeries(logs: TransferLogRow[]): ReportSeriesPoint[] {
  const byDate = new Map<string, { label: string; value: number }>();

  logs.forEach((log) => {
    const date = log.transferred_at.slice(0, 10);
    const entry = byDate.get(date) || { label: date.slice(5), value: 0 };
    entry.value += 1;
    byDate.set(date, entry);
  });

  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([, value]) => value);
}

function buildDepartmentAttendance(
  workers: WorkerProfile[]
): DepartmentAttendanceSummary[] {
  const byDepartment = new Map<string, DepartmentAttendanceSummary>();

  workers.forEach((worker) => {
    const key = worker.department || "Unassigned";
    const entry =
      byDepartment.get(key) || {
        department: key,
        totalWorkers: 0,
        presentWorkers: 0,
        lateWorkers: 0,
        onLeaveWorkers: 0,
        absentWorkers: 0,
        attendanceRate: 0,
      };

    entry.totalWorkers += 1;

    if (worker.attendanceStatus === "Present") {
      entry.presentWorkers += 1;
    } else if (worker.attendanceStatus === "Late") {
      entry.lateWorkers += 1;
    } else if (worker.attendanceStatus === "On Leave") {
      entry.onLeaveWorkers += 1;
    } else {
      entry.absentWorkers += 1;
    }

    byDepartment.set(key, entry);
  });

  return Array.from(byDepartment.values())
    .map((entry) => ({
      ...entry,
      attendanceRate: toAttendanceRate(
        entry.presentWorkers,
        entry.lateWorkers,
        entry.totalWorkers
      ),
    }))
    .sort((a, b) => {
      if (b.totalWorkers !== a.totalWorkers) {
        return b.totalWorkers - a.totalWorkers;
      }
      return a.department.localeCompare(b.department);
    });
}

function buildAttendanceOverview(
  workers: WorkerProfile[],
  attendanceDate: string
): AttendanceOverview {
  const summary: AttendanceOverview = {
    attendanceDate,
    totalWorkers: workers.length,
    presentWorkers: 0,
    lateWorkers: 0,
    onLeaveWorkers: 0,
    absentWorkers: 0,
  };

  workers.forEach((worker) => {
    if (worker.attendanceStatus === "Present") {
      summary.presentWorkers += 1;
    } else if (worker.attendanceStatus === "Late") {
      summary.lateWorkers += 1;
    } else if (worker.attendanceStatus === "On Leave") {
      summary.onLeaveWorkers += 1;
    } else {
      summary.absentWorkers += 1;
    }
  });

  return summary;
}

function buildDepartmentAttendanceSeries(
  departments: DepartmentAttendanceSummary[]
): ReportSeriesPoint[] {
  return departments.map((department) => ({
    label: department.department,
    value: department.presentWorkers + department.lateWorkers,
    secondaryValue: department.totalWorkers,
    tertiaryValue: department.onLeaveWorkers,
  }));
}

function buildLineAttendanceSeries(lines: ProductionLineRecord[]): ReportSeriesPoint[] {
  return lines.map((line) => ({
    label: line.name,
    value: line.presentWorkers + line.lateWorkers,
    secondaryValue: line.assignedWorkers,
    tertiaryValue: line.absentWorkers,
  }));
}

function buildInsights(args: {
  lines: ProductionLineRecord[];
  alerts: AlertRecord[];
  workers: WorkerProfile[];
}): SmartInsight[] {
  const insights: SmartInsight[] = [];
  const understaffed = args.lines.filter(
    (line) => line.presentWorkers + line.lateWorkers < Math.max(1, line.targetManpower)
  );
  const openAlerts = args.alerts.filter((alert) => alert.status !== "Resolved");
  const absentWorkers = args.workers.filter((worker) => worker.attendanceStatus === "Absent");

  if (understaffed.length) {
    insights.push({
      id: "insight-understaffed",
      severity: understaffed.length >= 2 ? "critical" : "warning",
      title: "Line balancing required",
      description: `${understaffed.length} production line(s) are below their required attendance for the current shift.`,
      recommendation:
        "Review line assignments and re-balance available staff toward the lines with the biggest attendance gaps.",
      lineId: understaffed[0]?.id,
    });
  }

  if (openAlerts.length) {
    insights.push({
      id: "insight-alerts",
      severity: openAlerts.some((alert) => alert.priority === "critical") ? "critical" : "warning",
      title: "Operational alerts remain open",
      description: `${openAlerts.length} active alert(s) still need attention across validation and floor operations.`,
      recommendation: "Clear critical and high-priority alerts before the next attendance close window.",
      lineId: openAlerts[0]?.lineId,
    });
  }

  if (absentWorkers.length) {
    insights.push({
      id: "insight-attendance-gap",
      severity: absentWorkers.length >= 5 ? "warning" : "info",
      title: "Attendance gap detected",
      description: `${absentWorkers.length} worker record(s) are not currently clocked in on the latest fingerprint attendance snapshot.`,
      recommendation:
        "Check department attendance, reassign backup operators, and review unresolved leave or absence follow-up.",
    });
  }

  return insights;
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function monthStartKey(date: string) {
  return `${monthKey(date)}-01`;
}

function isPresentReconciliationStatus(row: ReconciliationRow) {
  const effectiveStatus = row.manual_override_status || row.reconciliation_status;
  if (["validated", "face_only", "fingerprint_only"].includes(effectiveStatus)) {
    return true;
  }
  return Boolean(row.face_first_seen || row.fingerprint_time_in || row.fingerprint_time_out);
}

function calculateMockIncentive(daysPresent: number) {
  if (daysPresent >= 24) return 14000;
  if (daysPresent >= 18) return daysPresent * 500;
  if (daysPresent >= 12) return daysPresent * 320;
  if (daysPresent >= 6) return daysPresent * 180;
  return daysPresent * 100;
}

function buildAttendanceSummaries(args: {
  workers: WorkerProfile[];
  profilesByEmployeeId: Map<string, EmployeeProfileRow>;
  fingerprintRowsByEmployeeCode: Map<string, FingerprintAttendanceRow[]>;
  validationRowsByEmployeeCode: Map<string, ReconciliationRow[]>;
  incentivesByEmployeeId: Map<string, IncentiveRecordRow[]>;
  latestDate: string;
}): AttendanceSummary[] {
  const activeMonth = monthKey(args.latestDate);

  return args.workers.map((worker) => {
    const fingerprintRows = (args.fingerprintRowsByEmployeeCode.get(worker.employeeId) || []).filter(
      (row) => monthKey(row.attendance_date) === activeMonth
    );
    const validationRows = (args.validationRowsByEmployeeCode.get(worker.employeeId) || []).filter(
      (row) => monthKey(row.attendance_date) === activeMonth
    );
    const profile = args.profilesByEmployeeId.get(worker.id);
    const incentiveRows = (args.incentivesByEmployeeId.get(worker.id) || []).filter(
      (record) => monthKey(record.month_start) === activeMonth
    );

    let daysPresent = 0;
    let daysAbsent = 0;
    let leaveDays = 0;
    let otHours = 0;
    let resolvedDays = 0;
    const fingerprintDates = new Set<string>();

    fingerprintRows.forEach((row) => {
      fingerprintDates.add(row.attendance_date);
      if (row.attendance_state === "present") {
        daysPresent += 1;
      } else if (row.attendance_state === "leave") {
        leaveDays += 1;
      } else {
        daysAbsent += 1;
      }

      otHours += toNumber(row.ot_hours);
    });

    validationRows.forEach((row) => {
      const effectiveStatus = row.manual_override_status || row.reconciliation_status;

      if (!fingerprintDates.has(row.attendance_date)) {
        if (effectiveStatus === "leave") {
          leaveDays += 1;
        } else if (effectiveStatus === "absent") {
          daysAbsent += 1;
        } else if (isPresentReconciliationStatus(row)) {
          daysPresent += 1;
        }

        otHours += toNumber(row.ot_hours);
      }

      if (!["needs_review", "anomaly"].includes(effectiveStatus)) {
        resolvedDays += 1;
      }
    });

    const importedIncentive = incentiveRows.reduce(
      (sum, record) => sum + toNumber(record.amount),
      0
    );
    const incentive =
      importedIncentive > 0 ? importedIncentive : calculateMockIncentive(daysPresent);
    const dailyRate = toNumber(profile?.daily_rate);
    const otRate = toNumber(profile?.ot_hourly_rate);

    return {
      id: `attendance-summary-${worker.id}-${activeMonth}`,
      workerId: worker.id,
      month: monthStartKey(args.latestDate),
      daysPresent,
      daysAbsent,
      otHours,
      leaveDays,
      incentive,
      finalTotal: daysPresent * dailyRate + otHours * otRate + incentive,
      validationRate: validationRows.length
        ? Math.round((resolvedDays / validationRows.length) * 100)
        : 0,
    };
  });
}

function buildOvertimeRecords(args: {
  workersByCode: Map<string, WorkerProfile>;
  activeAssignmentsByEmployeeId: Map<string, LineAssignmentRow>;
  rows: FingerprintAttendanceRow[];
}): OvertimeRecord[] {
  return args.rows
    .filter((row) => toNumber(row.ot_hours) > 0)
    .map((row) => {
      const worker = args.workersByCode.get(row.employee_code);
      const assignment = worker
        ? args.activeAssignmentsByEmployeeId.get(worker.id)
        : undefined;

      return {
        id: `ot-${row.id}`,
        workerId: worker?.id || row.employee_code,
        date: row.attendance_date,
        hours: toNumber(row.ot_hours),
        approvedBy: "Fingerprint Import",
        lineId: assignment?.production_line_id,
      };
    });
}

function buildLeaveRecords(args: {
  workersByCode: Map<string, WorkerProfile>;
  rows: FingerprintAttendanceRow[];
}) {
  return args.rows
    .filter((row) => row.attendance_state === "leave")
    .map((row) => {
      const worker = args.workersByCode.get(row.employee_code);
      return {
        id: `leave-${row.id}`,
        workerId: worker?.id || row.employee_code,
        type: row.leave_type || "Leave",
        startDate: row.attendance_date,
        endDate: row.attendance_date,
        days: 1,
        status: "Approved" as const,
      };
    });
}

export async function listActiveAppUsers(client: AppSupabaseClient) {
  const profiles = await listProfiles(client);
  return profiles.map(toAppUser);
}

export async function getOperationsSnapshot(
  client: AppSupabaseClient,
  options: {
    includeAuditLogs?: boolean;
    includeEmployeeNotes?: boolean;
    includeSystemSettings?: boolean;
    includeProfileDirectory?: boolean;
    syncReconciliationAlerts?: boolean;
    syncEmployeeStatusAlerts?: boolean;
  } = {}
): Promise<OperationsSnapshot> {
  if (options.syncReconciliationAlerts) {
    await runSyncReconciliationAlertsRpc(client);
  }
  if (options.syncEmployeeStatusAlerts) {
    try {
      await runSyncInactiveAbsenceAlertsRpc(client);
    } catch (syncError) {
      console.warn(
        "Employee inactive absence alert sync skipped:",
        syncError instanceof Error ? syncError.message : syncError
      );
    }
  }

  const sinceDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 60)
    .toISOString()
    .slice(0, 10);

  const [
    departments,
    employees,
    employeeRoster,
    employeeProfiles,
    employeeNotes,
    lines,
    lineAssignments,
    transferLogs,
    alerts,
    alertHistory,
    settingsRow,
    announcements,
    incentives,
    lineMetrics,
    lineOutputEntries,
    fingerprintRows,
    reconciliationRows,
    auditLogs,
    profiles,
  ] = await Promise.all([
    listDepartments(client).catch((departmentError) => {
      console.warn(
        "Department master load skipped:",
        departmentError instanceof Error ? departmentError.message : departmentError
      );
      return [] as DepartmentRow[];
    }),
    listEmployees(client),
    listEmployeeRoster(client).catch((rosterError) => {
      console.warn(
        "Full employee roster load skipped:",
        rosterError instanceof Error ? rosterError.message : rosterError
      );
      return [];
    }),
    listEmployeeProfiles(client),
    options.includeEmployeeNotes ? listEmployeeNotes(client) : Promise.resolve([]),
    listProductionLines(client),
    listLineAssignments(client),
    listTransferLogs(client),
    listOperationsAlerts(client),
    listOperationsAlertHistory(client),
    options.includeSystemSettings ? fetchSystemSettings(client) : Promise.resolve(null),
    listAnnouncements(client),
    listIncentiveRecords(client),
    listProductionLineMetrics(client, sinceDate),
    listProductionLineOutputEntries(client, sinceDate),
    listFingerprintAttendanceRows(client, sinceDate),
    listAttendanceReconciliationRows(client, sinceDate),
    options.includeAuditLogs ? listAuditLogs(client) : Promise.resolve([]),
    options.includeProfileDirectory ? listProfiles(client) : Promise.resolve([]),
  ]);

  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const employeeProfilesByEmployeeId = new Map(
    employeeProfiles.map((profile) => [profile.employee_id, profile])
  );
  const employeeNotesByEmployeeId = new Map<string, EmployeeNoteRow[]>();

  employeeNotes.forEach((note) => {
    const next = employeeNotesByEmployeeId.get(note.employee_id) || [];
    next.push(note);
    employeeNotesByEmployeeId.set(note.employee_id, next);
  });

  const activeAssignmentsByEmployeeId = new Map<string, LineAssignmentRow>();
  lineAssignments
    .filter((assignment) => assignment.status === "Active")
    .forEach((assignment) => {
      if (!activeAssignmentsByEmployeeId.has(assignment.employee_id)) {
        activeAssignmentsByEmployeeId.set(assignment.employee_id, assignment);
      }
    });

  const transfersByEmployeeId = new Map<string, TransferLogRow[]>();
  transferLogs.forEach((log) => {
    const next = transfersByEmployeeId.get(log.employee_id) || [];
    next.push(log);
    transfersByEmployeeId.set(log.employee_id, next);
  });

  const latestMetricsByLineId = new Map<string, ProductionLineMetricRow>();
  lineMetrics.forEach((metric) => {
    if (!latestMetricsByLineId.has(metric.production_line_id)) {
      latestMetricsByLineId.set(metric.production_line_id, metric);
    }
  });

  const latestIncentiveByMetricId = new Map<string, IncentiveRecordRow>();
  incentives
    .filter((record) => record.source_metric_record_id)
    .forEach((record) => {
      if (!latestIncentiveByMetricId.has(record.source_metric_record_id!)) {
        latestIncentiveByMetricId.set(record.source_metric_record_id!, record);
      }
    });

  const activeCountByLineId = new Map<string, number>();
  Array.from(activeAssignmentsByEmployeeId.values()).forEach((assignment) => {
    activeCountByLineId.set(
      assignment.production_line_id,
      (activeCountByLineId.get(assignment.production_line_id) || 0) + 1
    );
  });

  const baseLines = lines.map((line) =>
    mapLine({
      line,
      latestMetric: latestMetricsByLineId.get(line.id),
      latestIncentive: latestIncentiveByMetricId.get(latestMetricsByLineId.get(line.id)?.id || ""),
      activeCount: activeCountByLineId.get(line.id) || 0,
    })
  );

  const rowsByEmployeeCode = new Map<string, ReconciliationRow[]>();
  reconciliationRows.forEach((row) => {
    const next = rowsByEmployeeCode.get(row.employee_code) || [];
    next.push(row);
    rowsByEmployeeCode.set(row.employee_code, next);
  });

  const currentDate = currentAttendanceDate();
  const latestDataAttendanceDate = [
    reconciliationRows[0]?.attendance_date,
    fingerprintRows[0]?.attendance_date,
  ]
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);
  const latestAttendanceDate =
    latestDataAttendanceDate && latestDataAttendanceDate <= currentDate
      ? latestDataAttendanceDate
      : currentDate;
  const currentReconciliationRows = reconciliationRows.filter(
    (row) => row.attendance_date === latestAttendanceDate
  );
  const currentFingerprintRows = fingerprintRows.filter(
    (row) => row.attendance_date === latestAttendanceDate
  );

  const latestRowByEmployeeCode = new Map<string, ReconciliationRow>();
  currentReconciliationRows.forEach((row) => {
    if (!latestRowByEmployeeCode.has(row.employee_code)) {
      latestRowByEmployeeCode.set(row.employee_code, row);
    }
  });

  const fingerprintRowsByEmployeeCode = new Map<string, FingerprintAttendanceRow[]>();
  fingerprintRows.forEach((row) => {
    const next = fingerprintRowsByEmployeeCode.get(row.employee_code) || [];
    next.push(row);
    fingerprintRowsByEmployeeCode.set(row.employee_code, next);
  });

  const latestFingerprintRowByEmployeeCode = new Map<string, FingerprintAttendanceRow>();
  const fingerprintRowByEmployeeCodeAndDate = new Map<string, FingerprintAttendanceRow>();
  currentFingerprintRows.forEach((row) => {
    if (!latestFingerprintRowByEmployeeCode.has(row.employee_code)) {
      latestFingerprintRowByEmployeeCode.set(row.employee_code, row);
    }
    const key = `${row.employee_code}:${row.attendance_date}`;
    if (!fingerprintRowByEmployeeCodeAndDate.has(key)) {
      fingerprintRowByEmployeeCodeAndDate.set(key, row);
    }
  });

  const fingerprintDeviceAttendanceDate = latestAttendanceDate;
  const zktecoFingerprintEvents = await listZktecoFingerprintEventsForDate(
    client,
    fingerprintDeviceAttendanceDate
  );
  const fingerprintDeviceSummary = buildFingerprintDeviceSummary(
    zktecoFingerprintEvents,
    fingerprintDeviceAttendanceDate
  );
  const departmentsById = new Map(departments.map((department) => [department.id, department]));

  const mapEmployeeRowToWorker = (employee: EmployeeRow): WorkerProfile => {
    const profile = employeeProfilesByEmployeeId.get(employee.id);
    const notes = employeeNotesByEmployeeId.get(employee.id) || [];
    const latestRow = latestRowByEmployeeCode.get(employee.employee_code);
    const masterDepartment = employee.department_id
      ? departmentsById.get(employee.department_id)
      : undefined;
    const effectiveAttendanceDate = latestAttendanceDate;
    const sameDateFingerprintRow = fingerprintRowByEmployeeCodeAndDate.get(
      `${employee.employee_code}:${effectiveAttendanceDate}`
    );
    const latestFingerprintRow =
      sameDateFingerprintRow || latestFingerprintRowByEmployeeCode.get(employee.employee_code);
    const assignment = activeAssignmentsByEmployeeId.get(employee.id);
    const transfers = transfersByEmployeeId.get(employee.id) || [];
    const validationStatus = mapValidationStatus(latestRow, notes);
    const attendanceStatus = mapAttendanceStatus({
      fingerprintRow: latestFingerprintRow,
      reconciliationRow: latestRow,
    });
    const hasRecentTransfer =
      Boolean(transfers[0]) &&
      transfers[0].transferred_at.slice(0, 10) === effectiveAttendanceDate;

    return {
      id: employee.id,
      employeeId: employee.employee_code,
      epfNo: employee.epf_no || undefined,
      fullName:
        employee.display_name ||
        latestRow?.employee_name ||
        latestFingerprintRow?.employee_name ||
        employee.employee_code,
      photoUrl: profile?.photo_url || undefined,
      departmentId: employee.department_id || masterDepartment?.id || undefined,
      department:
        masterDepartment?.name ||
        employee.department_name ||
        latestRow?.department_name ||
        latestFingerprintRow?.department_name ||
        "Unassigned",
      roleTitle:
        latestRow?.designation ||
        latestFingerprintRow?.designation ||
        employee.designation ||
        "Worker",
      currentLineId: assignment?.production_line_id,
      shift: profile?.shift_name || "Shift A",
      attendanceStatus,
      faceVerificationStatus: mapFaceVerification(latestRow),
      fingerprintVerificationStatus: mapFingerprintVerification(
        latestFingerprintRow,
        latestRow
      ),
      finalValidationStatus: validationStatus,
      currentStatus: mapCurrentStatus({
        attendanceStatus,
        currentLineId: assignment?.production_line_id,
        hasRecentTransfer,
      }),
      skills: profile?.skills || [],
      notes: notes.filter((note) => note.note_type === "note").map((note) => note.note),
      flags: notes.filter((note) => note.note_type === "flag").map((note) => note.note),
      supervisorRemarks: notes
        .filter((note) => note.note_type === "remark")
        .map((note) => note.note),
      phone: profile?.phone || "Not set",
      joinDate: profile?.join_date || "",
      employmentStatus: employee.employment_status,
      hireDate: employee.hire_date || profile?.join_date || undefined,
      resignedAt: employee.resigned_at || undefined,
      resignationReason: employee.resignation_reason || undefined,
      hrNotes: employee.hr_notes || undefined,
    };
  };

  const mappedWorkers = employees.map(mapEmployeeRowToWorker);
  const mappedEmployeeRoster = employeeRoster.map(mapEmployeeRowToWorker);
  const activeEmployeeCountByDepartmentId = new Map<string, number>();
  mappedEmployeeRoster.forEach((worker) => {
    if (!worker.departmentId || worker.employmentStatus !== "active") {
      return;
    }
    activeEmployeeCountByDepartmentId.set(
      worker.departmentId,
      (activeEmployeeCountByDepartmentId.get(worker.departmentId) || 0) + 1
    );
  });
  const mappedDepartments = departments.map<DepartmentRecord>((department) => ({
    id: department.id,
    code: department.code || normalizeDepartmentCode(department.name),
    name: department.name,
    description: department.description || undefined,
    isActive: department.is_active ?? true,
    activeEmployees: activeEmployeeCountByDepartmentId.get(department.id) || 0,
  }));

  const lineAttendanceById = new Map<
    string,
    {
      assignedWorkers: number;
      presentWorkers: number;
      lateWorkers: number;
      onLeaveWorkers: number;
      absentWorkers: number;
    }
  >();

  mappedWorkers.forEach((worker) => {
    if (!worker.currentLineId) {
      return;
    }

    const current =
      lineAttendanceById.get(worker.currentLineId) || {
        assignedWorkers: 0,
        presentWorkers: 0,
        lateWorkers: 0,
        onLeaveWorkers: 0,
        absentWorkers: 0,
      };

    current.assignedWorkers += 1;

    if (worker.attendanceStatus === "Present") {
      current.presentWorkers += 1;
    } else if (worker.attendanceStatus === "Late") {
      current.lateWorkers += 1;
    } else if (worker.attendanceStatus === "On Leave") {
      current.onLeaveWorkers += 1;
    } else {
      current.absentWorkers += 1;
    }

    lineAttendanceById.set(worker.currentLineId, current);
  });

  const mappedLines = baseLines.map((line) => {
    const stats =
      lineAttendanceById.get(line.id) || {
        assignedWorkers: line.assignedWorkers,
        presentWorkers: 0,
        lateWorkers: 0,
        onLeaveWorkers: 0,
        absentWorkers: line.assignedWorkers,
      };
    const presentTotal = stats.presentWorkers + stats.lateWorkers;
    const status: ProductionLineRecord["status"] =
      stats.assignedWorkers === 0 || presentTotal === 0
        ? "Idle"
        : presentTotal >= Math.min(line.targetManpower, stats.assignedWorkers)
          ? "Active"
          : "Partial";
    const gap = Math.max(stats.assignedWorkers - presentTotal, 0);
    const risk: ProductionLineRecord["risk"] =
      gap >= 3 ? "Critical" : gap >= 1 ? "Watch" : "Stable";

    return {
      ...line,
      status,
      risk,
      actualManpower: stats.assignedWorkers,
      assignedWorkers: stats.assignedWorkers,
      presentWorkers: stats.presentWorkers,
      lateWorkers: stats.lateWorkers,
      onLeaveWorkers: stats.onLeaveWorkers,
      absentWorkers: stats.absentWorkers,
      attendanceRate: toAttendanceRate(
        stats.presentWorkers,
        stats.lateWorkers,
        stats.assignedWorkers
      ),
    };
  });

  const attendanceOverview = buildAttendanceOverview(mappedWorkers, latestAttendanceDate);
  const departmentAttendance = buildDepartmentAttendance(mappedWorkers);
  const linesById = new Map(mappedLines.map((line) => [line.id, line]));
  const workersById = new Map(mappedWorkers.map((worker) => [worker.id, worker]));
  const workersByCode = new Map(mappedWorkers.map((worker) => [worker.employeeId, worker]));

  const validationRecords = currentReconciliationRows.map<{
    id: string;
    workerId?: string;
    employeeId: string;
    workerName: string;
    date: string;
    shift: WorkerProfile["shift"];
    department: string;
    lineId?: string;
    faceEventTime?: string;
    fingerprintEventTime?: string;
    status: ValidationStatus;
    confidenceScore: number;
    exceptionReason?: string;
    timeline: TimelineEvent[];
  }>((row) => {
    const employee = employees.find((item) => item.employee_code === row.employee_code);
    const notes = employee ? employeeNotesByEmployeeId.get(employee.id) || [] : [];
    const transfers = employee ? transfersByEmployeeId.get(employee.id) || [] : [];
    const worker = employee ? workersById.get(employee.id) : undefined;

    return {
      id: row.id,
      workerId: employee?.id,
      employeeId: row.employee_code,
      workerName: row.employee_name || employee?.display_name || row.employee_code,
      date: row.attendance_date,
      shift: worker?.shift || "Shift A",
      department: row.department_name || employee?.department_name || "Unknown",
      lineId: worker?.currentLineId,
      faceEventTime: row.face_first_seen
        ? toLocalTimestamp(row.attendance_date, row.face_first_seen)
        : undefined,
      fingerprintEventTime: row.fingerprint_time_in
        ? toLocalTimestamp(row.attendance_date, row.fingerprint_time_in)
        : undefined,
      status: mapValidationStatus(row, notes),
      confidenceScore: mapConfidenceScore(row.confidence_level),
      exceptionReason: row.exception_reason || undefined,
      timeline: buildTimeline({ row, notes, transfers }),
    };
  });

  const lineAssignmentsForUi = lineAssignments.map((assignment) => ({
    id: assignment.id,
    workerId: assignment.employee_id,
    lineId: assignment.production_line_id,
    assignedAt: assignment.assigned_at,
    assignedBy:
      profilesById.get(assignment.assigned_by || "")?.full_name ||
      assignment.assigned_by ||
      "System",
    status: assignment.status,
  }));

  const transferLogsForUi = transferLogs.map((log) => ({
    id: log.id,
    workerId: log.employee_id,
    sourceLineId: log.source_line_id || undefined,
    destinationLineId: log.destination_line_id || undefined,
    reason: log.reason,
    transferredAt: log.transferred_at,
    transferredBy:
      profilesById.get(log.transferred_by || "")?.full_name ||
      log.transferred_by ||
      "System",
  }));

  const historyByAlertId = new Map<string, OperationsAlertHistoryRow[]>();
  alertHistory.forEach((entry) => {
    const next = historyByAlertId.get(entry.alert_id) || [];
    next.push(entry);
    historyByAlertId.set(entry.alert_id, next);
  });

  const persistedAlertsForUi = alerts.map<AlertRecord>((alert) => ({
    id: alert.id,
    type: alert.alert_type,
    priority: alert.priority,
    title: alert.title,
    description: alert.description,
    createdAt: alert.created_at,
    status: alert.status,
    assignedToUserId: alert.assigned_to_user_id || undefined,
    workerId: alert.employee_id || undefined,
    lineId: alert.line_id || undefined,
    history:
      (historyByAlertId.get(alert.id) || []).map((entry) => ({
        id: entry.id,
        timestamp: entry.created_at,
        user:
          profilesById.get(entry.actor_user_id || "")?.full_name ||
          entry.actor_user_id ||
          "System",
        action: entry.action,
      })) || [],
  }));
  const consecutiveNoSignalAlerts = buildConsecutiveNoSignalAlerts({
    workers: mappedWorkers,
    linesById,
    rowsByEmployeeCode,
    allReconciliationRows: reconciliationRows,
    latestAttendanceDate,
  });
  const alertsForUi = [...consecutiveNoSignalAlerts, ...persistedAlertsForUi].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );

  const attendanceSummaries = buildAttendanceSummaries({
    workers: mappedWorkers,
    profilesByEmployeeId: employeeProfilesByEmployeeId,
    fingerprintRowsByEmployeeCode,
    validationRowsByEmployeeCode: rowsByEmployeeCode,
    incentivesByEmployeeId: new Map(
      employees.map((employee) => [
        employee.id,
        incentives.filter((record) => record.employee_id === employee.id),
      ])
    ),
    latestDate: latestAttendanceDate,
  });

  const overtimeRecords = buildOvertimeRecords({
    workersByCode,
    activeAssignmentsByEmployeeId,
    rows: fingerprintRows,
  });

  const leaveRecords = buildLeaveRecords({
    workersByCode,
    rows: fingerprintRows,
  });

  const incentiveRecords = incentives
    .filter((record) => Boolean(record.employee_id))
    .map((record) => ({
      id: record.id,
      workerId: record.employee_id!,
      month: record.month_start,
      amount: toNumber(record.amount),
      reason: record.reason,
    }));

  const auditLogsForUi = auditLogs.map<AuditLogEntry>((entry: AuditLogRow) => ({
    id: entry.id,
    actionType: entry.action_type,
    user:
      profilesById.get(entry.actor_user_id || "")?.full_name ||
      entry.actor_user_id ||
      "System",
    timestamp: entry.created_at,
    targetEntity: entry.entity_id,
    oldValue: stringifyAuditValue(entry.old_value),
    newValue: stringifyAuditValue(entry.new_value),
  }));

  const mappedAnnouncements =
    announcements.length > 0
      ? announcements.map((announcement) => ({
          id: announcement.id,
          message: announcement.message,
        }))
      : [{ id: "announcement-empty", message: "No current announcements." }];

  const faceEvents = currentReconciliationRows
    .filter((row) => toNumber(row.face_event_count) > 0)
    .map<FaceEvent>((row) => ({
      id: `face-${row.id}`,
      workerId: workersByCode.get(row.employee_code)?.id,
      timestamp: toLocalTimestamp(row.attendance_date, row.face_first_seen),
      gate: "Face Import",
      confidence: row.confidence_level === "high" ? 96 : row.confidence_level === "medium" ? 76 : 48,
      outcome:
        toNumber(row.duplicate_face_event_count) > 0
          ? "duplicate"
          : "matched",
    }));

  const fingerprintEvents = currentReconciliationRows
    .filter((row) => row.fingerprint_time_in || row.fingerprint_time_out);

  const fingerprintEventsFromAttendance = currentFingerprintRows
    .filter((row) => row.time_in || row.time_out)
    .map<FingerprintEvent>((row) => ({
      id: `fingerprint-${row.id}`,
      workerId: workersByCode.get(row.employee_code)?.id,
      timestamp: toLocalTimestamp(row.attendance_date, row.time_in || row.time_out),
      gate: "Fingerprint Import",
      confidence: row.attendance_state === "present" ? 92 : 68,
      outcome: row.attendance_state === "review" ? "delayed" : "matched",
    }));

  const reportSeries = {
    weeklyAttendance: buildWeeklyAttendanceSeries(fingerprintRows),
    departmentAttendance: buildDepartmentAttendanceSeries(departmentAttendance),
    lineAttendance: buildLineAttendanceSeries(mappedLines),
    transferHistory: buildTransferSeries(transferLogs),
  };

  return {
    attendanceOverview,
    departmentAttendance,
    departments: mappedDepartments,
    workers: mappedWorkers,
    employeeRoster: mappedEmployeeRoster,
    lines: mappedLines,
    faceEvents,
    fingerprintDeviceSummary,
    fingerprintEvents:
      fingerprintEventsFromAttendance.length > 0
        ? fingerprintEventsFromAttendance
        : fingerprintEvents.map<FingerprintEvent>((row) => ({
            id: `fingerprint-${row.id}`,
            workerId: workersByCode.get(row.employee_code)?.id,
            timestamp: toLocalTimestamp(
              row.attendance_date,
              row.fingerprint_time_in || row.fingerprint_time_out
            ),
            gate: "Fingerprint Import",
            confidence:
              row.confidence_level === "high"
                ? 95
                : row.confidence_level === "medium"
                  ? 70
                  : 44,
            outcome:
              (row.manual_override_status || row.reconciliation_status) ===
              "fingerprint_only"
                ? "delayed"
                : "matched",
          })),
    validationRecords,
    lineAssignments: lineAssignmentsForUi,
    lineOutputEntries: lineOutputEntries.map(mapLineOutputEntry),
    transferLogs: transferLogsForUi,
    alerts: alertsForUi,
    attendanceSummaries,
    overtimeRecords,
    leaveRecords,
    incentiveRecords,
    auditLogs: auditLogsForUi,
    smartInsights: buildInsights({
      lines: mappedLines,
      alerts: alertsForUi,
      workers: mappedWorkers,
    }),
    announcements: mappedAnnouncements,
    settings: settingsRow
      ? {
          faceRecognition: settingsRow.face_recognition,
          fingerprintVerification: settingsRow.fingerprint_verification,
          dualValidationRequired: settingsRow.dual_validation_required,
          autoRejectUnknownFaces: settingsRow.auto_reject_unknown_faces,
          manualVerificationFallback: settingsRow.manual_verification_fallback,
          autoMarkAbsent: settingsRow.auto_mark_absent,
          morningShiftStart: settingsRow.morning_shift_start,
          morningShiftEnd: settingsRow.morning_shift_end,
          lateArrivalThreshold: settingsRow.late_arrival_threshold,
          gracePeriod: settingsRow.grace_period,
          failedEntryAlerts: settingsRow.failed_entry_alerts,
          lowEfficiencyWarnings: settingsRow.low_efficiency_warnings,
          workerAbsenceAlerts: settingsRow.worker_absence_alerts,
          dailySummaryReport: settingsRow.daily_summary_report,
        }
      : DEFAULT_SETTINGS,
    reportSeries,
  };
}

export async function createDepartmentRecord(
  client: AppSupabaseClient,
  args: DepartmentInput
): Promise<OperationsActionResult> {
  const name = cleanText(args.name);

  if (!name) {
    return { ok: false, message: "Department name is required." };
  }

  const department = await createDepartment(client, {
    code: normalizeDepartmentCode(args.code, name),
    name,
    description: cleanText(args.description),
    is_active: args.isActive ?? true,
  });

  await logAuditEvent(client, {
    actionType: "department_created_by_hr",
    entityType: "departments",
    entityId: department.id,
    newValue: {
      code: department.code,
      name: department.name,
      description: department.description,
      is_active: department.is_active,
    },
  });

  return {
    ok: true,
    message: `${department.name} department created.`,
  };
}

export async function updateDepartmentRecord(
  client: AppSupabaseClient,
  args: DepartmentInput & { departmentId: string }
): Promise<OperationsActionResult> {
  const name = cleanText(args.name);

  if (!name) {
    return { ok: false, message: "Department name is required." };
  }

  const department = await updateDepartment(client, args.departmentId, {
    code: normalizeDepartmentCode(args.code, name),
    name,
    description: cleanText(args.description),
    is_active: args.isActive ?? true,
    updated_at: new Date().toISOString(),
  });

  await logAuditEvent(client, {
    actionType: "department_updated_by_hr",
    entityType: "departments",
    entityId: department.id,
    newValue: {
      code: department.code,
      name: department.name,
      description: department.description,
      is_active: department.is_active,
    },
  });

  return {
    ok: true,
    message: `${department.name} department updated.`,
  };
}

export async function deactivateDepartmentRecord(
  client: AppSupabaseClient,
  args: { departmentId: string }
): Promise<OperationsActionResult> {
  const department = await deactivateDepartment(client, args.departmentId);

  await logAuditEvent(client, {
    actionType: "department_deactivated_by_hr",
    entityType: "departments",
    entityId: department.id,
    newValue: {
      code: department.code,
      name: department.name,
      is_active: department.is_active,
    },
  });

  return {
    ok: true,
    message: `${department.name} department deactivated.`,
  };
}

export async function createWorkerProfile(
  client: AppSupabaseClient,
  args: WorkerHrDetailsInput
): Promise<OperationsActionResult> {
  const employeeCode = normalizeEmployeeCode(args.employeeCode);
  const fullName = cleanText(args.fullName);
  const departmentId = cleanText(args.departmentId);
  const department = cleanText(args.department) || "Unassigned";
  const roleTitle = cleanText(args.roleTitle) || "Worker";
  const hireDate = cleanText(args.hireDate);

  if (!employeeCode) {
    return { ok: false, message: "Employee number is required." };
  }

  if (!fullName) {
    return { ok: false, message: "Employee full name is required." };
  }

  const employee = await createEmployee(client, {
    employee_code: employeeCode,
    epf_no: cleanText(args.epfNo),
    display_name: fullName,
    designation: roleTitle,
    department_id: departmentId,
    department_name: department,
    source_priority_name: "HR manual roster",
    employment_status: "active",
    hire_date: hireDate,
    hr_notes: cleanText(args.hrNotes),
    is_active: true,
  });

  await upsertEmployeeProfile(client, {
    employee_id: employee.id,
    shift_name: args.shift || "Shift A",
    phone: cleanText(args.phone),
    photo_url: cleanText(args.photoUrl),
    join_date: hireDate,
    skills: [],
  });

  if (cleanText(args.hrNotes)) {
    await createEmployeeNote(client, {
      employee_id: employee.id,
      note_type: "note",
      note: `HR onboarding note: ${cleanText(args.hrNotes)}`,
    });
  }

  await logAuditEvent(client, {
    actionType: "employee_created_by_hr",
    entityType: "employees",
    entityId: employee.id,
    newValue: {
      employee_code: employee.employee_code,
      display_name: employee.display_name,
      department_name: employee.department_name,
      department_id: employee.department_id,
      designation: employee.designation,
      hire_date: employee.hire_date,
    },
  });

  return {
    ok: true,
    message: `${employee.display_name || employee.employee_code} added to the active employee roster.`,
  };
}

export async function updateWorkerHrDetails(
  client: AppSupabaseClient,
  args: WorkerHrDetailsInput & { employeeId: string }
): Promise<OperationsActionResult> {
  const employeeCode = normalizeEmployeeCode(args.employeeCode);
  const fullName = cleanText(args.fullName);
  const departmentId = cleanText(args.departmentId);
  const department = cleanText(args.department) || "Unassigned";
  const roleTitle = cleanText(args.roleTitle) || "Worker";
  const hireDate = cleanText(args.hireDate);

  if (!employeeCode) {
    return { ok: false, message: "Employee number is required." };
  }

  if (!fullName) {
    return { ok: false, message: "Employee full name is required." };
  }

  const updated = await updateEmployee(client, args.employeeId, {
    employee_code: employeeCode,
    epf_no: cleanText(args.epfNo),
    display_name: fullName,
    designation: roleTitle,
    department_id: departmentId,
    department_name: department,
    hire_date: hireDate,
    hr_notes: cleanText(args.hrNotes),
    updated_at: new Date().toISOString(),
  });

  await upsertEmployeeProfile(client, {
    employee_id: args.employeeId,
    shift_name: args.shift || "Shift A",
    phone: cleanText(args.phone),
    photo_url: cleanText(args.photoUrl),
    join_date: hireDate,
  });

  await logAuditEvent(client, {
    actionType: "employee_hr_details_updated",
    entityType: "employees",
    entityId: args.employeeId,
    newValue: {
      employee_code: updated.employee_code,
      display_name: updated.display_name,
      department_name: updated.department_name,
      department_id: updated.department_id,
      designation: updated.designation,
      hire_date: updated.hire_date,
      hr_notes: updated.hr_notes,
    },
  });

  return {
    ok: true,
    message: `${updated.display_name || updated.employee_code} HR details updated.`,
  };
}

export async function resignWorkerProfile(
  client: AppSupabaseClient,
  args: {
    employeeId: string;
    resignedAt: string;
    reason: string;
    hrNotes?: string | null;
  }
): Promise<OperationsActionResult> {
  const resignedAt = cleanText(args.resignedAt);
  const reason = cleanText(args.reason);

  if (!resignedAt) {
    return { ok: false, message: "Resignation date is required." };
  }

  if (!reason) {
    return { ok: false, message: "Resignation reason is required." };
  }

  const result = await runResignEmployeeRpc(client, {
    employeeId: args.employeeId,
    resignedAt,
    reason,
    hrNotes: cleanText(args.hrNotes),
  });

  await createEmployeeNote(client, {
    employee_id: args.employeeId,
    note_type: "flag",
    note: `Resigned on ${resignedAt}: ${reason}`,
  });

  const closedAssignments = result.closed_assignments || 0;

  return {
    ok: true,
    message:
      closedAssignments > 0
        ? `Employee resigned and ${closedAssignments} active line assignment(s) were closed.`
      : "Employee resigned and removed from the active roster.",
  };
}

export async function updateWorkerEmploymentStatus(
  client: AppSupabaseClient,
  args: {
    employeeId: string;
    status: "active" | "inactive";
    reason?: string | null;
    hrNotes?: string | null;
  }
): Promise<OperationsActionResult> {
  const reason = cleanText(args.reason);
  const hrNotes = cleanText(args.hrNotes);

  if (args.status === "inactive") {
    const result = await runSetEmployeeInactiveRpc(client, {
      employeeId: args.employeeId,
      reason,
      hrNotes,
    });

    await createEmployeeNote(client, {
      employee_id: args.employeeId,
      note_type: "flag",
      note: reason ? `Marked inactive: ${reason}` : "Marked inactive by HR.",
    });

    const closedAssignments = result.closed_assignments || 0;
    return {
      ok: true,
      message:
        closedAssignments > 0
          ? `Employee marked inactive and ${closedAssignments} active line assignment(s) were closed.`
          : "Employee marked inactive and removed from the active roster.",
    };
  }

  await runReactivateEmployeeRpc(client, {
    employeeId: args.employeeId,
    hrNotes,
  });

  await createEmployeeNote(client, {
    employee_id: args.employeeId,
    note_type: "note",
    note: reason ? `Employee reactivated by HR: ${reason}` : "Employee reactivated by HR.",
  });

  return {
    ok: true,
    message: "Employee reactivated and returned to the active roster.",
  };
}

export async function assignWorkerToLine(
  client: AppSupabaseClient,
  args: {
    employeeId: string;
    lineId: string;
    reason?: string | null;
  }
): Promise<OperationsActionResult> {
  await runAssignWorkerToLineRpc(client, args);
  return {
    ok: true,
    message: "Worker assigned to the selected production line.",
  };
}

export async function transferWorkerBetweenLines(
  client: AppSupabaseClient,
  args: {
    employeeId: string;
    destinationLineId: string;
    reason: string;
  }
): Promise<OperationsActionResult> {
  await runTransferWorkerLineRpc(client, args);
  return {
    ok: true,
    message: "Worker transfer recorded successfully.",
  };
}

export async function updateProductionLineStyle(
  client: AppSupabaseClient,
  args: {
    lineId: string;
    allocatedStyle: string;
  }
): Promise<OperationsActionResult> {
  const trimmedStyle = args.allocatedStyle.trim();

  if (!trimmedStyle) {
    return { ok: false, message: "Allocated style is required." };
  }

  const existing = await fetchProductionLine(client, args.lineId);
  const updated = await updateProductionLine(client, args.lineId, {
    allocated_style: trimmedStyle,
  });

  await logAuditEvent(client, {
    actionType: "production_line_style_updated",
    entityType: "production_lines",
    entityId: args.lineId,
    oldValue: { allocated_style: existing.allocated_style },
    newValue: { allocated_style: updated.allocated_style },
  });

  return {
    ok: true,
    message: `Allocated style updated for ${updated.name}.`,
  };
}

export async function addProductionLineOutputEntry(
  client: AppSupabaseClient,
  args: {
    lineId: string;
    productionDate: string;
    entryTime: string;
    outputQuantity: number;
    note?: string;
    actorUserId: string;
  }
): Promise<OperationsActionResult> {
  const outputQuantity = Math.round(args.outputQuantity);

  if (!args.productionDate) {
    return { ok: false, message: "Production date is required." };
  }

  if (!args.entryTime) {
    return { ok: false, message: "Entry time is required." };
  }

  if (!Number.isFinite(outputQuantity) || outputQuantity <= 0) {
    return { ok: false, message: "Output quantity must be greater than zero." };
  }

  if (!isBackendConfigured()) {
    return { ok: false, message: "Backend URL is required before saving line output." };
  }

  const line = await fetchProductionLine(client, args.lineId);
  const existingEntries = await listProductionLineOutputEntriesForDay(
    client,
    args.lineId,
    args.productionDate
  );
  const cumulativeOutput =
    existingEntries.reduce((sum, entry) => sum + entry.output_quantity, 0) + outputQuantity;

  const entry = await createProductionLineOutputEntry(client, {
    production_line_id: args.lineId,
    production_date: args.productionDate,
    entry_time: args.entryTime,
    output_quantity: outputQuantity,
    cumulative_output: cumulativeOutput,
    note: args.note?.trim() || null,
    created_by: args.actorUserId,
  });

  const latestMetric = (await listProductionLineMetrics(client, args.productionDate)).find(
    (metric) =>
      metric.production_line_id === args.lineId &&
      (metric.production_date || metric.metric_date) === args.productionDate
  );

  const calculation = await saveCalculationFromBackend({
    productionLineId: args.lineId,
    productionDate: args.productionDate,
    shiftCode: latestMetric?.shift_code || line.shift_name,
    plannedMo: toNumber(latestMetric?.planned_mo, Math.max(line.target_manpower - 2, 0)),
    plannedHel: toNumber(latestMetric?.planned_hel, Math.min(line.target_manpower, 2)),
    actualMo: toNumber(latestMetric?.actual_mo, Math.max(line.target_manpower - 2, 0)),
    actualHel: toNumber(latestMetric?.actual_hel, Math.min(line.target_manpower, 2)),
    teamMembers: toNumber(latestMetric?.team_members, line.target_manpower),
    workingHours: toNumber(latestMetric?.working_hours, 8),
    smv: toNumber(latestMetric?.smv),
    plannedPcs: toNumber(latestMetric?.planned_pcs, line.target_output),
    forecastPcs: cumulativeOutput,
    actualPcs: cumulativeOutput,
    remarks: `Manual output entry ${outputQuantity} pcs at ${args.entryTime}`,
    lostTimeMinutes: toNumber(latestMetric?.lost_time_minutes),
    sourceMetadata: {
      source: "manual_line_output_entry",
      outputEntryId: entry.id,
      outputQuantity,
      cumulativeOutput,
      entryTime: args.entryTime,
    },
  });

  await updateProductionLine(client, args.lineId, {
    current_output: cumulativeOutput,
    current_efficiency: calculation.metrics.actualEfficiency * 100,
  });

  await updateProductionLineOutputEntry(client, entry.id, {
    cumulative_output: cumulativeOutput,
  });

  await logAuditEvent(client, {
    actionType: "production_line_output_added",
    entityType: "production_line_output_entries",
    entityId: entry.id,
    newValue: {
      production_line_id: args.lineId,
      production_date: args.productionDate,
      entry_time: args.entryTime,
      output_quantity: outputQuantity,
      cumulative_output: cumulativeOutput,
      metric_record_id: calculation.metricRecordId,
    },
  });

  return {
    ok: true,
    message: `Added ${outputQuantity} pcs. Current daily output is ${cumulativeOutput} pcs.`,
  };
}

export async function updateWorkerAttendanceStatus(
  client: AppSupabaseClient,
  args: {
    employeeId: string;
    employeeCode: string;
    status: "Present" | "Absent";
    actorUserId: string;
  }
): Promise<OperationsActionResult> {
  const latestAttendance = await fetchLatestFingerprintAttendanceForEmployee(
    client,
    args.employeeCode
  );

  if (!latestAttendance) {
    return {
      ok: false,
      message: "No fingerprint attendance row exists for this employee yet.",
    };
  }

  const nextAttendanceState: FingerprintAttendanceRow["attendance_state"] =
    args.status === "Present" ? "present" : "absent";
  const nextPayload: Database["public"]["Tables"]["fingerprint_daily_attendance"]["Update"] =
    args.status === "Present"
      ? {
          attendance_state: nextAttendanceState,
          time_in: latestAttendance.time_in || currentTimeText(),
          late_early_hours: 0,
          leave_type: null,
          leave_days_total: 0,
          nopay_days_total: 0,
          other_leave_days: 0,
          quality_flags: withManualAttendanceOverrideFlag(latestAttendance.quality_flags),
        }
      : {
          attendance_state: nextAttendanceState,
          time_in: null,
          time_out: null,
          late_early_hours: 0,
          leave_type: null,
          leave_days_total: 0,
          nopay_days_total: 0,
          other_leave_days: 0,
          quality_flags: withManualAttendanceOverrideFlag(latestAttendance.quality_flags),
        };

  const existingReconciliation = await fetchAttendanceReconciliationForEmployeeDate(
    client,
    args.employeeCode,
    latestAttendance.attendance_date
  );
  const updatedFingerprintRows = await updateFingerprintAttendanceRowsForEmployeeDate(
    client,
    args.employeeCode,
    latestAttendance.attendance_date,
    nextPayload
  );

  if (updatedFingerprintRows.length === 0) {
    return {
      ok: false,
      message: "No fingerprint attendance rows were updated.",
    };
  }

  const reconciliationStatus: ReconciliationRow["reconciliation_status"] =
    args.status === "Present" ? "validated" : "absent";
  const reconciliationPayload: Database["public"]["Tables"]["attendance_reconciliation"]["Update"] = {
    manually_overridden: true,
    manual_override_status: reconciliationStatus,
    manual_override_reason: `Temporary employee profile override to ${args.status}.`,
    manual_override_by: args.actorUserId,
    manual_override_at: new Date().toISOString(),
    fingerprint_time_in: args.status === "Present" ? updatedFingerprintRows[0].time_in : null,
    fingerprint_time_out: args.status === "Present" ? updatedFingerprintRows[0].time_out : null,
    late_early_hours: 0,
    leave_type: null,
  };
  const updatedReconciliation = existingReconciliation
    ? await updateAttendanceReconciliationForEmployeeDate(
        client,
        args.employeeCode,
        latestAttendance.attendance_date,
        reconciliationPayload
      )
    : null;

  await logAuditEvent(client, {
    actionType: "worker_attendance_status_overridden",
    entityType: "fingerprint_daily_attendance",
    entityId: args.employeeCode,
    oldValue: {
      employee_id: args.employeeId,
      employee_code: args.employeeCode,
      attendance_date: latestAttendance.attendance_date,
      attendance_state: latestAttendance.attendance_state,
      time_in: latestAttendance.time_in,
      time_out: latestAttendance.time_out,
      reconciliation_manual_override_status: existingReconciliation?.manual_override_status || null,
    },
    newValue: {
      employee_id: args.employeeId,
      employee_code: args.employeeCode,
      attendance_date: latestAttendance.attendance_date,
      attendance_state: nextAttendanceState,
      time_in: updatedFingerprintRows[0].time_in,
      time_out: updatedFingerprintRows[0].time_out,
      updated_fingerprint_rows: updatedFingerprintRows.length,
      reconciliation_manual_override_status: updatedReconciliation?.manual_override_status || null,
    },
  });

  return {
    ok: true,
    message: `Attendance temporarily marked as ${args.status}. Updated ${updatedFingerprintRows.length} database row(s).`,
    attendanceOverride: {
      workerId: args.employeeId,
      status: args.status,
    },
  };
}

export async function addWorkerNote(
  client: AppSupabaseClient,
  args: {
    employeeId: string;
    note: string;
  }
): Promise<OperationsActionResult> {
  const trimmedNote = args.note.trim();

  if (!trimmedNote) {
    return { ok: false, message: "A note is required." };
  }

  await createEmployeeNote(client, {
    employee_id: args.employeeId,
    note_type: "note",
    note: trimmedNote,
  });
  await logAuditEvent(client, {
    actionType: "worker_note_added",
    entityType: "employees",
    entityId: args.employeeId,
    newValue: { note: trimmedNote },
  });

  return { ok: true, message: "Worker note added." };
}

export async function markWorkerException(
  client: AppSupabaseClient,
  args: {
    employeeId: string;
    note: string;
  }
): Promise<OperationsActionResult> {
  const trimmedNote = args.note.trim();

  if (!trimmedNote) {
    return { ok: false, message: "An exception reason is required." };
  }

  await createEmployeeNote(client, {
    employee_id: args.employeeId,
    note_type: "flag",
    note: trimmedNote,
  });
  await logAuditEvent(client, {
    actionType: "worker_exception_flagged",
    entityType: "employees",
    entityId: args.employeeId,
    newValue: { flag: trimmedNote },
  });

  return { ok: true, message: "Worker exception flagged." };
}

export async function updateAlertStatus(
  client: AppSupabaseClient,
  args: {
    alertId: string;
    status: AlertRecord["status"];
    actorUserId: string;
  }
): Promise<OperationsActionResult> {
  const existing = await fetchOperationsAlert(client, args.alertId);
  const updated = await updateOperationsAlert(client, args.alertId, {
    status: args.status,
  });

  await createOperationsAlertHistory(client, {
    alert_id: args.alertId,
    actor_user_id: args.actorUserId,
    action: `Status changed to ${args.status}`,
  });

  await logAuditEvent(client, {
    actionType: "operations_alert_status_updated",
    entityType: "operations_alerts",
    entityId: args.alertId,
    oldValue: { status: existing.status },
    newValue: { status: updated.status },
  });

  return {
    ok: true,
    message: `Alert updated to ${args.status}.`,
  };
}

export async function assignAlert(
  client: AppSupabaseClient,
  args: {
    alertId: string;
    assignedToUserId: string;
    actorUserId: string;
  }
): Promise<OperationsActionResult> {
  const existing = await fetchOperationsAlert(client, args.alertId);
  const updated = await updateOperationsAlert(client, args.alertId, {
    assigned_to_user_id: args.assignedToUserId,
  });

  await createOperationsAlertHistory(client, {
    alert_id: args.alertId,
    actor_user_id: args.actorUserId,
    action: "Alert reassigned",
  });

  await logAuditEvent(client, {
    actionType: "operations_alert_assigned",
    entityType: "operations_alerts",
    entityId: args.alertId,
    oldValue: { assigned_to_user_id: existing.assigned_to_user_id },
    newValue: { assigned_to_user_id: updated.assigned_to_user_id },
  });

  return { ok: true, message: "Alert assignment updated." };
}

export async function updateOperationalSetting<K extends keyof SystemSettings>(
  client: AppSupabaseClient,
  args: {
    key: K;
    value: SystemSettings[K];
  }
): Promise<OperationsActionResult> {
  const current = await fetchSystemSettings(client);

  if (!current) {
    return { ok: false, message: "System settings row was not found." };
  }

  const fieldMap: Record<keyof SystemSettings, keyof typeof current> = {
    faceRecognition: "face_recognition",
    fingerprintVerification: "fingerprint_verification",
    dualValidationRequired: "dual_validation_required",
    autoRejectUnknownFaces: "auto_reject_unknown_faces",
    manualVerificationFallback: "manual_verification_fallback",
    autoMarkAbsent: "auto_mark_absent",
    morningShiftStart: "morning_shift_start",
    morningShiftEnd: "morning_shift_end",
    lateArrivalThreshold: "late_arrival_threshold",
    gracePeriod: "grace_period",
    failedEntryAlerts: "failed_entry_alerts",
    lowEfficiencyWarnings: "low_efficiency_warnings",
    workerAbsenceAlerts: "worker_absence_alerts",
    dailySummaryReport: "daily_summary_report",
  };

  const dbField = fieldMap[args.key];
  const updated = await updateSystemSettings(client, {
    [dbField]: args.value,
  });

  await logAuditEvent(client, {
    actionType: "system_setting_updated",
    entityType: "system_settings",
    entityId: "true",
    oldValue: { [dbField]: current[dbField] },
    newValue: { [dbField]: updated[dbField] },
  });

  return {
    ok: true,
    message: `${args.key} updated.`,
  };
}
