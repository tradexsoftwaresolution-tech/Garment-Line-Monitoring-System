import type { UserRole } from "./types";

export type AppRouteKey =
  | "dashboard"
  | "ieLineAttendance"
  | "ieLineFloorPlan"
  | "ieAnalytics"
  | "imports"
  | "workers"
  | "employeeManagement"
  | "workerProfile"
  | "leaveManagement"
  | "employeePortal"
  | "validation"
  | "hikvision"
  | "zkteco"
  | "skillMatrix"
  | "productionLines"
  | "lineAssignment"
  | "alerts"
  | "attendance"
  | "reports"
  | "settings"
  | "audit"
  | "selfService"
  | "display";

export type AppAction =
  | "manageWorkers"
  | "assignLine"
  | "transferLine"
  | "resolveValidation"
  | "markValidationVerified"
  | "escalateValidation"
  | "manageAlerts"
  | "exportAttendance"
  | "exportReports"
  | "editSettings"
  | "addLineOutput"
  | "overrideAttendance"
  | "addWorkerNote"
  | "markException"
  | "viewAudit";

export const roleLabels: Record<UserRole, string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  hr: "HR",
  ie: "IE",
  viewer: "Viewer / Management",
};

export const routeTitles: Record<AppRouteKey, string> = {
  dashboard: "Dashboard",
  ieLineAttendance: "Line Attendance",
  ieLineFloorPlan: "Line Floor Plan",
  ieAnalytics: "IE Analytics",
  imports: "Import Center",
  workers: "Workers",
  employeeManagement: "Employee Management",
  workerProfile: "Worker Profile",
  leaveManagement: "Leave Management",
  employeePortal: "Employee Portal",
  validation: "Validation Center",
  hikvision: "Hikvision Face Recognition",
  zkteco: "ZKTeco Fingerprint",
  skillMatrix: "Skill Matrix",
  productionLines: "Production Lines",
  lineAssignment: "Line Assignment",
  alerts: "Alerts Center",
  attendance: "Incentive Calculation",
  reports: "Reports",
  settings: "Settings",
  audit: "Audit Log",
  selfService: "Self-Service Portal",
  display: "Display Mode",
};

export const routePermissions: Record<AppRouteKey, UserRole[]> = {
  dashboard: ["admin", "supervisor", "hr", "ie", "viewer"],
  ieLineAttendance: ["admin", "ie"],
  ieLineFloorPlan: ["admin", "ie"],
  ieAnalytics: ["admin", "ie"],
  imports: ["admin", "hr"],
  workers: ["admin", "supervisor", "hr", "ie"],
  employeeManagement: ["admin", "hr"],
  workerProfile: ["admin", "supervisor", "hr", "ie"],
  leaveManagement: ["admin", "hr"],
  employeePortal: ["admin", "supervisor", "hr", "ie", "viewer"],
  validation: ["admin", "supervisor", "hr"],
  hikvision: ["admin", "supervisor", "ie", "viewer"],
  zkteco: ["admin", "supervisor", "ie", "viewer"],
  skillMatrix: ["admin", "supervisor"],
  productionLines: ["admin", "supervisor", "viewer"],
  lineAssignment: ["admin", "supervisor"],
  alerts: ["admin", "supervisor", "hr", "ie"],
  attendance: ["admin", "supervisor", "viewer"],
  reports: ["admin", "supervisor", "hr", "viewer"],
  settings: ["admin"],
  audit: ["admin", "hr"],
  selfService: ["admin", "supervisor", "hr", "ie", "viewer"],
  display: ["admin", "supervisor", "hr", "ie", "viewer"],
};

export const actionPermissions: Record<AppAction, UserRole[]> = {
  manageWorkers: ["admin", "supervisor", "hr"],
  assignLine: ["admin", "supervisor"],
  transferLine: ["admin", "supervisor"],
  resolveValidation: ["admin", "hr"],
  markValidationVerified: ["admin", "hr"],
  escalateValidation: ["admin", "hr"],
  manageAlerts: ["admin", "supervisor", "hr", "ie"],
  exportAttendance: ["admin", "hr"],
  exportReports: ["admin", "supervisor", "hr", "viewer"],
  editSettings: ["admin"],
  addLineOutput: ["admin", "supervisor"],
  overrideAttendance: ["admin", "hr"],
  addWorkerNote: ["admin", "supervisor", "hr"],
  markException: ["admin", "supervisor", "hr"],
  viewAudit: ["admin"],
};

export function canAccessRoute(role: UserRole, routeKey: AppRouteKey) {
  return routePermissions[routeKey].includes(role);
}

export function canPerform(role: UserRole, action: AppAction) {
  return actionPermissions[action].includes(role);
}
