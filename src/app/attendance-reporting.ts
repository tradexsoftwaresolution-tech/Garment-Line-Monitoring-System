import type { ProductionLineRecord, WorkerProfile } from "./types";

export type AttendanceReportFilter =
  | "all"
  | "face-attended"
  | "fingerprint-attended"
  | "late"
  | "absent"
  | "face-missing"
  | "fingerprint-missing"
  | "both-missing";

export const ATTENDANCE_REPORT_FILTERS: Array<{
  value: AttendanceReportFilter;
  label: string;
  filename: string;
  description: string;
}> = [
  {
    value: "all",
    label: "All employees",
    filename: "attendance-verification-all.csv",
    description: "Complete attendance verification status for all employees.",
  },
  {
    value: "face-attended",
    label: "Face attended",
    filename: "face-attended.csv",
    description: "Employees with a verified face attendance signal.",
  },
  {
    value: "fingerprint-attended",
    label: "Fingerprint attended",
    filename: "fingerprint-attended.csv",
    description: "Employees with a verified fingerprint attendance signal.",
  },
  {
    value: "late",
    label: "Late employees",
    filename: "late-employees.csv",
    description: "Employees currently marked as late.",
  },
  {
    value: "absent",
    label: "Absent employees",
    filename: "absent-employees.csv",
    description: "Employees currently marked as absent.",
  },
  {
    value: "face-missing",
    label: "Face not attended",
    filename: "face-not-attended.csv",
    description: "Employees without a verified face attendance signal.",
  },
  {
    value: "fingerprint-missing",
    label: "Fingerprint not attended",
    filename: "fingerprint-not-attended.csv",
    description: "Employees without a verified fingerprint attendance signal.",
  },
  {
    value: "both-missing",
    label: "Face and fingerprint missing",
    filename: "face-and-fingerprint-not-attended.csv",
    description: "Employees missing both face and fingerprint attendance signals.",
  },
];

export function hasFaceAttendance(worker: WorkerProfile) {
  return worker.faceVerificationStatus === "Verified";
}

export function hasFingerprintAttendance(worker: WorkerProfile) {
  return worker.fingerprintVerificationStatus === "Verified";
}

export function matchesAttendanceReportFilter(
  worker: WorkerProfile,
  filter: AttendanceReportFilter
) {
  if (filter === "face-attended") return hasFaceAttendance(worker);
  if (filter === "fingerprint-attended") return hasFingerprintAttendance(worker);
  if (filter === "late") return worker.attendanceStatus === "Late";
  if (filter === "absent") return worker.attendanceStatus === "Absent";
  if (filter === "face-missing") return !hasFaceAttendance(worker);
  if (filter === "fingerprint-missing") return !hasFingerprintAttendance(worker);
  if (filter === "both-missing") {
    return !hasFaceAttendance(worker) && !hasFingerprintAttendance(worker);
  }
  return true;
}

export function filterWorkersForAttendanceReport(
  workers: WorkerProfile[],
  filter: AttendanceReportFilter
) {
  return workers.filter((worker) => matchesAttendanceReportFilter(worker, filter));
}

export function findAttendanceReportFilter(filter: AttendanceReportFilter) {
  return (
    ATTENDANCE_REPORT_FILTERS.find((item) => item.value === filter) ||
    ATTENDANCE_REPORT_FILTERS[0]
  );
}

function findWorkerLine(lines: ProductionLineRecord[], worker: WorkerProfile) {
  return lines.find((line) => line.id === worker.currentLineId);
}

export function buildAttendanceReportRows(
  workers: WorkerProfile[],
  lines: ProductionLineRecord[]
) {
  return [
    [
      "Employee No",
      "Employee Name",
      "Department",
      "Role",
      "Line",
      "Line Code",
      "Shift",
      "Overall Attendance",
      "Face Attendance",
      "Fingerprint Attendance",
      "Final Validation",
      "Phone",
    ],
    ...workers.map((worker) => {
      const line = findWorkerLine(lines, worker);
      return [
        worker.employeeId,
        worker.fullName,
        worker.department,
        worker.roleTitle,
        line?.name || "Unassigned",
        line?.code || "",
        worker.shift,
        worker.attendanceStatus,
        hasFaceAttendance(worker) ? "Attended" : "Not attended",
        hasFingerprintAttendance(worker) ? "Attended" : "Not attended",
        worker.finalValidationStatus,
        worker.phone,
      ];
    }),
  ];
}
