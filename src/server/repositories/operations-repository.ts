import type { Database } from "@/types/database";
import type { AppSupabaseClient } from "./base-repository";

type EmployeeRow = Database["public"]["Tables"]["employees"]["Row"];
type EmployeeProfileRow = Database["public"]["Tables"]["employee_profiles"]["Row"];
type EmployeeNoteRow = Database["public"]["Tables"]["employee_notes"]["Row"];
type ProductionLineRow = Database["public"]["Tables"]["production_lines"]["Row"];
type LineAssignmentRow = Database["public"]["Tables"]["line_assignments"]["Row"];
type TransferLogRow = Database["public"]["Tables"]["transfer_logs"]["Row"];
type OperationsAlertRow = Database["public"]["Tables"]["operations_alerts"]["Row"];
type OperationsAlertHistoryRow =
  Database["public"]["Tables"]["operations_alert_history"]["Row"];
type AnnouncementRow = Database["public"]["Tables"]["announcements"]["Row"];
type IncentiveRecordRow = Database["public"]["Tables"]["incentive_records"]["Row"];
type ProductionLineMetricRow =
  Database["public"]["Tables"]["production_line_daily_metrics"]["Row"];
type ProductionLineOutputEntryRow =
  Database["public"]["Tables"]["production_line_output_entries"]["Row"];
type FingerprintAttendanceRow =
  Database["public"]["Tables"]["fingerprint_daily_attendance"]["Row"];
type ZktecoFingerprintEventRow =
  Database["public"]["Tables"]["zkteco_fingerprint_events"]["Row"];
type ReconciliationRow =
  Database["public"]["Tables"]["attendance_reconciliation"]["Row"];
type AuditLogRow = Database["public"]["Tables"]["audit_logs"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type SystemSettingsRow = Database["public"]["Tables"]["system_settings"]["Row"];

function isMissingRelationError(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    Boolean(error.message?.includes("production_line_output_entries"))
  );
}

export async function listProfiles(client: AppSupabaseClient) {
  const { data, error } = await client
    .from("profiles")
    .select("*")
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as ProfileRow[];
}

export async function listEmployees(client: AppSupabaseClient) {
  const { data, error } = await client
    .from("employees")
    .select("*")
    .eq("is_active", true)
    .order("employee_code", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as EmployeeRow[];
}

export async function listEmployeeProfiles(client: AppSupabaseClient) {
  const { data, error } = await client.from("employee_profiles").select("*");

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as EmployeeProfileRow[];
}

export async function upsertEmployeeProfile(
  client: AppSupabaseClient,
  payload: Database["public"]["Tables"]["employee_profiles"]["Insert"]
) {
  const { data, error } = await client
    .from("employee_profiles")
    .upsert(payload, { onConflict: "employee_id" })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as EmployeeProfileRow;
}

export async function listEmployeeNotes(client: AppSupabaseClient) {
  const { data, error } = await client
    .from("employee_notes")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as EmployeeNoteRow[];
}

export async function createEmployeeNote(
  client: AppSupabaseClient,
  payload: Database["public"]["Tables"]["employee_notes"]["Insert"]
) {
  const { data, error } = await client
    .from("employee_notes")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as EmployeeNoteRow;
}

export async function listProductionLines(client: AppSupabaseClient) {
  const { data, error } = await client
    .from("production_lines")
    .select("*")
    .eq("is_active", true)
    .order("code", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as ProductionLineRow[];
}

export async function fetchProductionLine(
  client: AppSupabaseClient,
  lineId: string
) {
  const { data, error } = await client
    .from("production_lines")
    .select("*")
    .eq("id", lineId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ProductionLineRow;
}

export async function updateProductionLine(
  client: AppSupabaseClient,
  lineId: string,
  payload: Database["public"]["Tables"]["production_lines"]["Update"]
) {
  const { data, error } = await client
    .from("production_lines")
    .update(payload)
    .eq("id", lineId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ProductionLineRow;
}

export async function listLineAssignments(client: AppSupabaseClient) {
  const { data, error } = await client
    .from("line_assignments")
    .select("*")
    .order("assigned_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as LineAssignmentRow[];
}

export async function listTransferLogs(client: AppSupabaseClient) {
  const { data, error } = await client
    .from("transfer_logs")
    .select("*")
    .order("transferred_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as TransferLogRow[];
}

export async function listOperationsAlerts(client: AppSupabaseClient) {
  const { data, error } = await client
    .from("operations_alerts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as OperationsAlertRow[];
}

export async function fetchOperationsAlert(
  client: AppSupabaseClient,
  alertId: string
) {
  const { data, error } = await client
    .from("operations_alerts")
    .select("*")
    .eq("id", alertId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as OperationsAlertRow;
}

export async function updateOperationsAlert(
  client: AppSupabaseClient,
  alertId: string,
  payload: Database["public"]["Tables"]["operations_alerts"]["Update"]
) {
  const { data, error } = await client
    .from("operations_alerts")
    .update(payload)
    .eq("id", alertId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as OperationsAlertRow;
}

export async function listOperationsAlertHistory(client: AppSupabaseClient) {
  const { data, error } = await client
    .from("operations_alert_history")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as OperationsAlertHistoryRow[];
}

export async function createOperationsAlertHistory(
  client: AppSupabaseClient,
  payload: Database["public"]["Tables"]["operations_alert_history"]["Insert"]
) {
  const { data, error } = await client
    .from("operations_alert_history")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as OperationsAlertHistoryRow;
}

export async function fetchSystemSettings(client: AppSupabaseClient) {
  const { data, error } = await client
    .from("system_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data || null) as SystemSettingsRow | null;
}

export async function updateSystemSettings(
  client: AppSupabaseClient,
  payload: Database["public"]["Tables"]["system_settings"]["Update"]
) {
  const { data, error } = await client
    .from("system_settings")
    .update(payload)
    .eq("id", true)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as SystemSettingsRow;
}

export async function listAnnouncements(client: AppSupabaseClient) {
  const { data, error } = await client
    .from("announcements")
    .select("*")
    .eq("is_active", true)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as AnnouncementRow[];
}

export async function listIncentiveRecords(client: AppSupabaseClient) {
  const { data, error } = await client
    .from("incentive_records")
    .select("*")
    .order("month_start", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as IncentiveRecordRow[];
}

export async function listProductionLineMetrics(client: AppSupabaseClient, sinceDate?: string) {
  let query = client
    .from("production_line_daily_metrics")
    .select("*")
    .order("metric_date", { ascending: false });

  if (sinceDate) {
    query = query.gte("metric_date", sinceDate);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as ProductionLineMetricRow[];
}

export async function listProductionLineOutputEntries(
  client: AppSupabaseClient,
  sinceDate?: string
) {
  let query = client
    .from("production_line_output_entries")
    .select("*")
    .order("production_date", { ascending: false })
    .order("entry_time", { ascending: false })
    .order("created_at", { ascending: false });

  if (sinceDate) {
    query = query.gte("production_date", sinceDate);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }

    throw new Error(error.message);
  }

  return (data || []) as ProductionLineOutputEntryRow[];
}

export async function listProductionLineOutputEntriesForDay(
  client: AppSupabaseClient,
  lineId: string,
  productionDate: string
) {
  const { data, error } = await client
    .from("production_line_output_entries")
    .select("*")
    .eq("production_line_id", lineId)
    .eq("production_date", productionDate)
    .order("entry_time", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as ProductionLineOutputEntryRow[];
}

export async function createProductionLineOutputEntry(
  client: AppSupabaseClient,
  payload: Database["public"]["Tables"]["production_line_output_entries"]["Insert"]
) {
  const { data, error } = await client
    .from("production_line_output_entries")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ProductionLineOutputEntryRow;
}

export async function updateProductionLineOutputEntry(
  client: AppSupabaseClient,
  entryId: string,
  payload: Database["public"]["Tables"]["production_line_output_entries"]["Update"]
) {
  const { data, error } = await client
    .from("production_line_output_entries")
    .update(payload)
    .eq("id", entryId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ProductionLineOutputEntryRow;
}

export async function listFingerprintAttendanceRows(
  client: AppSupabaseClient,
  sinceDate?: string
) {
  let query = client
    .from("fingerprint_daily_attendance")
    .select("*")
    .order("attendance_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("employee_code", { ascending: true });

  if (sinceDate) {
    query = query.gte("attendance_date", sinceDate);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as FingerprintAttendanceRow[];
}

export async function listZktecoFingerprintEventsForDate(
  client: AppSupabaseClient,
  attendanceDate: string
) {
  const { data, error } = await client
    .from("zkteco_fingerprint_events")
    .select("*")
    .eq("attendance_date", attendanceDate)
    .order("event_time", { ascending: true })
    .limit(10000);

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return [] as ZktecoFingerprintEventRow[];
    }

    throw new Error(error.message);
  }

  return (data || []) as ZktecoFingerprintEventRow[];
}

export async function fetchLatestFingerprintAttendanceForEmployee(
  client: AppSupabaseClient,
  employeeCode: string
) {
  const { data, error } = await client
    .from("fingerprint_daily_attendance")
    .select("*")
    .eq("employee_code", employeeCode)
    .order("attendance_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data || null) as FingerprintAttendanceRow | null;
}

export async function updateFingerprintAttendanceRowsForEmployeeDate(
  client: AppSupabaseClient,
  employeeCode: string,
  attendanceDate: string,
  payload: Database["public"]["Tables"]["fingerprint_daily_attendance"]["Update"]
) {
  const { data, error } = await client
    .from("fingerprint_daily_attendance")
    .update(payload)
    .eq("employee_code", employeeCode)
    .eq("attendance_date", attendanceDate)
    .select("*");

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as FingerprintAttendanceRow[];
}

export async function fetchAttendanceReconciliationForEmployeeDate(
  client: AppSupabaseClient,
  employeeCode: string,
  attendanceDate: string
) {
  const { data, error } = await client
    .from("attendance_reconciliation")
    .select("*")
    .eq("employee_code", employeeCode)
    .eq("attendance_date", attendanceDate)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data || null) as ReconciliationRow | null;
}

export async function updateAttendanceReconciliationForEmployeeDate(
  client: AppSupabaseClient,
  employeeCode: string,
  attendanceDate: string,
  payload: Database["public"]["Tables"]["attendance_reconciliation"]["Update"]
) {
  const { data, error } = await client
    .from("attendance_reconciliation")
    .update(payload)
    .eq("employee_code", employeeCode)
    .eq("attendance_date", attendanceDate)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data || null) as ReconciliationRow | null;
}

export async function listAttendanceReconciliationRows(
  client: AppSupabaseClient,
  sinceDate?: string
) {
  let query = client
    .from("attendance_reconciliation")
    .select("*")
    .order("attendance_date", { ascending: false })
    .order("employee_code", { ascending: true });

  if (sinceDate) {
    query = query.gte("attendance_date", sinceDate);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as ReconciliationRow[];
}

export async function listAuditLogs(client: AppSupabaseClient, limit = 150) {
  const { data, error } = await client
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as AuditLogRow[];
}

export async function runAssignWorkerToLineRpc(
  client: AppSupabaseClient,
  args: {
    employeeId: string;
    lineId: string;
    reason?: string | null;
  }
) {
  const { data, error } = await client.rpc("rpc_assign_worker_to_line", {
    p_employee_id: args.employeeId,
    p_line_id: args.lineId,
    p_reason: args.reason || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function runTransferWorkerLineRpc(
  client: AppSupabaseClient,
  args: {
    employeeId: string;
    destinationLineId: string;
    reason: string;
  }
) {
  const { data, error } = await client.rpc("rpc_transfer_worker_line", {
    p_employee_id: args.employeeId,
    p_destination_line_id: args.destinationLineId,
    p_reason: args.reason,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function runSyncReconciliationAlertsRpc(client: AppSupabaseClient) {
  const { data, error } = await client.rpc("rpc_sync_reconciliation_alerts");

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
