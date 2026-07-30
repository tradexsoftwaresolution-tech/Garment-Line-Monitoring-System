export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type GenericTable<Row, Insert = Row, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type GenericView<Row> = {
  Row: Row;
  Relationships: [];
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: "admin" | "supervisor" | "hr" | "ie" | "viewer";
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type DepartmentRow = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type EmployeeRow = {
  id: string;
  employee_code: string;
  employee_category: "permanent" | "new_joiner" | "intern" | null;
  epf_no: string | null;
  display_name: string | null;
  designation: string | null;
  department_id: string | null;
  department_name: string | null;
  source_priority_name: string | null;
  employment_status: "active" | "resigned" | "inactive";
  hire_date: string | null;
  resigned_at: string | null;
  resignation_reason: string | null;
  hr_notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type EmployeeCodeAliasRow = {
  id: string;
  employee_id: string;
  old_employee_code: string;
  new_employee_code: string;
  old_employee_category: string | null;
  effective_date: string;
  reason: string;
  hr_notes: string | null;
  created_at: string;
  created_by: string | null;
};

type DeviceIdentitySyncQueueRow = {
  id: string;
  employee_id: string | null;
  device_family: "hikvision" | "zkteco";
  action: "delete_identity" | "upsert_identity";
  old_employee_code: string | null;
  new_employee_code: string | null;
  status: "pending" | "processing" | "completed" | "failed" | "skipped";
  payload: Json;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
};

type LeaveCodeMapRow = {
  code: string;
  description: string;
  attendance_class: string;
};

type ImportBatchRow = {
  id: string;
  source_type: "face" | "fingerprint";
  original_filename: string;
  storage_path: string;
  file_mime_type: string | null;
  file_size_bytes: number | null;
  uploaded_by: string | null;
  import_status:
    | "uploaded"
    | "processing"
    | "parsed"
    | "normalized"
    | "reconciled"
    | "completed"
    | "failed"
    | "partially_completed";
  total_raw_rows: number;
  total_valid_rows: number;
  total_error_rows: number;
  notes: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type FaceRawRow = {
  id: string;
  import_batch_id: string;
  row_number: number;
  source_first_name: string | null;
  source_last_name: string | null;
  source_employee_id: string | null;
  source_department: string | null;
  source_date_text: string | null;
  source_weekday: string | null;
  source_records_text: string | null;
  raw_payload: Json;
  parse_status: string;
  parse_error: string | null;
  created_at: string;
};

type FingerprintRawRow = {
  id: string;
  import_batch_id: string;
  row_number: number;
  source_emp_no: string | null;
  source_epf_no: string | null;
  source_name: string | null;
  source_designation: string | null;
  source_department: string | null;
  source_date_text: string | null;
  source_time_in_text: string | null;
  source_time_out_text: string | null;
  source_late_early_text: string | null;
  source_day: string | null;
  source_ot_text: string | null;
  source_leave_type: string | null;
  source_leave_days_total_text: string | null;
  source_nopay_days_total_text: string | null;
  source_other_leave_days_text: string | null;
  raw_payload: Json;
  parse_status: string;
  parse_error: string | null;
  created_at: string;
};

type FaceEventRow = {
  id: string;
  import_batch_id: string;
  raw_row_id: string | null;
  employee_code: string;
  event_date: string;
  event_time: string;
  event_timestamp: string | null;
  event_sequence: number;
  source_records_text: string | null;
  is_duplicate: boolean;
  created_at: string;
};

type FaceDailySummaryRow = {
  id: string;
  import_batch_id: string;
  employee_code: string;
  event_date: string;
  face_first_seen: string | null;
  face_last_seen: string | null;
  face_event_count: number;
  duplicate_event_count: number;
  normalized_records: Json;
  quality_flags: Json;
  created_at: string;
};

type FingerprintDailyAttendanceRow = {
  id: string;
  import_batch_id: string;
  raw_row_id: string | null;
  employee_code: string;
  epf_no: string | null;
  employee_name: string | null;
  designation: string | null;
  department_name: string | null;
  attendance_date: string;
  time_in: string | null;
  time_out: string | null;
  late_early_hours: number | null;
  ot_hours: number | null;
  leave_type: string | null;
  leave_days_total: number | null;
  nopay_days_total: number | null;
  other_leave_days: number | null;
  attendance_state: "present" | "leave" | "absent" | "no_data" | "review";
  quality_flags: Json;
  created_at: string;
};

type ZktecoFingerprintEventRow = {
  id: string;
  event_uid: string;
  employee_pin: string;
  employee_code: string | null;
  employee_id: string | null;
  matched_employee_name: string | null;
  matched_department: string | null;
  match_status: "matched" | "unmatched";
  device_serial_no: string | null;
  device_ip: string | null;
  event_time: string;
  attendance_date: string;
  punch_time: string;
  verify_mode: string | null;
  in_out_mode: string | null;
  work_code: string | null;
  reserved_fields: string[] | null;
  raw_line: string;
  raw_payload: Json | null;
  received_at: string;
  created_at: string;
};

type AttendanceReconciliationStatus =
  | "validated"
  | "face_only"
  | "fingerprint_only"
  | "leave"
  | "absent"
  | "needs_review"
  | "anomaly";

type AttendanceReconciliationRow = {
  id: string;
  face_import_batch_id: string | null;
  fingerprint_import_batch_id: string | null;
  employee_code: string;
  attendance_date: string;
  employee_name: string | null;
  designation: string | null;
  department_name: string | null;
  face_first_seen: string | null;
  face_last_seen: string | null;
  face_event_count: number | null;
  duplicate_face_event_count: number | null;
  fingerprint_time_in: string | null;
  fingerprint_time_out: string | null;
  late_early_hours: number | null;
  ot_hours: number | null;
  leave_type: string | null;
  reconciliation_status: AttendanceReconciliationStatus;
  exception_reason: string | null;
  confidence_level: "high" | "medium" | "low" | null;
  rule_flags: Json;
  manually_overridden: boolean;
  manual_override_status: AttendanceReconciliationStatus | null;
  manual_override_reason: string | null;
  manual_override_by: string | null;
  manual_override_at: string | null;
  created_at: string;
  updated_at: string;
};

type ReconciliationNoteRow = {
  id: string;
  reconciliation_id: string;
  note: string;
  created_by: string | null;
  created_at: string;
};

type AuditLogRow = {
  id: string;
  actor_user_id: string | null;
  action_type: string;
  entity_type: string;
  entity_id: string;
  old_value: Json | null;
  new_value: Json | null;
  metadata: Json;
  created_at: string;
};

type ProductionLineRow = {
  id: string;
  code: string;
  name: string;
  department_name: string;
  shift_name: "Shift A" | "Shift B";
  supervisor_name: string | null;
  target_manpower: number;
  target_output: number;
  current_output: number;
  current_efficiency: number;
  allocated_style: string | null;
  issue: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type EmployeeProfileRow = {
  employee_id: string;
  shift_name: "Shift A" | "Shift B";
  phone: string | null;
  photo_url: string | null;
  join_date: string | null;
  skills: string[];
  daily_rate: number;
  ot_hourly_rate: number;
  created_at: string;
  updated_at: string;
};

type EmployeeNoteRow = {
  id: string;
  employee_id: string;
  note_type: "note" | "flag" | "remark";
  note: string;
  created_by: string | null;
  created_at: string;
};

type LineAssignmentRow = {
  id: string;
  employee_id: string;
  production_line_id: string;
  assigned_at: string;
  assigned_by: string | null;
  reason: string | null;
  status: "Active" | "Transferred";
  ended_at: string | null;
  created_at: string;
};

type TransferLogOperationalRow = {
  id: string;
  employee_id: string;
  source_line_id: string | null;
  destination_line_id: string | null;
  reason: string;
  transferred_at: string;
  transferred_by: string | null;
  created_at: string;
};

type OperationsAlertRow = {
  id: string;
  alert_type:
    | "unverified worker"
    | "missing worker"
    | "line understaffed"
    | "line idle"
    | "delayed fingerprint"
    | "duplicate event"
    | "unusual movement"
    | "attendance anomaly";
  priority: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  status: "Open" | "Read" | "Resolved";
  assigned_to_user_id: string | null;
  employee_id: string | null;
  line_id: string | null;
  reconciliation_id: string | null;
  source: "manual" | "reconciliation" | "system";
  created_at: string;
  updated_at: string;
};

type OperationsAlertHistoryRow = {
  id: string;
  alert_id: string;
  actor_user_id: string | null;
  action: string;
  created_at: string;
};

type SystemSettingsRow = {
  id: boolean;
  face_recognition: boolean;
  fingerprint_verification: boolean;
  dual_validation_required: boolean;
  auto_reject_unknown_faces: boolean;
  manual_verification_fallback: boolean;
  auto_mark_absent: boolean;
  morning_shift_start: string;
  morning_shift_end: string;
  late_arrival_threshold: number;
  grace_period: number;
  failed_entry_alerts: boolean;
  low_efficiency_warnings: boolean;
  worker_absence_alerts: boolean;
  daily_summary_report: boolean;
  created_at: string;
  updated_at: string;
};

type AnnouncementRow = {
  id: string;
  message: string;
  is_active: boolean;
  display_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type CalculationRuleSetRow = {
  id: string;
  rule_type: string;
  rule_set_id: string;
  version: number;
  description: string | null;
  source_path: string;
  is_active: boolean;
  checksum: string | null;
  created_at: string;
};

type CalculationAuditSnapshotRow = {
  id: string;
  metric_record_id: string | null;
  incentive_record_id: string | null;
  input_payload: Json;
  output_payload: Json;
  warnings: Json;
  formula_rule_set_id: string | null;
  formula_rule_version: number | null;
  incentive_rule_set_id: string | null;
  incentive_rule_version: number | null;
  created_at: string;
};

type IncentiveRecordOperationalRow = {
  id: string;
  employee_id: string | null;
  month_start: string;
  amount: number;
  reason: string;
  production_line_id: string | null;
  production_date: string | null;
  line_code: string | null;
  shift_code: string | null;
  basis_metric: string;
  basis_value: number | null;
  actual_efficiency: number | null;
  incentive_band_label: string | null;
  incentive_amount: number;
  incentive_rule_set_id: string | null;
  incentive_rule_version: number | null;
  warnings: Json;
  source_metric_record_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ProductionLineDailyMetricRow = {
  id: string;
  production_line_id: string;
  metric_date: string;
  production_date: string;
  line_code: string;
  shift_code: string | null;
  output: number;
  target_output: number;
  efficiency: number;
  planned_mo: number | null;
  planned_hel: number | null;
  actual_mo: number | null;
  actual_hel: number | null;
  team_members: number | null;
  working_hours: number | null;
  smv: number | null;
  planned_pcs: number | null;
  forecast_pcs: number | null;
  actual_pcs: number | null;
  planned_cadre_total: number | null;
  actual_cadre_total: number | null;
  clock_hours: number | null;
  planned_sah: number | null;
  planned_efficiency: number | null;
  forecast_sah: number | null;
  forecast_efficiency: number | null;
  actual_sah: number | null;
  actual_efficiency: number | null;
  piece_variance: number | null;
  sah_variance: number | null;
  warnings: Json;
  formula_rule_set_id: string | null;
  formula_rule_version: number | null;
  remarks: string | null;
  lost_time_minutes: number | null;
  source_metadata: Json;
  created_at: string;
  updated_at: string;
};

type ProductionLineOutputEntryRow = {
  id: string;
  production_line_id: string;
  production_date: string;
  entry_time: string;
  output_quantity: number;
  cumulative_output: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ValidationSummaryRow = {
  attendance_date: string;
  total_reconciled: number;
  validated_count: number;
  face_only_count: number;
  fingerprint_only_count: number;
  leave_count: number;
  absent_count: number;
  needs_review_count: number;
  anomaly_count: number;
};

type DepartmentValidationSummaryRow = {
  attendance_date: string;
  department_name: string;
  validated_count: number;
  face_only_count: number;
  fingerprint_only_count: number;
  leave_count: number;
  absent_count: number;
  needs_review_count: number;
  anomaly_count: number;
};

type ReconciliationExceptionRow = AttendanceReconciliationRow & {
  effective_status: AttendanceReconciliationStatus;
};

export interface Database {
  public: {
    Tables: {
      profiles: GenericTable<
        ProfileRow,
        {
          id: string;
          full_name?: string | null;
          role?: ProfileRow["role"];
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;
      departments: GenericTable<
        DepartmentRow,
        {
          id?: string;
          code?: string | null;
          name: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;
      employees: GenericTable<
        EmployeeRow,
        {
          id?: string;
          employee_code: string;
          employee_category?: EmployeeRow["employee_category"];
          epf_no?: string | null;
          display_name?: string | null;
          designation?: string | null;
          department_id?: string | null;
          department_name?: string | null;
          source_priority_name?: string | null;
          employment_status?: EmployeeRow["employment_status"];
          hire_date?: string | null;
          resigned_at?: string | null;
          resignation_reason?: string | null;
          hr_notes?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;
      employee_code_aliases: GenericTable<
        EmployeeCodeAliasRow,
        {
          id?: string;
          employee_id: string;
          old_employee_code: string;
          new_employee_code: string;
          old_employee_category?: string | null;
          effective_date?: string;
          reason?: string;
          hr_notes?: string | null;
          created_at?: string;
          created_by?: string | null;
        }
      >;
      device_identity_sync_queue: GenericTable<
        DeviceIdentitySyncQueueRow,
        {
          id?: string;
          employee_id?: string | null;
          device_family: DeviceIdentitySyncQueueRow["device_family"];
          action: DeviceIdentitySyncQueueRow["action"];
          old_employee_code?: string | null;
          new_employee_code?: string | null;
          status?: DeviceIdentitySyncQueueRow["status"];
          payload?: Json;
          error_message?: string | null;
          created_at?: string;
          processed_at?: string | null;
        }
      >;
      leave_code_map: GenericTable<
        LeaveCodeMapRow,
        {
          code: string;
          description: string;
          attendance_class: string;
        }
      >;
      import_batches: GenericTable<
        ImportBatchRow,
        {
          id?: string;
          source_type: ImportBatchRow["source_type"];
          original_filename: string;
          storage_path: string;
          file_mime_type?: string | null;
          file_size_bytes?: number | null;
          uploaded_by?: string | null;
          import_status: ImportBatchRow["import_status"];
          total_raw_rows?: number;
          total_valid_rows?: number;
          total_error_rows?: number;
          notes?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      face_raw_rows: GenericTable<
        FaceRawRow,
        {
          id?: string;
          import_batch_id: string;
          row_number: number;
          source_first_name?: string | null;
          source_last_name?: string | null;
          source_employee_id?: string | null;
          source_department?: string | null;
          source_date_text?: string | null;
          source_weekday?: string | null;
          source_records_text?: string | null;
          raw_payload: Json;
          parse_status?: string;
          parse_error?: string | null;
          created_at?: string;
        }
      >;
      fingerprint_raw_rows: GenericTable<
        FingerprintRawRow,
        {
          id?: string;
          import_batch_id: string;
          row_number: number;
          source_emp_no?: string | null;
          source_epf_no?: string | null;
          source_name?: string | null;
          source_designation?: string | null;
          source_department?: string | null;
          source_date_text?: string | null;
          source_time_in_text?: string | null;
          source_time_out_text?: string | null;
          source_late_early_text?: string | null;
          source_day?: string | null;
          source_ot_text?: string | null;
          source_leave_type?: string | null;
          source_leave_days_total_text?: string | null;
          source_nopay_days_total_text?: string | null;
          source_other_leave_days_text?: string | null;
          raw_payload: Json;
          parse_status?: string;
          parse_error?: string | null;
          created_at?: string;
        }
      >;
      face_events: GenericTable<
        FaceEventRow,
        {
          id?: string;
          import_batch_id: string;
          raw_row_id?: string | null;
          employee_code: string;
          event_date: string;
          event_time: string;
          event_timestamp?: string | null;
          event_sequence: number;
          source_records_text?: string | null;
          is_duplicate?: boolean;
          created_at?: string;
        }
      >;
      face_daily_summary: GenericTable<
        FaceDailySummaryRow,
        {
          id?: string;
          import_batch_id: string;
          employee_code: string;
          event_date: string;
          face_first_seen?: string | null;
          face_last_seen?: string | null;
          face_event_count?: number;
          duplicate_event_count?: number;
          normalized_records?: Json;
          quality_flags?: Json;
          created_at?: string;
        }
      >;
      fingerprint_daily_attendance: GenericTable<
        FingerprintDailyAttendanceRow,
        {
          id?: string;
          import_batch_id: string;
          raw_row_id?: string | null;
          employee_code: string;
          epf_no?: string | null;
          employee_name?: string | null;
          designation?: string | null;
          department_name?: string | null;
          attendance_date: string;
          time_in?: string | null;
          time_out?: string | null;
          late_early_hours?: number | null;
          ot_hours?: number | null;
          leave_type?: string | null;
          leave_days_total?: number | null;
          nopay_days_total?: number | null;
          other_leave_days?: number | null;
          attendance_state: FingerprintDailyAttendanceRow["attendance_state"];
          quality_flags?: Json;
          created_at?: string;
        }
      >;
      zkteco_fingerprint_events: GenericTable<
        ZktecoFingerprintEventRow,
        {
          id?: string;
          event_uid: string;
          employee_pin: string;
          employee_code?: string | null;
          employee_id?: string | null;
          matched_employee_name?: string | null;
          matched_department?: string | null;
          match_status: ZktecoFingerprintEventRow["match_status"];
          device_serial_no?: string | null;
          device_ip?: string | null;
          event_time: string;
          attendance_date: string;
          punch_time: string;
          verify_mode?: string | null;
          in_out_mode?: string | null;
          work_code?: string | null;
          reserved_fields?: string[] | null;
          raw_line: string;
          raw_payload?: Json | null;
          received_at?: string;
          created_at?: string;
        }
      >;
      attendance_reconciliation: GenericTable<
        AttendanceReconciliationRow,
        {
          id?: string;
          face_import_batch_id?: string | null;
          fingerprint_import_batch_id?: string | null;
          employee_code: string;
          attendance_date: string;
          employee_name?: string | null;
          designation?: string | null;
          department_name?: string | null;
          face_first_seen?: string | null;
          face_last_seen?: string | null;
          face_event_count?: number | null;
          duplicate_face_event_count?: number | null;
          fingerprint_time_in?: string | null;
          fingerprint_time_out?: string | null;
          late_early_hours?: number | null;
          ot_hours?: number | null;
          leave_type?: string | null;
          reconciliation_status: AttendanceReconciliationStatus;
          exception_reason?: string | null;
          confidence_level?: AttendanceReconciliationRow["confidence_level"];
          rule_flags?: Json;
          manually_overridden?: boolean;
          manual_override_status?: AttendanceReconciliationStatus | null;
          manual_override_reason?: string | null;
          manual_override_by?: string | null;
          manual_override_at?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      reconciliation_notes: GenericTable<
        ReconciliationNoteRow,
        {
          id?: string;
          reconciliation_id: string;
          note: string;
          created_by?: string | null;
          created_at?: string;
        }
      >;
      audit_logs: GenericTable<
        AuditLogRow,
        {
          id?: string;
          actor_user_id?: string | null;
          action_type: string;
          entity_type: string;
          entity_id: string;
          old_value?: Json | null;
          new_value?: Json | null;
          metadata?: Json;
          created_at?: string;
        }
      >;
      production_lines: GenericTable<
        ProductionLineRow,
        {
          id?: string;
          code: string;
          name: string;
          department_name: string;
          shift_name?: ProductionLineRow["shift_name"];
          supervisor_name?: string | null;
          target_manpower?: number;
          target_output?: number;
          current_output?: number;
          current_efficiency?: number;
          allocated_style?: string | null;
          issue?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;
      employee_profiles: GenericTable<
        EmployeeProfileRow,
        {
          employee_id: string;
          shift_name?: EmployeeProfileRow["shift_name"];
          phone?: string | null;
          photo_url?: string | null;
          join_date?: string | null;
          skills?: string[];
          daily_rate?: number;
          ot_hourly_rate?: number;
          created_at?: string;
          updated_at?: string;
        }
      >;
      employee_notes: GenericTable<
        EmployeeNoteRow,
        {
          id?: string;
          employee_id: string;
          note_type: EmployeeNoteRow["note_type"];
          note: string;
          created_by?: string | null;
          created_at?: string;
        }
      >;
      line_assignments: GenericTable<
        LineAssignmentRow,
        {
          id?: string;
          employee_id: string;
          production_line_id: string;
          assigned_at?: string;
          assigned_by?: string | null;
          reason?: string | null;
          status?: LineAssignmentRow["status"];
          ended_at?: string | null;
          created_at?: string;
        }
      >;
      transfer_logs: GenericTable<
        TransferLogOperationalRow,
        {
          id?: string;
          employee_id: string;
          source_line_id?: string | null;
          destination_line_id?: string | null;
          reason: string;
          transferred_at?: string;
          transferred_by?: string | null;
          created_at?: string;
        }
      >;
      operations_alerts: GenericTable<
        OperationsAlertRow,
        {
          id?: string;
          alert_type: OperationsAlertRow["alert_type"];
          priority: OperationsAlertRow["priority"];
          title: string;
          description: string;
          status?: OperationsAlertRow["status"];
          assigned_to_user_id?: string | null;
          employee_id?: string | null;
          line_id?: string | null;
          reconciliation_id?: string | null;
          source?: OperationsAlertRow["source"];
          created_at?: string;
          updated_at?: string;
        }
      >;
      operations_alert_history: GenericTable<
        OperationsAlertHistoryRow,
        {
          id?: string;
          alert_id: string;
          actor_user_id?: string | null;
          action: string;
          created_at?: string;
        }
      >;
      system_settings: GenericTable<
        SystemSettingsRow,
        {
          id?: boolean;
          face_recognition?: boolean;
          fingerprint_verification?: boolean;
          dual_validation_required?: boolean;
          auto_reject_unknown_faces?: boolean;
          manual_verification_fallback?: boolean;
          auto_mark_absent?: boolean;
          morning_shift_start?: string;
          morning_shift_end?: string;
          late_arrival_threshold?: number;
          grace_period?: number;
          failed_entry_alerts?: boolean;
          low_efficiency_warnings?: boolean;
          worker_absence_alerts?: boolean;
          daily_summary_report?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;
      announcements: GenericTable<
        AnnouncementRow,
        {
          id?: string;
          message: string;
          is_active?: boolean;
          display_order?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      calculation_rule_sets: GenericTable<
        CalculationRuleSetRow,
        {
          id?: string;
          rule_type: string;
          rule_set_id: string;
          version: number;
          description?: string | null;
          source_path: string;
          is_active?: boolean;
          checksum?: string | null;
          created_at?: string;
        }
      >;
      calculation_audit_snapshots: GenericTable<
        CalculationAuditSnapshotRow,
        {
          id?: string;
          metric_record_id?: string | null;
          incentive_record_id?: string | null;
          input_payload: Json;
          output_payload: Json;
          warnings?: Json;
          formula_rule_set_id?: string | null;
          formula_rule_version?: number | null;
          incentive_rule_set_id?: string | null;
          incentive_rule_version?: number | null;
          created_at?: string;
        }
      >;
      incentive_records: GenericTable<
        IncentiveRecordOperationalRow,
        {
          id?: string;
          employee_id?: string | null;
          month_start: string;
          amount?: number;
          reason: string;
          production_line_id?: string | null;
          production_date?: string | null;
          line_code?: string | null;
          shift_code?: string | null;
          basis_metric?: string;
          basis_value?: number | null;
          actual_efficiency?: number | null;
          incentive_band_label?: string | null;
          incentive_amount?: number;
          incentive_rule_set_id?: string | null;
          incentive_rule_version?: number | null;
          warnings?: Json;
          source_metric_record_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      production_line_daily_metrics: GenericTable<
        ProductionLineDailyMetricRow,
        {
          id?: string;
          production_line_id: string;
          metric_date: string;
          production_date?: string;
          line_code?: string;
          shift_code?: string | null;
          output?: number;
          target_output?: number;
          efficiency?: number;
          planned_mo?: number | null;
          planned_hel?: number | null;
          actual_mo?: number | null;
          actual_hel?: number | null;
          team_members?: number | null;
          working_hours?: number | null;
          smv?: number | null;
          planned_pcs?: number | null;
          forecast_pcs?: number | null;
          actual_pcs?: number | null;
          planned_cadre_total?: number | null;
          actual_cadre_total?: number | null;
          clock_hours?: number | null;
          planned_sah?: number | null;
          planned_efficiency?: number | null;
          forecast_sah?: number | null;
          forecast_efficiency?: number | null;
          actual_sah?: number | null;
          actual_efficiency?: number | null;
          piece_variance?: number | null;
          sah_variance?: number | null;
          warnings?: Json;
          formula_rule_set_id?: string | null;
          formula_rule_version?: number | null;
          remarks?: string | null;
          lost_time_minutes?: number | null;
          source_metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      production_line_output_entries: GenericTable<
        ProductionLineOutputEntryRow,
        {
          id?: string;
          production_line_id: string;
          production_date: string;
          entry_time: string;
          output_quantity: number;
          cumulative_output?: number;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
    };
    Views: {
      vw_validation_summary: GenericView<ValidationSummaryRow>;
      vw_department_validation_summary: GenericView<DepartmentValidationSummaryRow>;
      vw_reconciliation_exceptions: GenericView<ReconciliationExceptionRow>;
    };
    Functions: {
      app_role: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      has_role: {
        Args: { allowed_roles: string[] };
        Returns: boolean;
      };
      log_audit_event: {
        Args: {
          p_action_type: string;
          p_entity_type: string;
          p_entity_id: string;
          p_old_value?: Json | null;
          p_new_value?: Json | null;
          p_metadata?: Json | null;
        };
        Returns: string;
      };
      rpc_reconcile_attendance: {
        Args: {
          face_batch_id: string;
          fingerprint_batch_id: string;
        };
        Returns: Json;
      };
      rpc_override_reconciliation: {
        Args: {
          p_reconciliation_id: string;
          p_new_status: string;
          p_reason: string;
          p_note?: string | null;
        };
        Returns: Json;
      };
      rpc_add_reconciliation_note: {
        Args: {
          p_reconciliation_id: string;
          p_note: string;
        };
        Returns: Json;
      };
      rpc_assign_worker_to_line: {
        Args: {
          p_employee_id: string;
          p_line_id: string;
          p_reason?: string | null;
        };
        Returns: Json;
      };
      rpc_transfer_worker_line: {
        Args: {
          p_employee_id: string;
          p_destination_line_id: string;
          p_reason: string;
        };
        Returns: Json;
      };
      rpc_convert_employee_to_permanent: {
        Args: {
          p_employee_id: string;
          p_epf_no: string;
          p_effective_date?: string | null;
          p_hr_notes?: string | null;
        };
        Returns: Json;
      };
      rpc_sync_reconciliation_alerts: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      rpc_reactivate_employee: {
        Args: {
          p_employee_id: string;
          p_hr_notes?: string | null;
        };
        Returns: Json;
      };
      rpc_set_employee_inactive: {
        Args: {
          p_employee_id: string;
          p_reason?: string | null;
          p_hr_notes?: string | null;
        };
        Returns: Json;
      };
      rpc_sync_three_day_absence_inactive_alerts: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
