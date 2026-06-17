export type UserRole = "admin" | "supervisor" | "hr" | "ie" | "viewer";

export type ShiftName = "Shift A" | "Shift B";

export type LineStatus = "Active" | "Partial" | "Idle";

export type RiskLevel = "Stable" | "Watch" | "Critical";

export type ValidationStatus =
  | "Fully Validated"
  | "Pending Validation"
  | "Face Only"
  | "Fingerprint Only"
  | "Time Mismatch"
  | "Unresolved Exception";

export type AttendanceStatus = "Present" | "Absent" | "Late" | "On Leave";

export type VerificationState = "Verified" | "Pending" | "Missing";

export type AlertPriority = "low" | "medium" | "high" | "critical";

export type AlertState = "Open" | "Read" | "Resolved";

export type TimelineEventType =
  | "face"
  | "fingerprint"
  | "validation"
  | "assignment"
  | "transfer"
  | "exception"
  | "note";

export interface AppUser {
  id: string;
  name: string;
  role: UserRole;
  title: string;
  department: string;
  initials: string;
}

export interface WorkerProfile {
  id: string;
  employeeId: string;
  fullName: string;
  photoUrl?: string;
  department: string;
  roleTitle: string;
  currentLineId?: string;
  shift: ShiftName;
  attendanceStatus: AttendanceStatus;
  faceVerificationStatus: VerificationState;
  fingerprintVerificationStatus: VerificationState;
  finalValidationStatus: ValidationStatus;
  currentStatus:
    | "On Line"
    | "Awaiting Validation"
    | "Pending Assignment"
    | "Transferred"
    | "Off Shift"
    | "On Leave";
  skills: string[];
  notes: string[];
  flags: string[];
  supervisorRemarks: string[];
  phone: string;
  joinDate: string;
}

export interface ProductionLineRecord {
  id: string;
  code: string;
  name: string;
  department: string;
  allocatedStyle?: string;
  status: LineStatus;
  targetManpower: number;
  actualManpower: number;
  assignedWorkers: number;
  presentWorkers: number;
  lateWorkers: number;
  onLeaveWorkers: number;
  absentWorkers: number;
  attendanceRate: number;
  efficiency: number;
  output: number;
  targetOutput: number;
  shift: ShiftName;
  supervisor: string;
  risk: RiskLevel;
  issue?: string;
  latestMetricId?: string;
  latestMetricDate?: string;
  plannedMo?: number;
  plannedHel?: number;
  actualMo?: number;
  actualHel?: number;
  teamMembers?: number;
  workingHours?: number;
  smv?: number;
  plannedPcs?: number;
  forecastPcs?: number;
  actualPcs?: number;
  plannedCadreTotal?: number;
  actualCadreTotal?: number;
  clockHours?: number;
  plannedSah?: number;
  forecastSah?: number;
  actualSah?: number;
  plannedEfficiencyRatio?: number;
  forecastEfficiencyRatio?: number;
  actualEfficiencyRatio?: number;
  pieceVariance?: number;
  sahVariance?: number;
  incentiveAmount?: number;
  incentiveBand?: string;
  metricWarnings?: string[];
  formulaRuleSetId?: string;
  formulaRuleVersion?: number;
  incentiveRuleSetId?: string;
  incentiveRuleVersion?: number;
}

export interface LineOutputEntryRecord {
  id: string;
  lineId: string;
  productionDate: string;
  entryTime: string;
  outputQuantity: number;
  cumulativeOutput: number;
  note?: string;
  createdBy?: string;
  createdAt: string;
}

export interface FaceEvent {
  id: string;
  workerId?: string;
  timestamp: string;
  gate: string;
  confidence: number;
  outcome: "matched" | "unknown" | "duplicate";
}

export interface FingerprintEvent {
  id: string;
  workerId?: string;
  timestamp: string;
  gate: string;
  confidence: number;
  outcome: "matched" | "delayed" | "missing";
}

export interface FingerprintUnregisteredPin {
  pin: string;
  firstPunch: string;
  lastPunch: string;
  punchCount: number;
  deviceIps: string[];
}

export interface FingerprintDeviceSummary {
  attendanceDate: string;
  totalDevicePins: number;
  registeredDevicePins: number;
  unregisteredDevicePins: number;
  totalPunches: number;
  registeredPunches: number;
  unregisteredPunches: number;
  unregisteredPins: FingerprintUnregisteredPin[];
}

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: string;
  label: string;
  detail: string;
}

export interface ValidationRecord {
  id: string;
  workerId?: string;
  employeeId: string;
  workerName: string;
  date: string;
  shift: ShiftName;
  department: string;
  lineId?: string;
  faceEventTime?: string;
  fingerprintEventTime?: string;
  status: ValidationStatus;
  confidenceScore: number;
  exceptionReason?: string;
  timeline: TimelineEvent[];
}

export interface LineAssignmentRecord {
  id: string;
  workerId: string;
  lineId: string;
  assignedAt: string;
  assignedBy: string;
  status: "Active" | "Transferred";
}

export interface TransferLog {
  id: string;
  workerId: string;
  sourceLineId?: string;
  destinationLineId?: string;
  reason: string;
  transferredAt: string;
  transferredBy: string;
}

export interface AlertHistoryEntry {
  id: string;
  timestamp: string;
  user: string;
  action: string;
}

export interface AlertRecord {
  id: string;
  type:
    | "unverified worker"
    | "missing worker"
    | "line understaffed"
    | "line idle"
    | "delayed fingerprint"
    | "duplicate event"
    | "unusual movement"
    | "attendance anomaly";
  priority: AlertPriority;
  title: string;
  description: string;
  createdAt: string;
  status: AlertState;
  assignedToUserId?: string;
  workerId?: string;
  lineId?: string;
  history: AlertHistoryEntry[];
}

export interface AttendanceSummary {
  id: string;
  workerId: string;
  month: string;
  daysPresent: number;
  daysAbsent: number;
  otHours: number;
  leaveDays: number;
  incentive: number;
  finalTotal: number;
  validationRate: number;
}

export interface AttendanceOverview {
  attendanceDate: string;
  totalWorkers: number;
  presentWorkers: number;
  lateWorkers: number;
  onLeaveWorkers: number;
  absentWorkers: number;
}

export interface DepartmentAttendanceSummary {
  department: string;
  totalWorkers: number;
  presentWorkers: number;
  lateWorkers: number;
  onLeaveWorkers: number;
  absentWorkers: number;
  attendanceRate: number;
}

export interface OvertimeRecord {
  id: string;
  workerId: string;
  date: string;
  hours: number;
  approvedBy: string;
  lineId?: string;
}

export interface LeaveRecord {
  id: string;
  workerId: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  status: "Approved" | "Pending";
}

export interface IncentiveRecord {
  id: string;
  workerId: string;
  month: string;
  amount: number;
  reason: string;
}

export interface AuditLogEntry {
  id: string;
  actionType: string;
  user: string;
  timestamp: string;
  targetEntity: string;
  oldValue: string;
  newValue: string;
}

export interface SmartInsight {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  recommendation: string;
  lineId?: string;
}

export interface Announcement {
  id: string;
  message: string;
}

export interface SystemSettings {
  faceRecognition: boolean;
  fingerprintVerification: boolean;
  dualValidationRequired: boolean;
  autoRejectUnknownFaces: boolean;
  manualVerificationFallback: boolean;
  autoMarkAbsent: boolean;
  morningShiftStart: string;
  morningShiftEnd: string;
  lateArrivalThreshold: number;
  gracePeriod: number;
  failedEntryAlerts: boolean;
  lowEfficiencyWarnings: boolean;
  workerAbsenceAlerts: boolean;
  dailySummaryReport: boolean;
}

export interface ReportSeriesPoint {
  label: string;
  value: number;
  secondaryValue?: number;
  tertiaryValue?: number;
}

export interface ReportSeries {
  weeklyAttendance: ReportSeriesPoint[];
  departmentAttendance: ReportSeriesPoint[];
  lineAttendance: ReportSeriesPoint[];
  transferHistory: ReportSeriesPoint[];
}
