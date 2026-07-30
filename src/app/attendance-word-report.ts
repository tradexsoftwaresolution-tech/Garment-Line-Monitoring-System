import {
  hasFaceAttendance,
  hasFingerprintAttendance,
} from "./attendance-reporting";
import {
  currentAttendanceDateKey,
  isDateKeyInAttendanceDay,
} from "./alert-dates";
import type {
  AlertRecord,
  AttendanceOverview,
  AttendanceSummary,
  DepartmentAttendanceSummary,
  FaceEvent,
  FingerprintDeviceSummary,
  FingerprintEvent,
  LeaveRecord,
  ProductionLineRecord,
  ValidationRecord,
  WorkerProfile,
} from "./types";
import type { HikvisionRecognitionEvent } from "@/types/hikvision";
import type { ZktecoFingerprintEvent } from "@/types/zkteco";
import { requireSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

export interface AttendanceWordReportInput {
  generatedAt: Date;
  attendanceOverview: AttendanceOverview;
  departmentAttendance: DepartmentAttendanceSummary[];
  workers: WorkerProfile[];
  lines: ProductionLineRecord[];
  validationRecords: ValidationRecord[];
  faceEvents: FaceEvent[];
  fingerprintEvents: FingerprintEvent[];
  fingerprintDeviceSummary: FingerprintDeviceSummary;
  attendanceSummaries: AttendanceSummary[];
  leaveRecords: LeaveRecord[];
  alerts: AlertRecord[];
  rawFaceEvents?: HikvisionRecognitionEvent[];
  rawFingerprintEvents?: ZktecoFingerprintEvent[];
  backendNotes?: string[];
}

type EmployeeRow = Database["public"]["Tables"]["employees"]["Row"];
type AttendanceReconciliationRow =
  Database["public"]["Tables"]["attendance_reconciliation"]["Row"];
type ZktecoFingerprintEventRow =
  Database["public"]["Tables"]["zkteco_fingerprint_events"]["Row"];

type HikvisionFaceEventRow = {
  employee_code: string | null;
  match_status: "matched" | "unmatched" | string;
  event_time: string;
};

export type DailySummaryReportDay = {
  attendanceDate: string;
  generatedAt: Date;
  totalWorkers: number;
  presentWorkers: number;
  lateWorkers: number;
  absentWorkers: number;
  onLeaveWorkers: number;
  faceAttendedWorkers: number;
  faceNotAttendedWorkers: number;
  fingerprintAttendedRegisteredWorkers: number;
  fingerprintNotAttendedRegisteredWorkers: number;
  fingerprintDevicePinsCounted: number;
  unregisteredFingerprintPins: number;
  missingBothFaceAndFingerprint: number;
  rawMatchedFaceEvents: number;
  rawUnmatchedFaceEvents: number;
  rawMatchedFingerprintEvents: number;
  rawUnmatchedFingerprintEvents: number;
};

export interface DailySummaryRangeWordReportInput {
  generatedAt: Date;
  dateFrom: string;
  dateTo: string;
  days: DailySummaryReportDay[];
}

const REPORT_TITLE = "LineMatrix Full Attendance Verification Report";
const DAILY_SUMMARY_REPORT_TITLE = "LineMatrix Daily Attendance Summary Report";
const LATE_CUTOFF_TIME = "08:00:00";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function findLine(lines: ProductionLineRecord[], lineId?: string) {
  return lines.find((line) => line.id === lineId);
}

function findWorker(workers: WorkerProfile[], workerId?: string) {
  return workers.find((worker) => worker.id === workerId);
}

function row(values: unknown[]) {
  return `<tr>${values.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`;
}

function table(headers: string[], rows: unknown[][], emptyMessage = "No records available.") {
  const bodyRows = rows.length ? rows.map(row).join("") : row([emptyMessage]);
  const emptyColspan = rows.length ? "" : ` colspan="${headers.length}"`;

  return `
    <table>
      <thead>
        <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${
          rows.length
            ? bodyRows
            : `<tr><td${emptyColspan}>${escapeHtml(emptyMessage)}</td></tr>`
        }
      </tbody>
    </table>
  `;
}

function section(title: string, subtitle: string | null, content: string) {
  return `
    <section>
      <h2>${escapeHtml(title)}</h2>
      ${subtitle ? `<p class="section-subtitle">${escapeHtml(subtitle)}</p>` : ""}
      ${content}
    </section>
  `;
}

function downloadWordDocument(filename: string, html: string) {
  const blob = new Blob(["\ufeff", html], {
    type: "application/msword;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function filenameDate(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function buildWorkerRows(workers: WorkerProfile[], lines: ProductionLineRecord[]) {
  return workers.map((worker) => {
    const line = findLine(lines, worker.currentLineId);
    return [
      worker.employeeId,
      worker.fullName,
      worker.department,
      worker.roleTitle,
      line ? `${line.name} / ${line.code}` : "Unassigned",
      worker.shift,
      worker.attendanceStatus,
      hasFaceAttendance(worker) ? "Attended" : "Not attended",
      hasFingerprintAttendance(worker) ? "Attended" : "Not attended",
      worker.finalValidationStatus,
      worker.phone,
    ];
  });
}

function buildValidationRows(records: ValidationRecord[], lines: ProductionLineRecord[]) {
  return [...records]
    .sort((a, b) => `${a.date}${a.employeeId}`.localeCompare(`${b.date}${b.employeeId}`))
    .map((record) => {
      const line = findLine(lines, record.lineId);
      return [
        formatDate(record.date),
        record.employeeId,
        record.workerName,
        record.department,
        line ? `${line.name} / ${line.code}` : "Unassigned",
        record.shift,
        formatDateTime(record.faceEventTime),
        formatDateTime(record.fingerprintEventTime),
        record.status,
        `${record.confidenceScore}%`,
        record.exceptionReason || "",
      ];
    });
}

function buildRawFaceRows(events: HikvisionRecognitionEvent[]) {
  return events.map((event) => [
    formatDateTime(event.eventTime),
    event.employeeNo || event.serialNo || "",
    event.devicePersonName || "",
    event.matchedEmployeeName || "",
    event.matchedDepartment || "",
    event.matchStatus,
    event.cameraName || "",
    event.cameraLocation || "",
    event.cameraBaseUrl || "",
    event.accessDecision || event.attendanceStatus || "",
  ]);
}

function buildSystemFaceRows(events: FaceEvent[], workers: WorkerProfile[]) {
  return [...events]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((event) => {
      const worker = findWorker(workers, event.workerId);
      return [
        formatDateTime(event.timestamp),
        worker?.employeeId || "",
        worker?.fullName || "",
        worker?.department || "",
        event.gate,
        event.confidence,
        event.outcome,
      ];
    });
}

function buildRawFingerprintRows(events: ZktecoFingerprintEvent[]) {
  return events.map((event) => [
    formatDateTime(event.event_time),
    event.employee_pin,
    event.employee_code || "",
    event.matched_employee_name || "",
    event.matched_department || "",
    event.match_status,
    event.device_ip || "",
    event.device_serial_no || "",
    event.punch_time,
    event.verify_mode || "",
  ]);
}

function buildSystemFingerprintRows(events: FingerprintEvent[], workers: WorkerProfile[]) {
  return [...events]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((event) => {
      const worker = findWorker(workers, event.workerId);
      return [
        formatDateTime(event.timestamp),
        worker?.employeeId || "",
        worker?.fullName || "",
        worker?.department || "",
        event.gate,
        event.confidence,
        event.outcome,
      ];
    });
}

function normalizeEmployeeCode(value?: string | null) {
  return String(value || "").trim();
}

function normalizePin(value?: string | null) {
  return String(value || "").trim();
}

function parseDateInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function listDateRange(dateFrom: string, dateTo: string) {
  const start = parseDateInput(dateFrom);
  const end = parseDateInput(dateTo);
  const dates: string[] = [];

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return dates;
  }

  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function sriLankaDateKey(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return year && month && day ? `${year}-${month}-${day}` : String(value).slice(0, 10);
}

function hasPositiveFaceCount(row: AttendanceReconciliationRow) {
  return Boolean(row.face_first_seen || (row.face_event_count || 0) > 0);
}

function hasPositiveFingerprintCount(row: AttendanceReconciliationRow) {
  return Boolean(row.fingerprint_time_in || row.fingerprint_time_out);
}

function timePortion(value?: string | null) {
  if (!value) return "";
  const text = String(value);
  if (text.includes("T")) {
    return text.split("T")[1]?.slice(0, 8) || "";
  }
  return text.slice(0, 8);
}

function isLateByReconciliation(row: AttendanceReconciliationRow) {
  if ((row.late_early_hours || 0) > 0) return true;
  const faceTime = timePortion(row.face_first_seen);
  return Boolean(faceTime && faceTime > LATE_CUTOFF_TIME && !hasPositiveFingerprintCount(row));
}

function effectiveReconciliationStatus(row: AttendanceReconciliationRow) {
  return row.manual_override_status || row.reconciliation_status;
}

function countAttendanceState(row?: AttendanceReconciliationRow) {
  if (!row) return "absent";
  const status = effectiveReconciliationStatus(row);
  if (status === "leave") return "leave";
  if (status === "absent") return "absent";
  if (hasPositiveFaceCount(row) || hasPositiveFingerprintCount(row)) {
    return isLateByReconciliation(row) ? "late" : "present";
  }
  return "absent";
}

function buildDailySummaryRows(day: DailySummaryReportDay) {
  return [
    ["Attendance date", day.attendanceDate],
    ["Generated at", formatDateTime(day.generatedAt)],
    ["Total workers", day.totalWorkers],
    ["Present workers", day.presentWorkers],
    ["Late workers", day.lateWorkers],
    ["Absent workers", day.absentWorkers],
    ["On leave workers", day.onLeaveWorkers],
    ["Face attended workers", day.faceAttendedWorkers],
    ["Face not attended workers", day.faceNotAttendedWorkers],
    ["Fingerprint attended registered workers", day.fingerprintAttendedRegisteredWorkers],
    ["Fingerprint not attended registered workers", day.fingerprintNotAttendedRegisteredWorkers],
    ["Fingerprint device PINs counted", day.fingerprintDevicePinsCounted],
    ["Unregistered fingerprint PINs", day.unregisteredFingerprintPins],
    ["Missing both face and fingerprint", day.missingBothFaceAndFingerprint],
    ["Raw matched face events", day.rawMatchedFaceEvents],
    ["Raw unmatched face events", day.rawUnmatchedFaceEvents],
    ["Raw matched fingerprint events", day.rawMatchedFingerprintEvents],
    ["Raw unmatched fingerprint events", day.rawUnmatchedFingerprintEvents],
  ];
}

function makeDailySummary(
  attendanceDate: string,
  activeEmployeeCodes: Set<string>,
  reconciliationRows: AttendanceReconciliationRow[],
  faceEvents: HikvisionFaceEventRow[],
  fingerprintEvents: ZktecoFingerprintEventRow[],
  generatedAt: Date
): DailySummaryReportDay {
  const reconciliationByEmployee = new Map<string, AttendanceReconciliationRow>();
  reconciliationRows.forEach((row) => {
    const employeeCode = normalizeEmployeeCode(row.employee_code);
    if (employeeCode) reconciliationByEmployee.set(employeeCode, row);
  });

  let presentWorkers = 0;
  let lateWorkers = 0;
  let absentWorkers = 0;
  let onLeaveWorkers = 0;

  activeEmployeeCodes.forEach((employeeCode) => {
    const state = countAttendanceState(reconciliationByEmployee.get(employeeCode));
    if (state === "present") presentWorkers += 1;
    if (state === "late") lateWorkers += 1;
    if (state === "absent") absentWorkers += 1;
    if (state === "leave") onLeaveWorkers += 1;
  });

  const faceAttendedCodes = new Set<string>();
  reconciliationRows.forEach((row) => {
    const employeeCode = normalizeEmployeeCode(row.employee_code);
    if (employeeCode && activeEmployeeCodes.has(employeeCode) && hasPositiveFaceCount(row)) {
      faceAttendedCodes.add(employeeCode);
    }
  });
  faceEvents.forEach((event) => {
    const employeeCode = normalizeEmployeeCode(event.employee_code);
    if (employeeCode && activeEmployeeCodes.has(employeeCode) && event.match_status === "matched") {
      faceAttendedCodes.add(employeeCode);
    }
  });

  const fingerprintAttendedCodes = new Set<string>();
  reconciliationRows.forEach((row) => {
    const employeeCode = normalizeEmployeeCode(row.employee_code);
    if (employeeCode && activeEmployeeCodes.has(employeeCode) && hasPositiveFingerprintCount(row)) {
      fingerprintAttendedCodes.add(employeeCode);
    }
  });
  fingerprintEvents.forEach((event) => {
    const employeeCode = normalizeEmployeeCode(event.employee_code);
    if (employeeCode && activeEmployeeCodes.has(employeeCode) && event.match_status === "matched") {
      fingerprintAttendedCodes.add(employeeCode);
    }
  });

  const devicePins = new Map<string, ZktecoFingerprintEventRow[]>();
  fingerprintEvents.forEach((event) => {
    const pin = normalizePin(event.employee_pin);
    if (!pin) return;
    const rows = devicePins.get(pin) || [];
    rows.push(event);
    devicePins.set(pin, rows);
  });

  let unregisteredFingerprintPins = 0;
  devicePins.forEach((eventsForPin) => {
    const hasRegisteredMatch = eventsForPin.some((event) => {
      const employeeCode = normalizeEmployeeCode(event.employee_code);
      return employeeCode && activeEmployeeCodes.has(employeeCode) && event.match_status === "matched";
    });
    if (!hasRegisteredMatch) unregisteredFingerprintPins += 1;
  });

  const rawMatchedFaceEvents = faceEvents.filter((event) => event.match_status === "matched").length;
  const rawMatchedFingerprintEvents = fingerprintEvents.filter(
    (event) => event.match_status === "matched"
  ).length;

  const missingBothFaceAndFingerprint = [...activeEmployeeCodes].filter(
    (employeeCode) =>
      !faceAttendedCodes.has(employeeCode) && !fingerprintAttendedCodes.has(employeeCode)
  ).length;

  return {
    attendanceDate,
    generatedAt,
    totalWorkers: activeEmployeeCodes.size,
    presentWorkers,
    lateWorkers,
    absentWorkers,
    onLeaveWorkers,
    faceAttendedWorkers: faceAttendedCodes.size,
    faceNotAttendedWorkers: Math.max(activeEmployeeCodes.size - faceAttendedCodes.size, 0),
    fingerprintAttendedRegisteredWorkers: fingerprintAttendedCodes.size,
    fingerprintNotAttendedRegisteredWorkers: Math.max(
      activeEmployeeCodes.size - fingerprintAttendedCodes.size,
      0
    ),
    fingerprintDevicePinsCounted: devicePins.size,
    unregisteredFingerprintPins,
    missingBothFaceAndFingerprint,
    rawMatchedFaceEvents,
    rawUnmatchedFaceEvents: faceEvents.length - rawMatchedFaceEvents,
    rawMatchedFingerprintEvents,
    rawUnmatchedFingerprintEvents: fingerprintEvents.length - rawMatchedFingerprintEvents,
  };
}

export async function fetchDailySummaryRangeReport(input: {
  dateFrom: string;
  dateTo: string;
  generatedAt: Date;
}) {
  const dates = listDateRange(input.dateFrom, input.dateTo);
  if (!dates.length) {
    throw new Error("Select a valid date range.");
  }

  const supabase = requireSupabaseBrowserClient();
  const faceFrom = `${input.dateFrom}T00:00:00+05:30`;
  const faceTo = `${input.dateTo}T23:59:59.999+05:30`;

  const [employeeResult, reconciliationResult, fingerprintResult, faceResult] =
    await Promise.all([
      supabase
        .from("employees")
        .select("employee_code")
        .eq("is_active", true)
        .range(0, 20000),
      supabase
        .from("attendance_reconciliation")
        .select(
          "employee_code,attendance_date,face_first_seen,face_event_count,fingerprint_time_in,fingerprint_time_out,late_early_hours,leave_type,reconciliation_status,manual_override_status"
        )
        .gte("attendance_date", input.dateFrom)
        .lte("attendance_date", input.dateTo)
        .range(0, 50000),
      supabase
        .from("zkteco_fingerprint_events")
        .select("employee_pin,employee_code,match_status,attendance_date,event_time")
        .gte("attendance_date", input.dateFrom)
        .lte("attendance_date", input.dateTo)
        .range(0, 50000),
      (supabase as any)
        .from("hikvision_face_events")
        .select("employee_code,match_status,event_time")
        .gte("event_time", faceFrom)
        .lte("event_time", faceTo)
        .range(0, 50000),
    ]);

  if (employeeResult.error) throw employeeResult.error;
  if (reconciliationResult.error) throw reconciliationResult.error;
  if (fingerprintResult.error) throw fingerprintResult.error;
  if (faceResult.error) throw faceResult.error;

  const activeEmployeeCodes = new Set(
    ((employeeResult.data || []) as Pick<EmployeeRow, "employee_code">[])
      .map((employee) => normalizeEmployeeCode(employee.employee_code))
      .filter(Boolean)
  );
  const reconciliationRows = (reconciliationResult.data || []) as AttendanceReconciliationRow[];
  const fingerprintRows = (fingerprintResult.data || []) as ZktecoFingerprintEventRow[];
  const faceRows = (faceResult.data || []) as HikvisionFaceEventRow[];

  return dates.map((date) =>
    makeDailySummary(
      date,
      activeEmployeeCodes,
      reconciliationRows.filter((row) => row.attendance_date === date),
      faceRows.filter((event) => sriLankaDateKey(event.event_time) === date),
      fingerprintRows.filter((event) => event.attendance_date === date),
      input.generatedAt
    )
  );
}

export function downloadDailySummaryRangeWordReport(input: DailySummaryRangeWordReportInput) {
  const dailySections = input.days
    .map((day) =>
      section(
        `Executive Summary - ${day.attendanceDate}`,
        "High-level attendance and verification totals for this attendance date.",
        table(["Metric", "Value"], buildDailySummaryRows(day))
      )
    )
    .join("");

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(DAILY_SUMMARY_REPORT_TITLE)}</title>
        <style>
          @page {
            margin: 0.55in;
          }
          body {
            color: #111827;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
            font-size: 10.5pt;
            line-height: 1.38;
          }
          h1 {
            color: #0f172a;
            font-size: 24pt;
            margin: 0 0 8pt;
          }
          h2 {
            border-bottom: 1px solid #cbd5e1;
            color: #0f172a;
            font-size: 15pt;
            margin: 20pt 0 6pt;
            padding-bottom: 4pt;
          }
          p {
            margin: 4pt 0 8pt;
          }
          .meta,
          .section-subtitle {
            color: #475569;
          }
          table {
            border-collapse: collapse;
            margin: 8pt 0 12pt;
            width: 100%;
          }
          th {
            background: #eaf2ff;
            color: #1e3a8a;
            font-weight: 700;
            text-align: left;
          }
          th,
          td {
            border: 1px solid #cbd5e1;
            padding: 5pt 6pt;
            vertical-align: top;
          }
          tr:nth-child(even) td {
            background: #f8fafc;
          }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(DAILY_SUMMARY_REPORT_TITLE)}</h1>
        <p class="meta">
          Date range: ${escapeHtml(input.dateFrom)} to ${escapeHtml(input.dateTo)}
          | Generated: ${escapeHtml(formatDateTime(input.generatedAt))}
        </p>
        <p>
          This report creates one executive attendance summary table per day in the selected
          range. Counts combine registered employee reconciliation records, saved face events,
          saved fingerprint events, and unregistered device PIN totals.
        </p>
        ${dailySections}
      </body>
    </html>
  `;

  downloadWordDocument(
    `daily-attendance-summary-${filenameDate(input.dateFrom)}-to-${filenameDate(input.dateTo)}.doc`,
    html
  );
}

export function downloadFullAttendanceWordReport(input: AttendanceWordReportInput) {
  const faceAttended = input.workers.filter(hasFaceAttendance);
  const fingerprintAttended = input.workers.filter(hasFingerprintAttendance);
  const faceMissing = input.workers.filter((worker) => !hasFaceAttendance(worker));
  const fingerprintMissing = input.workers.filter((worker) => !hasFingerprintAttendance(worker));
  const bothMissing = input.workers.filter(
    (worker) => !hasFaceAttendance(worker) && !hasFingerprintAttendance(worker)
  );
  const lateWorkers = input.workers.filter((worker) => worker.attendanceStatus === "Late");
  const absentWorkers = input.workers.filter((worker) => worker.attendanceStatus === "Absent");
  const rawFaceEvents = input.rawFaceEvents || [];
  const rawFingerprintEvents = input.rawFingerprintEvents || [];
  const unmatchedFaceEvents = rawFaceEvents.filter((event) => event.matchStatus !== "matched");
  const unmatchedFingerprintEvents = rawFingerprintEvents.filter(
    (event) => event.match_status !== "matched"
  );
  const activeAlertDate =
    input.attendanceOverview.attendanceDate ||
    input.fingerprintDeviceSummary.attendanceDate ||
    currentAttendanceDateKey();
  const activeAlerts = input.alerts.filter(
    (alert) =>
      alert.status !== "Resolved" &&
      isDateKeyInAttendanceDay(alert.createdAt, activeAlertDate)
  );

  const summaryRows = [
    ["Attendance date", input.attendanceOverview.attendanceDate || input.fingerprintDeviceSummary.attendanceDate || ""],
    ["Generated at", formatDateTime(input.generatedAt)],
    ["Total workers", input.attendanceOverview.totalWorkers],
    ["Present workers", input.attendanceOverview.presentWorkers],
    ["Late workers", input.attendanceOverview.lateWorkers],
    ["Absent workers", input.attendanceOverview.absentWorkers],
    ["On leave workers", input.attendanceOverview.onLeaveWorkers],
    ["Face attended workers", faceAttended.length],
    ["Face not attended workers", faceMissing.length],
    ["Fingerprint attended registered workers", fingerprintAttended.length],
    ["Fingerprint device PINs counted", input.fingerprintDeviceSummary.totalDevicePins],
    ["Unregistered fingerprint PINs", input.fingerprintDeviceSummary.unregisteredDevicePins],
    ["Fingerprint not attended registered workers", fingerprintMissing.length],
    ["Missing both face and fingerprint", bothMissing.length],
    ["Raw unmatched face events", unmatchedFaceEvents.length],
    ["Raw unmatched fingerprint events", unmatchedFingerprintEvents.length],
  ];

  const departmentRows = input.departmentAttendance.map((department) => [
    department.department,
    department.totalWorkers,
    department.presentWorkers,
    department.lateWorkers,
    department.onLeaveWorkers,
    department.absentWorkers,
    formatPercent(department.attendanceRate),
  ]);

  const lineRows = input.lines.map((line) => [
    line.name,
    line.code,
    line.allocatedStyle || "",
    line.department,
    line.shift,
    line.supervisor || "Unassigned",
    line.assignedWorkers,
    line.presentWorkers + line.lateWorkers,
    line.absentWorkers,
    line.onLeaveWorkers,
    formatPercent(line.attendanceRate),
    line.risk,
  ]);

  const unregisteredPinRows = input.fingerprintDeviceSummary.unregisteredPins.map((pin) => [
    pin.pin,
    formatDateTime(pin.firstPunch),
    formatDateTime(pin.lastPunch),
    pin.punchCount,
    pin.deviceIps.join(", "),
    "Not registered in LineMatrix",
  ]);

  const attendanceSummaryRows = input.attendanceSummaries.map((summary) => {
    const worker = findWorker(input.workers, summary.workerId);
    return [
      worker?.employeeId || "",
      worker?.fullName || summary.workerId,
      summary.month,
      summary.daysPresent,
      summary.daysAbsent,
      summary.leaveDays,
      summary.otHours,
      `${summary.validationRate}%`,
      summary.incentive,
      summary.finalTotal,
    ];
  });

  const leaveRows = input.leaveRecords.map((leave) => {
    const worker = findWorker(input.workers, leave.workerId);
    return [
      worker?.employeeId || "",
      worker?.fullName || leave.workerId,
      leave.type,
      formatDate(leave.startDate),
      formatDate(leave.endDate),
      leave.days,
      leave.status,
    ];
  });

  const alertRows = activeAlerts.map((alert) => {
    const worker = findWorker(input.workers, alert.workerId);
    const line = findLine(input.lines, alert.lineId);
    return [
      formatDateTime(alert.createdAt),
      alert.priority,
      alert.type,
      alert.title,
      worker ? `${worker.fullName} (${worker.employeeId})` : "",
      line ? `${line.name} / ${line.code}` : "",
      alert.status,
    ];
  });

  const notes = input.backendNotes?.length
    ? `<ul>${input.backendNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`
    : "<p>No backend fetch warnings were recorded while generating this report.</p>";

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(REPORT_TITLE)}</title>
        <style>
          @page {
            margin: 0.55in;
          }
          body {
            color: #111827;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
            font-size: 10.5pt;
            line-height: 1.38;
          }
          h1 {
            color: #0f172a;
            font-size: 24pt;
            margin: 0 0 8pt;
          }
          h2 {
            border-bottom: 1px solid #cbd5e1;
            color: #0f172a;
            font-size: 15pt;
            margin: 20pt 0 6pt;
            padding-bottom: 4pt;
          }
          p {
            margin: 4pt 0 8pt;
          }
          .meta,
          .section-subtitle {
            color: #475569;
          }
          table {
            border-collapse: collapse;
            margin: 8pt 0 12pt;
            width: 100%;
          }
          th {
            background: #eaf2ff;
            color: #1e3a8a;
            font-weight: 700;
            text-align: left;
          }
          th,
          td {
            border: 1px solid #cbd5e1;
            padding: 5pt 6pt;
            vertical-align: top;
          }
          tr:nth-child(even) td {
            background: #f8fafc;
          }
          .small {
            color: #64748b;
            font-size: 9pt;
          }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(REPORT_TITLE)}</h1>
        <p class="meta">
          Attendance date:
          ${escapeHtml(input.attendanceOverview.attendanceDate || input.fingerprintDeviceSummary.attendanceDate || "Latest")}
          | Generated: ${escapeHtml(formatDateTime(input.generatedAt))}
        </p>
        <p>
          This report combines the current LineMatrix attendance state, employee verification
          status, reconciliation history, raw Hikvision face events, raw ZKTeco fingerprint events,
          and unmatched or unregistered device records.
        </p>

        ${section("Report Notes", null, notes)}

        ${section(
          "Executive Summary",
          "High-level attendance and verification totals.",
          table(["Metric", "Value"], summaryRows)
        )}

        ${section(
          "Department Attendance",
          "Department-wise headcount, present, late, leave, absence, and attendance percentage.",
          table(
            ["Department", "Total", "Present", "Late", "On Leave", "Absent", "Attendance"],
            departmentRows
          )
        )}

        ${section(
          "Line Attendance",
          "Line-wise assigned workforce, current attendance, style, and risk state.",
          table(
            [
              "Line",
              "Code",
              "Style",
              "Department",
              "Shift",
              "Supervisor",
              "Assigned",
              "Came Today",
              "Absent",
              "On Leave",
              "Attendance",
              "Risk",
            ],
            lineRows
          )
        )}

        ${section(
          "All Employee Attendance Verification",
          "Every registered employee with face, fingerprint, and overall attendance state.",
          table(
            [
              "Employee No",
              "Employee Name",
              "Department",
              "Role",
              "Line",
              "Shift",
              "Overall Attendance",
              "Face",
              "Fingerprint",
              "Final Validation",
              "Phone",
            ],
            buildWorkerRows(input.workers, input.lines)
          )
        )}

        ${section(
          "Face Attended Employees",
          "Registered employees with a verified face attendance signal.",
          table(
            [
              "Employee No",
              "Employee Name",
              "Department",
              "Role",
              "Line",
              "Shift",
              "Overall Attendance",
              "Face",
              "Fingerprint",
              "Final Validation",
              "Phone",
            ],
            buildWorkerRows(faceAttended, input.lines)
          )
        )}

        ${section(
          "Face Not Attended Employees",
          "Registered employees without a verified face attendance signal.",
          table(
            [
              "Employee No",
              "Employee Name",
              "Department",
              "Role",
              "Line",
              "Shift",
              "Overall Attendance",
              "Face",
              "Fingerprint",
              "Final Validation",
              "Phone",
            ],
            buildWorkerRows(faceMissing, input.lines)
          )
        )}

        ${section(
          "Fingerprint Attended Employees",
          "Registered employees with a verified fingerprint attendance signal.",
          table(
            [
              "Employee No",
              "Employee Name",
              "Department",
              "Role",
              "Line",
              "Shift",
              "Overall Attendance",
              "Face",
              "Fingerprint",
              "Final Validation",
              "Phone",
            ],
            buildWorkerRows(fingerprintAttended, input.lines)
          )
        )}

        ${section(
          "Fingerprint Not Attended Employees",
          "Registered employees without a verified fingerprint attendance signal.",
          table(
            [
              "Employee No",
              "Employee Name",
              "Department",
              "Role",
              "Line",
              "Shift",
              "Overall Attendance",
              "Face",
              "Fingerprint",
              "Final Validation",
              "Phone",
            ],
            buildWorkerRows(fingerprintMissing, input.lines)
          )
        )}

        ${section(
          "Face and Fingerprint Missing",
          "Registered employees missing both verification channels.",
          table(
            [
              "Employee No",
              "Employee Name",
              "Department",
              "Role",
              "Line",
              "Shift",
              "Overall Attendance",
              "Face",
              "Fingerprint",
              "Final Validation",
              "Phone",
            ],
            buildWorkerRows(bothMissing, input.lines)
          )
        )}

        ${section(
          "Late Employees",
          "Employees currently marked as late by the system.",
          table(
            [
              "Employee No",
              "Employee Name",
              "Department",
              "Role",
              "Line",
              "Shift",
              "Overall Attendance",
              "Face",
              "Fingerprint",
              "Final Validation",
              "Phone",
            ],
            buildWorkerRows(lateWorkers, input.lines)
          )
        )}

        ${section(
          "Absent Employees",
          "Employees currently marked as absent by the system.",
          table(
            [
              "Employee No",
              "Employee Name",
              "Department",
              "Role",
              "Line",
              "Shift",
              "Overall Attendance",
              "Face",
              "Fingerprint",
              "Final Validation",
              "Phone",
            ],
            buildWorkerRows(absentWorkers, input.lines)
          )
        )}

        ${section(
          "Attendance Reconciliation History",
          "Reconciled face and fingerprint event history available in LineMatrix.",
          table(
            [
              "Date",
              "Employee No",
              "Employee Name",
              "Department",
              "Line",
              "Shift",
              "Face Time",
              "Fingerprint Time",
              "Validation Status",
              "Confidence",
              "Exception",
            ],
            buildValidationRows(input.validationRecords, input.lines)
          )
        )}

        ${section(
          "Monthly Attendance History",
          "Stored monthly attendance, leave, overtime, incentive, and validation history.",
          table(
            [
              "Employee No",
              "Employee Name",
              "Month",
              "Days Present",
              "Days Absent",
              "Leave Days",
              "OT Hours",
              "Validation Rate",
              "Incentive",
              "Final Total",
            ],
            attendanceSummaryRows
          )
        )}

        ${section(
          "Leave History",
          "Leave records currently available for registered employees.",
          table(
            ["Employee No", "Employee Name", "Leave Type", "Start Date", "End Date", "Days", "Status"],
            leaveRows
          )
        )}

        ${section(
          "System Face Attendance Events",
          "Face attendance events currently reconciled inside LineMatrix.",
          table(
            ["Event Time", "Employee No", "Employee Name", "Department", "Gate", "Confidence", "Outcome"],
            buildSystemFaceRows(input.faceEvents, input.workers)
          )
        )}

        ${section(
          "System Fingerprint Attendance Events",
          "Fingerprint attendance events currently reconciled inside LineMatrix.",
          table(
            ["Event Time", "Employee No", "Employee Name", "Department", "Gate", "Confidence", "Outcome"],
            buildSystemFingerprintRows(input.fingerprintEvents, input.workers)
          )
        )}

        ${section(
          "Raw Hikvision Face Events",
          "Latest raw face recognition records fetched from the hosted backend when available.",
          table(
            [
              "Event Time",
              "Device Employee No / Serial",
              "Device Name",
              "Matched Employee",
              "Department",
              "Match",
              "Camera",
              "Location",
              "Camera URL",
              "Decision",
            ],
            buildRawFaceRows(rawFaceEvents)
          )
        )}

        ${section(
          "Unmatched Hikvision Face Events",
          "Face events that did not match a registered LineMatrix employee record.",
          table(
            [
              "Event Time",
              "Device Employee No / Serial",
              "Device Name",
              "Matched Employee",
              "Department",
              "Match",
              "Camera",
              "Location",
              "Camera URL",
              "Decision",
            ],
            buildRawFaceRows(unmatchedFaceEvents)
          )
        )}

        ${section(
          "Raw ZKTeco Fingerprint Events",
          "Latest raw fingerprint punches fetched from the hosted backend when available.",
          table(
            [
              "Event Time",
              "PIN",
              "Employee Code",
              "Matched Employee",
              "Department",
              "Match",
              "Device IP",
              "Device Serial",
              "Punch Time",
              "Verify Mode",
            ],
            buildRawFingerprintRows(rawFingerprintEvents)
          )
        )}

        ${section(
          "Unmatched ZKTeco Fingerprint Events",
          "Fingerprint punches whose device PIN is not matched to a registered LineMatrix employee.",
          table(
            [
              "Event Time",
              "PIN",
              "Employee Code",
              "Matched Employee",
              "Department",
              "Match",
              "Device IP",
              "Device Serial",
              "Punch Time",
              "Verify Mode",
            ],
            buildRawFingerprintRows(unmatchedFingerprintEvents)
          )
        )}

        ${section(
          "Unregistered Fingerprint PINs",
          "Device PINs counted in fingerprint attendance but not yet registered in LineMatrix.",
          table(
            ["PIN", "First Punch", "Last Punch", "Punch Count", "Device IPs", "Status"],
            unregisteredPinRows
          )
        )}

        ${section(
          "Active Attendance Alerts",
          "Open or unread alerts connected to attendance, workers, or production lines.",
          table(
            ["Created", "Priority", "Type", "Title", "Worker", "Line", "Status"],
            alertRows
          )
        )}

        <p class="small">
          End of report. Generated by LineMatrix Operations Centre.
        </p>
      </body>
    </html>
  `;

  downloadWordDocument(
    `linematrix-full-attendance-report-${filenameDate(
      input.attendanceOverview.attendanceDate || input.fingerprintDeviceSummary.attendanceDate
    )}.doc`,
    html
  );
}
