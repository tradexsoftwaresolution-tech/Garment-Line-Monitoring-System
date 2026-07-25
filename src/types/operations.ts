import type {
  AlertRecord,
  Announcement,
  AttendanceOverview,
  AttendanceSummary,
  AuditLogEntry,
  DepartmentRecord,
  DepartmentAttendanceSummary,
  FaceEvent,
  FingerprintDeviceSummary,
  FingerprintEvent,
  IncentiveRecord,
  LeaveRecord,
  LineOutputEntryRecord,
  LineAssignmentRecord,
  OvertimeRecord,
  ProductionLineRecord,
  ReportSeries,
  SmartInsight,
  SystemSettings,
  TransferLog,
  ValidationRecord,
  WorkerProfile,
} from "@/app/types";

export type OperationsActionResult = {
  ok: boolean;
  message: string;
  attendanceOverride?: {
    workerId: string;
    status: WorkerProfile["attendanceStatus"];
  };
};

export interface OperationsSnapshot {
  attendanceOverview: AttendanceOverview;
  departmentAttendance: DepartmentAttendanceSummary[];
  departments: DepartmentRecord[];
  workers: WorkerProfile[];
  employeeRoster: WorkerProfile[];
  lines: ProductionLineRecord[];
  faceEvents: FaceEvent[];
  fingerprintDeviceSummary: FingerprintDeviceSummary;
  fingerprintEvents: FingerprintEvent[];
  validationRecords: ValidationRecord[];
  lineAssignments: LineAssignmentRecord[];
  lineOutputEntries: LineOutputEntryRecord[];
  transferLogs: TransferLog[];
  alerts: AlertRecord[];
  attendanceSummaries: AttendanceSummary[];
  overtimeRecords: OvertimeRecord[];
  leaveRecords: LeaveRecord[];
  incentiveRecords: IncentiveRecord[];
  auditLogs: AuditLogEntry[];
  smartInsights: SmartInsight[];
  announcements: Announcement[];
  settings: SystemSettings;
  reportSeries: ReportSeries;
}
