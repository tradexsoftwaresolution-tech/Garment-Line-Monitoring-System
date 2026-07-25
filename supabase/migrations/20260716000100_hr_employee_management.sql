begin;

alter table public.employees
  add column if not exists employment_status text not null default 'active'
    check (employment_status in ('active', 'resigned', 'inactive')),
  add column if not exists hire_date date,
  add column if not exists resigned_at date,
  add column if not exists resignation_reason text,
  add column if not exists hr_notes text;

update public.employees
set employment_status = case when is_active then 'active' else 'inactive' end
where employment_status is null;

update public.employees
set employment_status = 'inactive'
where is_active = false
  and employment_status = 'active';

create index if not exists employees_employment_status_idx
  on public.employees (employment_status, is_active);

create index if not exists employees_hire_date_idx
  on public.employees (hire_date);

create index if not exists employees_resigned_at_idx
  on public.employees (resigned_at);

create or replace function public.rpc_resign_employee(
  p_employee_id uuid,
  p_resigned_at date default current_date,
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
begin
  if not public.has_role(array['admin', 'hr']) then
    raise exception 'Only admin or HR users can resign employees';
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
    employment_status = 'resigned',
    resigned_at = coalesce(p_resigned_at, current_date),
    resignation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
    hr_notes = nullif(btrim(coalesce(p_hr_notes, '')), ''),
    updated_at = now()
  where id = p_employee_id;

  update public.line_assignments
  set
    status = 'Transferred',
    ended_at = now(),
    reason = coalesce(nullif(reason, ''), 'Closed by HR resignation workflow')
  where employee_id = p_employee_id
    and status = 'Active';

  get diagnostics v_closed_assignments = row_count;

  perform public.log_audit_event(
    'employee_resigned',
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
      'employment_status', 'resigned',
      'resigned_at', coalesce(p_resigned_at, current_date),
      'reason', nullif(btrim(coalesce(p_reason, '')), ''),
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

create or replace function public.rpc_reactivate_employee(
  p_employee_id uuid,
  p_hr_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.employees%rowtype;
begin
  if not public.has_role(array['admin', 'hr']) then
    raise exception 'Only admin or HR users can reactivate employees';
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
    is_active = true,
    employment_status = 'active',
    resigned_at = null,
    resignation_reason = null,
    hr_notes = nullif(btrim(coalesce(p_hr_notes, hr_notes, '')), ''),
    updated_at = now()
  where id = p_employee_id;

  perform public.log_audit_event(
    'employee_reactivated',
    'employees',
    p_employee_id::text,
    jsonb_build_object(
      'employee_code', v_employee.employee_code,
      'display_name', v_employee.display_name,
      'is_active', v_employee.is_active,
      'employment_status', v_employee.employment_status
    ),
    jsonb_build_object(
      'is_active', true,
      'employment_status', 'active'
    ),
    jsonb_build_object('source', 'hr_employee_management')
  );

  return jsonb_build_object('ok', true);
end;
$$;

commit;
