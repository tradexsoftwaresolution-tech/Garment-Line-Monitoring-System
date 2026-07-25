begin;

create or replace function public.rpc_set_employee_inactive(
  p_employee_id uuid,
  p_reason text default null,
  p_hr_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.employees%rowtype;
  v_closed_assignments integer := 0;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_hr_notes text := nullif(btrim(coalesce(p_hr_notes, '')), '');
begin
  if not public.has_role(array['admin', 'hr']) then
    raise exception 'Only admin or HR users can mark employees inactive';
  end if;

  select *
  into v_employee
  from public.employees
  where id = p_employee_id
  for update;

  if not found then
    raise exception 'Employee % was not found', p_employee_id;
  end if;

  update public.employees
  set
    is_active = false,
    employment_status = 'inactive',
    resigned_at = null,
    resignation_reason = null,
    hr_notes = coalesce(v_hr_notes, hr_notes),
    updated_at = now()
  where id = p_employee_id;

  update public.line_assignments
  set
    status = 'Transferred',
    ended_at = now(),
    reason = coalesce(v_reason, nullif(reason, ''), 'Closed by HR inactive-status workflow')
  where employee_id = p_employee_id
    and status = 'Active';

  get diagnostics v_closed_assignments = row_count;

  perform public.log_audit_event(
    'employee_marked_inactive',
    'employees',
    p_employee_id::text,
    jsonb_build_object(
      'employee_code', v_employee.employee_code,
      'display_name', v_employee.display_name,
      'is_active', v_employee.is_active,
      'employment_status', v_employee.employment_status
    ),
    jsonb_build_object(
      'is_active', false,
      'employment_status', 'inactive',
      'reason', v_reason,
      'closed_assignments', v_closed_assignments
    ),
    jsonb_build_object('source', 'hr_employee_management')
  );

  return jsonb_build_object(
    'ok', true,
    'closed_assignments', v_closed_assignments
  );
end;
$$;

create or replace function public.rpc_sync_three_day_absence_inactive_alerts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date_count integer := 0;
  v_inactivated_count integer := 0;
  v_alert_count integer := 0;
  v_resolved_count integer := 0;
  v_closed_assignments integer := 0;
  v_note_count integer := 0;
  v_history_count integer := 0;
  v_audit_count integer := 0;
  v_alert_title text := 'Employee automatically marked inactive after 3 unapproved absent days';
begin
  if not public.has_role(array['admin', 'hr']) then
    raise exception 'Only admin or HR users can synchronize inactive absence alerts';
  end if;

  with latest_dates as (
    select attendance_date
    from (
      select distinct attendance_date
      from public.attendance_reconciliation
      where attendance_date <= current_date
      order by attendance_date desc
      limit 3
    ) as dates
  )
  select count(*) into v_date_count from latest_dates;

  if v_date_count < 3 then
    return jsonb_build_object(
      'ok', true,
      'inactivated_count', 0,
      'alert_count', 0,
      'resolved_count', 0,
      'closed_assignments', 0,
      'reason', 'Not enough attendance dates'
    );
  end if;

  with latest_dates as (
    select attendance_date
    from (
      select distinct attendance_date
      from public.attendance_reconciliation
      where attendance_date <= current_date
      order by attendance_date desc
      limit 3
    ) as dates
  ),
  date_bounds as (
    select min(attendance_date) as first_date, max(attendance_date) as last_date
    from latest_dates
  ),
  candidates as (
    select
      employees.id as employee_id,
      employees.employee_code,
      coalesce(employees.display_name, employees.employee_code) as display_name,
      assignment.production_line_id as line_id,
      date_bounds.first_date,
      date_bounds.last_date
    from public.employees
    cross join date_bounds
    left join lateral (
      select production_line_id
      from public.line_assignments
      where employee_id = employees.id
        and status = 'Active'
      order by assigned_at desc
      limit 1
    ) as assignment on true
    where employees.is_active = true
      and coalesce(employees.employment_status, 'active') = 'active'
      and (employees.hire_date is null or employees.hire_date <= date_bounds.first_date)
      and not exists (
        select 1
        from public.employee_leave_requests as leave_requests
        join latest_dates on latest_dates.attendance_date
          between leave_requests.start_date and leave_requests.end_date
        where leave_requests.employee_id = employees.id
          and leave_requests.status = 'approved'
      )
      and (
        select count(distinct reconciliation.attendance_date)
        from public.attendance_reconciliation as reconciliation
        join latest_dates on latest_dates.attendance_date = reconciliation.attendance_date
        where reconciliation.employee_code = employees.employee_code
          and coalesce(reconciliation.manual_override_status, reconciliation.reconciliation_status) = 'absent'
          and nullif(btrim(coalesce(reconciliation.leave_type, '')), '') is null
      ) = 3
  ),
  updated_employees as (
    update public.employees as employees
    set
      is_active = false,
      employment_status = 'inactive',
      hr_notes = nullif(
        concat_ws(
          E'\n',
          nullif(employees.hr_notes, ''),
          format(
            'Auto-inactivated on %s after absent attendance without approved leave from %s to %s.',
            current_date,
            candidates.first_date,
            candidates.last_date
          )
        ),
        ''
      ),
      updated_at = now()
    from candidates
    where employees.id = candidates.employee_id
    returning
      employees.id as employee_id,
      candidates.employee_code,
      candidates.display_name,
      candidates.line_id,
      candidates.first_date,
      candidates.last_date
  ),
  closed_assignments as (
    update public.line_assignments as assignments
    set
      status = 'Transferred',
      ended_at = now(),
      reason = coalesce(
        nullif(assignments.reason, ''),
        'Closed by automatic 3-day unapproved absence rule'
      )
    from updated_employees
    where assignments.employee_id = updated_employees.employee_id
      and assignments.status = 'Active'
    returning assignments.id
  ),
  inserted_notes as (
    insert into public.employee_notes (employee_id, note_type, note)
    select
      updated_employees.employee_id,
      'flag',
      format(
        'Auto-inactivated after three consecutive absent attendance days without approved leave (%s to %s).',
        updated_employees.first_date,
        updated_employees.last_date
      )
    from updated_employees
    returning id
  ),
  inserted_alerts as (
    insert into public.operations_alerts (
      alert_type,
      priority,
      title,
      description,
      status,
      employee_id,
      line_id,
      source
    )
    select
      'attendance anomaly',
      'high',
      v_alert_title,
      format(
        '%s (%s) was automatically marked inactive after absent attendance for three consecutive attendance days without approved leave: %s to %s.',
        updated_employees.display_name,
        updated_employees.employee_code,
        updated_employees.first_date,
        updated_employees.last_date
      ),
      'Open',
      updated_employees.employee_id,
      updated_employees.line_id,
      'system'
    from updated_employees
    where not exists (
      select 1
      from public.operations_alerts as existing_alerts
      where existing_alerts.employee_id = updated_employees.employee_id
        and existing_alerts.source = 'system'
        and existing_alerts.title = v_alert_title
        and existing_alerts.status <> 'Resolved'
    )
    returning id
  ),
  inserted_history as (
    insert into public.operations_alert_history (alert_id, action)
    select
      inserted_alerts.id,
      'Auto-generated by 3-day unapproved absence rule.'
    from inserted_alerts
    returning id
  ),
  audit_rows as (
    select public.log_audit_event(
      'employee_auto_marked_inactive',
      'employees',
      updated_employees.employee_id::text,
      null,
      jsonb_build_object(
        'employee_code', updated_employees.employee_code,
        'employment_status', 'inactive',
        'first_absent_date', updated_employees.first_date,
        'last_absent_date', updated_employees.last_date
      ),
      jsonb_build_object('source', 'three_day_absence_rule')
    ) as audit_id
    from updated_employees
  ),
  resolved_alerts as (
    update public.operations_alerts as alerts
    set
      status = 'Resolved',
      updated_at = now()
    from public.employees
    where alerts.employee_id = employees.id
      and alerts.source = 'system'
      and alerts.title = v_alert_title
      and alerts.status <> 'Resolved'
      and employees.is_active = true
      and coalesce(employees.employment_status, 'active') = 'active'
    returning alerts.id
  )
  select
    (select count(*) from updated_employees),
    (select count(*) from inserted_alerts),
    (select count(*) from resolved_alerts),
    (select count(*) from closed_assignments),
    (select count(*) from inserted_notes),
    (select count(*) from inserted_history),
    (select count(*) from audit_rows)
  into
    v_inactivated_count,
    v_alert_count,
    v_resolved_count,
    v_closed_assignments,
    v_note_count,
    v_history_count,
    v_audit_count;

  return jsonb_build_object(
    'ok', true,
    'inactivated_count', v_inactivated_count,
    'alert_count', v_alert_count,
    'resolved_count', v_resolved_count,
    'closed_assignments', v_closed_assignments,
    'note_count', v_note_count,
    'history_count', v_history_count,
    'audit_count', v_audit_count
  );
end;
$$;

grant execute on function public.rpc_set_employee_inactive(uuid, text, text) to authenticated;
grant execute on function public.rpc_sync_three_day_absence_inactive_alerts() to authenticated;

commit;
