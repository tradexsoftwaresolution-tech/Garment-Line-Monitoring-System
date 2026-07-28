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
  | "manageRoleAccess"
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
  super_admin: "Super Admin",
  admin: "Admin",
  supervisor: "Supervisor",
  hr: "HR",
  ie: "IE",
  viewer: "Viewer / Management",
};

const allRoles: UserRole[] = ["super_admin", "admin", "supervisor", "hr", "ie", "viewer"];

const withSuperAdmin = (roles: UserRole[]): UserRole[] =>
  roles.includes("super_admin") ? roles : ["super_admin", ...roles];

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
  dashboard: allRoles,
  ieLineAttendance: withSuperAdmin(["admin", "ie"]),
  ieLineFloorPlan: withSuperAdmin(["admin", "ie"]),
  ieAnalytics: withSuperAdmin(["admin", "ie"]),
  imports: withSuperAdmin(["admin", "hr"]),
  workers: withSuperAdmin(["admin", "supervisor", "hr", "ie"]),
  employeeManagement: withSuperAdmin(["admin", "hr"]),
  workerProfile: withSuperAdmin(["admin", "supervisor", "hr", "ie"]),
  leaveManagement: withSuperAdmin(["admin", "hr"]),
  employeePortal: allRoles,
  validation: withSuperAdmin(["admin", "supervisor", "hr"]),
  hikvision: allRoles,
  zkteco: allRoles,
  skillMatrix: withSuperAdmin(["admin", "supervisor"]),
  productionLines: withSuperAdmin(["admin", "supervisor", "hr", "viewer"]),
  lineAssignment: withSuperAdmin(["admin", "supervisor"]),
  alerts: withSuperAdmin(["admin", "supervisor", "hr", "ie"]),
  attendance: withSuperAdmin(["admin", "supervisor", "viewer"]),
  reports: withSuperAdmin(["admin", "supervisor", "hr", "viewer"]),
  settings: withSuperAdmin(["admin"]),
  audit: withSuperAdmin(["admin", "hr"]),
  selfService: allRoles,
  display: allRoles,
};

export const actionPermissions: Record<AppAction, UserRole[]> = {
  manageRoleAccess: ["super_admin"],
  manageWorkers: withSuperAdmin(["admin", "supervisor", "hr"]),
  assignLine: withSuperAdmin(["admin", "supervisor"]),
  transferLine: withSuperAdmin(["admin", "supervisor"]),
  resolveValidation: withSuperAdmin(["admin", "hr"]),
  markValidationVerified: withSuperAdmin(["admin", "hr"]),
  escalateValidation: withSuperAdmin(["admin", "hr"]),
  manageAlerts: withSuperAdmin(["admin", "supervisor", "hr", "ie"]),
  exportAttendance: withSuperAdmin(["admin", "hr"]),
  exportReports: withSuperAdmin(["admin", "supervisor", "hr", "viewer"]),
  editSettings: withSuperAdmin(["admin"]),
  addLineOutput: withSuperAdmin(["admin", "supervisor"]),
  overrideAttendance: withSuperAdmin(["admin", "hr"]),
  addWorkerNote: withSuperAdmin(["admin", "supervisor", "hr"]),
  markException: withSuperAdmin(["admin", "supervisor", "hr"]),
  viewAudit: withSuperAdmin(["admin"]),
};

export const actionTitles: Record<AppAction, string> = {
  manageRoleAccess: "Manage Role Access",
  manageWorkers: "Manage Workers",
  assignLine: "Assign Line",
  transferLine: "Transfer Line",
  resolveValidation: "Resolve Validation",
  markValidationVerified: "Mark Validation Verified",
  escalateValidation: "Escalate Validation",
  manageAlerts: "Manage Alerts",
  exportAttendance: "Export Attendance",
  exportReports: "Export Reports",
  editSettings: "Edit Settings",
  addLineOutput: "Add Line Output",
  overrideAttendance: "Override Attendance",
  addWorkerNote: "Add Worker Note",
  markException: "Mark Exception",
  viewAudit: "View Audit",
};

function hasRoleAccess(role: UserRole, allowedRoles: UserRole[]) {
  return role === "super_admin" || allowedRoles.includes(role);
}

export function canAccessRoute(
  role: UserRole,
  routeKey: AppRouteKey,
  overrides?: Partial<Record<AppRouteKey, UserRole[]>>
) {
  return hasRoleAccess(role, overrides?.[routeKey] || routePermissions[routeKey]);
}

export function canPerform(
  role: UserRole,
  action: AppAction,
  overrides?: Partial<Record<AppAction, UserRole[]>>
) {
  return hasRoleAccess(role, overrides?.[action] || actionPermissions[action]);
}
