export const USER_ROLES = ["super_admin", "admin", "supervisor", "hr", "ie", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const SOURCE_TYPES = ["face", "fingerprint"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const IMPORT_STATUSES = [
  "uploaded",
  "processing",
  "parsed",
  "normalized",
  "reconciled",
  "completed",
  "failed",
  "partially_completed",
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const ATTENDANCE_STATES = [
  "present",
  "leave",
  "absent",
  "no_data",
  "review",
] as const;
export type AttendanceState = (typeof ATTENDANCE_STATES)[number];

export const RECONCILIATION_STATUSES = [
  "validated",
  "face_only",
  "fingerprint_only",
  "leave",
  "absent",
  "needs_review",
  "anomaly",
] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const PARSE_STATUSES = ["pending", "parsed", "failed"] as const;
export type ParseStatus = (typeof PARSE_STATUSES)[number];

export type FingerprintFileFormat = "pdf" | "xlsx" | "csv";

export interface FaceMetadataRow {
  rowNumber: number;
  values: string[];
}

export interface FaceParsedRow {
  rowNumber: number;
  firstName: string | null;
  lastName: string | null;
  employeeId: string | null;
  department: string | null;
  dateText: string | null;
  weekday: string | null;
  recordsText: string | null;
  rawPayload: Json;
  parseStatus: ParseStatus;
  parseError: string | null;
}

export interface FaceWorkbookParseResult {
  sourceType: "face";
  headerRowIndex: number;
  metadataRows: FaceMetadataRow[];
  rows: FaceParsedRow[];
  warnings: string[];
}

export interface FingerprintParsedRow {
  rowNumber: number;
  empNo: string | null;
  epfNo: string | null;
  name: string | null;
  designation: string | null;
  department: string | null;
  dateText: string | null;
  timeInText: string | null;
  timeOutText: string | null;
  lateEarlyText: string | null;
  dayText: string | null;
  otText: string | null;
  leaveType: string | null;
  leaveDaysTotalText: string | null;
  nopayDaysTotalText: string | null;
  otherLeaveDaysText: string | null;
  rawPayload: Json;
  parseStatus: ParseStatus;
  parseError: string | null;
}

export interface FingerprintFileParseResult {
  sourceType: "fingerprint";
  fileFormat: FingerprintFileFormat;
  rows: FingerprintParsedRow[];
  warnings: string[];
}

export interface NormalizedFaceEventRow {
  rawRowId: string | null;
  employeeCode: string;
  eventDate: string;
  eventTime: string;
  eventTimestamp: string | null;
  eventSequence: number;
  sourceRecordsText: string | null;
  isDuplicate: boolean;
}

export interface FaceDailySummaryInput {
  employeeCode: string;
  eventDate: string;
  faceFirstSeen: string | null;
  faceLastSeen: string | null;
  faceEventCount: number;
  duplicateEventCount: number;
  normalizedRecords: Array<{
    time: string;
    isDuplicate: boolean;
  }>;
  qualityFlags: string[];
}

export interface FingerprintDailyAttendanceInput {
  rawRowId: string | null;
  employeeCode: string;
  epfNo: string | null;
  employeeName: string | null;
  designation: string | null;
  departmentName: string | null;
  attendanceDate: string;
  timeIn: string | null;
  timeOut: string | null;
  lateEarlyHours: number | null;
  otHours: number | null;
  leaveType: string | null;
  leaveDaysTotal: number | null;
  nopayDaysTotal: number | null;
  otherLeaveDays: number | null;
  attendanceState: AttendanceState;
  qualityFlags: string[];
}

export interface ImportBatchSummary {
  id: string;
  sourceType: SourceType;
  originalFilename: string;
  importStatus: ImportStatus;
  storagePath: string;
  fileMimeType: string | null;
  fileSizeBytes: number | null;
  totalRawRows: number;
  totalValidRows: number;
  totalErrorRows: number;
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationSummaryRow {
  attendanceDate: string;
  totalReconciled: number;
  validatedCount: number;
  faceOnlyCount: number;
  fingerprintOnlyCount: number;
  leaveCount: number;
  absentCount: number;
  needsReviewCount: number;
  anomalyCount: number;
}

export interface DepartmentValidationSummaryRow {
  attendanceDate: string;
  departmentName: string;
  validatedCount: number;
  faceOnlyCount: number;
  fingerprintOnlyCount: number;
  leaveCount: number;
  absentCount: number;
  needsReviewCount: number;
  anomalyCount: number;
}

export interface ReconciliationRowDetail {
  id: string;
  faceImportBatchId: string | null;
  fingerprintImportBatchId: string | null;
  employeeCode: string;
  employeeName: string | null;
  designation: string | null;
  departmentName: string | null;
  attendanceDate: string;
  faceFirstSeen: string | null;
  faceLastSeen: string | null;
  faceEventCount: number | null;
  duplicateFaceEventCount: number | null;
  fingerprintTimeIn: string | null;
  fingerprintTimeOut: string | null;
  lateEarlyHours: number | null;
  otHours: number | null;
  leaveType: string | null;
  reconciliationStatus: ReconciliationStatus;
  effectiveStatus: ReconciliationStatus;
  exceptionReason: string | null;
  confidenceLevel: ConfidenceLevel | null;
  ruleFlags: string[];
  manuallyOverridden: boolean;
  manualOverrideStatus: ReconciliationStatus | null;
  manualOverrideReason: string | null;
  manualOverrideBy: string | null;
  manualOverrideAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReconciliationFilterInput {
  attendanceDate?: string | null;
  status?: ReconciliationStatus | "all" | null;
  department?: string | null;
  employeeCode?: string | null;
  importBatchId?: string | null;
}

export interface ReconciliationOverrideInput {
  reconciliationId: string;
  newStatus: ReconciliationStatus;
  reason: string;
  note?: string | null;
}

export interface FaceComparisonRow {
  employeeCode: string;
  employeeName: string | null;
  attendanceDate: string;
  faceFirstSeen: string | null;
  faceLastSeen: string | null;
  faceEventCount: number | null;
  fingerprintTimeIn: string | null;
  fingerprintTimeOut: string | null;
  reconciliationStatus: ReconciliationStatus;
  confidenceLevel: ConfidenceLevel | null;
}
import type { Json } from "./database";
