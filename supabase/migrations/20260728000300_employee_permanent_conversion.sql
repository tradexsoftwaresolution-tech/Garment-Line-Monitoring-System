begin;

create table if not exists public.employee_code_aliases (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  old_employee_code text not null,
  new_employee_code text not null,
  old_employee_category text,
  effective_date date not null default current_date,
  reason text not null default 'converted_to_permanent',
  hr_notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint employee_code_aliases_old_code_not_blank check (btrim(old_employee_code) <> ''),
  constraint employee_code_aliases_new_code_not_blank check (btrim(new_employee_code) <> ''),
  constraint employee_code_aliases_old_new_distinct check (old_employee_code <> new_employee_code),
  constraint employee_code_aliases_old_code_unique unique (old_employee_code)
);

create table if not exists public.device_identity_sync_queue (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees (id) on delete set null,
  device_family text not null check (device_family in ('hikvision', 'zkteco')),
  action text not null check (action in ('delete_identity', 'upsert_identity')),
  old_employee_code text,
  new_employee_code text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'skipped')),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint device_identity_sync_queue_identity_code_present check (
    old_employee_code is not null or new_employee_code is not null
  )
);

create index if not exists employee_code_aliases_employee_id_idx
  on public.employee_code_aliases (employee_id, created_at desc);

create index if not exists employee_code_aliases_new_code_idx
  on public.employee_code_aliases (new_employee_code);

create index if not exists device_identity_sync_queue_status_idx
  on public.device_identity_sync_queue (status, created_at);

create index if not exists device_identity_sync_queue_employee_idx
  on public.device_identity_sync_queue (employee_id, created_at desc);

alter table public.employee_code_aliases enable row level security;
alter table public.device_identity_sync_queue enable row level security;

grant select, insert, update, delete on public.employee_code_aliases to authenticated;
grant select, insert, update, delete on public.device_identity_sync_queue to authenticated;

drop policy if exists "employee_code_aliases_select_operational_roles" on public.employee_code_aliases;
create policy "employee_code_aliases_select_operational_roles"
on public.employee_code_aliases
for select
to authenticated
using (public.has_role(array['admin', 'hr', 'supervisor', 'ie']));

drop policy if exists "employee_code_aliases_manage_hr_admin" on public.employee_code_aliases;
create policy "employee_code_aliases_manage_hr_admin"
on public.employee_code_aliases
for all
to authenticated
using (public.has_role(array['admin', 'hr']))
with check (public.has_role(array['admin', 'hr']));

drop policy if exists "device_identity_sync_queue_select_operational_roles" on public.device_identity_sync_queue;
create policy "device_identity_sync_queue_select_operational_roles"
on public.device_identity_sync_queue
for select
to authenticated
using (public.has_role(array['admin', 'hr', 'supervisor', 'ie']));

drop policy if exists "device_identity_sync_queue_manage_hr_admin" on public.device_identity_sync_queue;
create policy "device_identity_sync_queue_manage_hr_admin"
on public.device_identity_sync_queue
for all
to authenticated
using (public.has_role(array['admin', 'hr']))
with check (public.has_role(array['admin', 'hr']));

create or replace function public.rpc_convert_employee_to_permanent(
  p_employee_id uuid,
  p_epf_no text,
  p_effective_date date default current_date,
  p_hr_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.employees%rowtype;
  v_old_code text;
  v_new_code text := btrim(coalesce(p_epf_no, ''));
  v_effective_date date := coalesce(p_effective_date, current_date);
  v_updated_reconciliation integer := 0;
  v_updated_fingerprint_daily integer := 0;
  v_updated_face_daily integer := 0;
  v_updated_face_import integer := 0;
  v_updated_hikvision integer := 0;
  v_updated_zkteco integer := 0;
  v_queued_actions integer := 0;
  v_existing_employee_name text;
  v_identity_payload jsonb;
begin
  if not public.has_role(array['admin', 'hr']) then
    raise exception 'This action requires HR or admin access.';
  end if;

  if v_new_code = '' then
    raise exception 'Official EPF number is required.';
  end if;

  if v_new_code like '101%' or v_new_code like '303%' then
    raise exception 'Permanent EPF number cannot use temporary 101 or 303 prefixes.';
  end if;

  select *
  into v_employee
  from public.employees
  where id = p_employee_id
  for update;

  if not found then
    raise exception 'Employee was not found.';
  end if;

  if coalesce(v_employee.employment_status, 'active') = 'resigned' then
    raise exception 'Resigned employees cannot be converted to permanent.';
  end if;

  if coalesce(v_employee.employee_category, 'permanent') = 'permanent' then
    raise exception 'This employee is already permanent.';
  end if;

  v_old_code := v_employee.employee_code;

  if v_old_code = v_new_code then
    raise exception 'Permanent EPF number must be different from the temporary key.';
  end if;

  select display_name
  into v_existing_employee_name
  from public.employees
  where employee_code = v_new_code
    and id <> p_employee_id
  limit 1;

  if found then
    raise exception 'EPF % is already assigned to %.', v_new_code, coalesce(v_existing_employee_name, 'another employee');
  end if;

  insert into public.employee_code_aliases (
    employee_id,
    old_employee_code,
    new_employee_code,
    old_employee_category,
    effective_date,
    reason,
    hr_notes,
    created_by
  )
  values (
    p_employee_id,
    v_old_code,
    v_new_code,
    v_employee.employee_category,
    v_effective_date,
    'converted_to_permanent',
    nullif(btrim(coalesce(p_hr_notes, '')), ''),
    auth.uid()
  )
  on conflict (old_employee_code) do update
  set
    employee_id = excluded.employee_id,
    new_employee_code = excluded.new_employee_code,
    old_employee_category = excluded.old_employee_category,
    effective_date = excluded.effective_date,
    reason = excluded.reason,
    hr_notes = excluded.hr_notes;

  update public.attendance_reconciliation as reconciliation
  set
    employee_code = v_new_code,
    employee_name = coalesce(reconciliation.employee_name, v_employee.display_name),
    designation = coalesce(reconciliation.designation, v_employee.designation),
    department_name = coalesce(reconciliation.department_name, v_employee.department_name),
    updated_at = now()
  where reconciliation.employee_code = v_old_code
    and not exists (
      select 1
      from public.attendance_reconciliation as target
      where target.employee_code = v_new_code
        and target.attendance_date = reconciliation.attendance_date
    );
  get diagnostics v_updated_reconciliation = row_count;

  update public.fingerprint_daily_attendance as attendance
  set
    employee_code = v_new_code,
    epf_no = v_new_code,
    employee_name = coalesce(attendance.employee_name, v_employee.display_name),
    designation = coalesce(attendance.designation, v_employee.designation),
    department_name = coalesce(attendance.department_name, v_employee.department_name)
  where attendance.employee_code = v_old_code
    and not exists (
      select 1
      from public.fingerprint_daily_attendance as target
      where target.import_batch_id = attendance.import_batch_id
        and target.employee_code = v_new_code
        and target.attendance_date = attendance.attendance_date
    );
  get diagnostics v_updated_fingerprint_daily = row_count;

  update public.face_daily_summary as summary
  set employee_code = v_new_code
  where summary.employee_code = v_old_code
    and not exists (
      select 1
      from public.face_daily_summary as target
      where target.import_batch_id = summary.import_batch_id
        and target.employee_code = v_new_code
        and target.event_date = summary.event_date
    );
  get diagnostics v_updated_face_daily = row_count;

  update public.face_events as event
  set employee_code = v_new_code
  where event.employee_code = v_old_code
    and not exists (
      select 1
      from public.face_events as target
      where target.import_batch_id = event.import_batch_id
        and target.employee_code = v_new_code
        and target.event_date = event.event_date
        and target.event_time = event.event_time
        and target.event_sequence = event.event_sequence
    );
  get diagnostics v_updated_face_import = row_count;

  update public.hikvision_face_events
  set
    employee_code = v_new_code,
    employee_id = p_employee_id,
    matched_employee_name = v_employee.display_name,
    matched_department = v_employee.department_name,
    match_status = 'matched'
  where employee_id = p_employee_id
     or employee_code = v_old_code;
  get diagnostics v_updated_hikvision = row_count;

  update public.zkteco_fingerprint_events
  set
    employee_code = v_new_code,
    employee_id = p_employee_id,
    matched_employee_name = v_employee.display_name,
    matched_department = v_employee.department_name,
    match_status = 'matched'
  where employee_id = p_employee_id
     or employee_code = v_old_code
     or employee_pin = v_old_code;
  get diagnostics v_updated_zkteco = row_count;

  update public.employees
  set
    employee_code = v_new_code,
    employee_category = 'permanent',
    epf_no = v_new_code,
    employment_status = 'active',
    is_active = true,
    hr_notes = nullif(
      concat_ws(
        E'\n',
        nullif(btrim(coalesce(v_employee.hr_notes, '')), ''),
        nullif(btrim(coalesce(p_hr_notes, '')), ''),
        format(
          'Converted from %s key %s to permanent EPF %s effective %s.',
          coalesce(v_employee.employee_category, 'temporary'),
          v_old_code,
          v_new_code,
          v_effective_date
        )
      ),
      ''
    ),
    updated_at = now()
  where id = p_employee_id;

  insert into public.employee_notes (employee_id, note_type, note, created_by)
  values (
    p_employee_id,
    'note',
    format(
      'HR converted employee from %s key %s to permanent EPF %s effective %s.',
      coalesce(v_employee.employee_category, 'temporary'),
      v_old_code,
      v_new_code,
      v_effective_date
    ),
    auth.uid()
  );

  v_identity_payload := jsonb_build_object(
    'reason', 'employee_converted_to_permanent',
    'effective_date', v_effective_date,
    'employee_name', v_employee.display_name
  );

  if not exists (
    select 1
    from public.device_identity_sync_queue
    where employee_id = p_employee_id
      and device_family = 'hikvision'
      and action = 'delete_identity'
      and old_employee_code = v_old_code
      and status in ('pending', 'processing')
  ) then
    insert into public.device_identity_sync_queue (
      employee_id, device_family, action, old_employee_code, new_employee_code, payload
    )
    values (
      p_employee_id, 'hikvision', 'delete_identity', v_old_code, v_new_code, v_identity_payload
    );
    v_queued_actions := v_queued_actions + 1;
  end if;

  if not exists (
    select 1
    from public.device_identity_sync_queue
    where employee_id = p_employee_id
      and device_family = 'zkteco'
      and action = 'delete_identity'
      and old_employee_code = v_old_code
      and status in ('pending', 'processing')
  ) then
    insert into public.device_identity_sync_queue (
      employee_id, device_family, action, old_employee_code, new_employee_code, payload
    )
    values (
      p_employee_id, 'zkteco', 'delete_identity', v_old_code, v_new_code, v_identity_payload
    );
    v_queued_actions := v_queued_actions + 1;
  end if;

  perform public.log_audit_event(
    'employee_converted_to_permanent',
    'employees',
    p_employee_id::text,
    jsonb_build_object(
      'employee_code', v_old_code,
      'employee_category', v_employee.employee_category,
      'epf_no', v_employee.epf_no
    ),
    jsonb_build_object(
      'employee_code', v_new_code,
      'employee_category', 'permanent',
      'epf_no', v_new_code
    ),
    jsonb_build_object(
      'effective_date', v_effective_date,
      'queued_device_actions', v_queued_actions
    )
  );

  return jsonb_build_object(
    'ok', true,
    'old_employee_code', v_old_code,
    'new_employee_code', v_new_code,
    'updated_reconciliation_rows', v_updated_reconciliation,
    'updated_fingerprint_daily_rows', v_updated_fingerprint_daily,
    'updated_face_daily_rows', v_updated_face_daily,
    'updated_face_import_rows', v_updated_face_import,
    'updated_hikvision_events', v_updated_hikvision,
    'updated_zkteco_events', v_updated_zkteco,
    'queued_device_actions', v_queued_actions
  );
end;
$$;

grant execute on function public.rpc_convert_employee_to_permanent(uuid, text, date, text) to authenticated;

commit;
