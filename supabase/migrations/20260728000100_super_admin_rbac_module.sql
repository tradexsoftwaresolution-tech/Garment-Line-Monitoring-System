begin;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('super_admin', 'admin', 'supervisor', 'hr', 'ie', 'viewer'));

create table if not exists public.rbac_roles (
  role_code text primary key,
  label text not null,
  description text not null default '',
  is_system_role boolean not null default true,
  is_active boolean not null default true,
  display_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rbac_roles_code_not_blank check (btrim(role_code) <> ''),
  constraint rbac_roles_display_order_non_negative check (display_order >= 0)
);

create table if not exists public.rbac_permissions (
  permission_key text primary key,
  permission_type text not null check (permission_type in ('route', 'action')),
  label text not null,
  description text not null default '',
  is_active boolean not null default true,
  display_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rbac_permissions_key_not_blank check (btrim(permission_key) <> ''),
  constraint rbac_permissions_display_order_non_negative check (display_order >= 0)
);

create table if not exists public.rbac_role_permissions (
  role_code text not null references public.rbac_roles (role_code) on delete cascade,
  permission_key text not null references public.rbac_permissions (permission_key) on delete cascade,
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now(),
  primary key (role_code, permission_key)
);

drop trigger if exists set_rbac_roles_updated_at on public.rbac_roles;
create trigger set_rbac_roles_updated_at
before update on public.rbac_roles
for each row
execute function public.touch_updated_at();

drop trigger if exists set_rbac_permissions_updated_at on public.rbac_permissions;
create trigger set_rbac_permissions_updated_at
before update on public.rbac_permissions
for each row
execute function public.touch_updated_at();

create or replace function public.has_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or (
      auth.uid() is not null
      and (
        public.app_role() = 'super_admin'
        or public.app_role() = any(allowed_roles)
      )
    );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_employee_code text;
  v_employee_id uuid;
begin
  v_role := case
    when coalesce(new.raw_user_meta_data ->> 'role', '') in ('super_admin', 'admin', 'supervisor', 'hr', 'ie', 'viewer')
      then new.raw_user_meta_data ->> 'role'
    else 'viewer'
  end;

  v_employee_code := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'employee_code', '')), '');

  if v_employee_code is not null then
    select employees.id
    into v_employee_id
    from public.employees
    where employees.employee_code = v_employee_code
    limit 1;
  end if;

  insert into public.profiles (id, full_name, role, employee_code, employee_id)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    v_role,
    v_employee_code,
    v_employee_id
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

insert into public.rbac_roles (role_code, label, description, is_system_role, is_active, display_order)
values
  ('super_admin', 'Super Admin', 'Owns platform access, role grants, administrators, and protected configuration.', true, true, 10),
  ('admin', 'Admin', 'Runs factory operations, settings, reports, and audit workflows.', true, true, 20),
  ('supervisor', 'Supervisor', 'Manages production floor lines, workers, transfers, alerts, and balancing.', true, true, 30),
  ('hr', 'HR', 'Manages employee records, imports, leave, validation, attendance, and reports.', true, true, 40),
  ('ie', 'IE', 'Uses industrial engineering line attendance, floor plan, analytics, and planning views.', true, true, 50),
  ('viewer', 'Viewer / Management', 'Reads dashboards, reports, display mode, and self-service views.', true, true, 60)
on conflict (role_code) do update
set
  label = excluded.label,
  description = excluded.description,
  is_system_role = excluded.is_system_role,
  is_active = excluded.is_active,
  display_order = excluded.display_order,
  updated_at = now();

insert into public.rbac_permissions (permission_key, permission_type, label, description, is_active, display_order)
values
  ('route.dashboard', 'route', 'Dashboard', 'Open the main operations dashboard.', true, 10),
  ('route.ieLineAttendance', 'route', 'Line Attendance', 'Open the IE line attendance module.', true, 20),
  ('route.ieLineFloorPlan', 'route', 'Line Floor Plan', 'Open line floor plan details.', true, 30),
  ('route.ieAnalytics', 'route', 'IE Analytics', 'Open industrial engineering analytics.', true, 40),
  ('route.imports', 'route', 'Import Center', 'Open attendance import workflows.', true, 50),
  ('route.workers', 'route', 'Workers', 'Open worker search and roster views.', true, 60),
  ('route.employeeManagement', 'route', 'Employee Management', 'Open HR employee management.', true, 70),
  ('route.workerProfile', 'route', 'Worker Profile', 'Open individual worker profiles.', true, 80),
  ('route.leaveManagement', 'route', 'Leave Management', 'Open employee leave management.', true, 90),
  ('route.employeePortal', 'route', 'Employee Portal', 'Open employee portal views.', true, 100),
  ('route.validation', 'route', 'Validation Center', 'Open attendance validation workflows.', true, 110),
  ('route.hikvision', 'route', 'Hikvision Face Recognition', 'Open Hikvision face recognition views.', true, 120),
  ('route.zkteco', 'route', 'ZKTeco Fingerprint', 'Open ZKTeco fingerprint views.', true, 130),
  ('route.skillMatrix', 'route', 'Skill Matrix', 'Open skill matrix planning.', true, 140),
  ('route.productionLines', 'route', 'Production Lines', 'Open production line views.', true, 150),
  ('route.lineAssignment', 'route', 'Line Assignment', 'Open line assignment workflows.', true, 160),
  ('route.alerts', 'route', 'Alerts Center', 'Open operations alerts.', true, 170),
  ('route.attendance', 'route', 'Incentive Calculation', 'Open attendance and incentive calculation.', true, 180),
  ('route.reports', 'route', 'Reports', 'Open reporting views.', true, 190),
  ('route.settings', 'route', 'Settings', 'Open system settings.', true, 200),
  ('route.audit', 'route', 'Audit Log', 'Open audit history.', true, 210),
  ('route.selfService', 'route', 'Self-Service Portal', 'Open self-service views.', true, 220),
  ('route.display', 'route', 'Display Mode', 'Open display mode.', true, 230),
  ('action.manageRoleAccess', 'action', 'Manage Role Access', 'Edit RBAC permission grants.', true, 1000),
  ('action.manageWorkers', 'action', 'Manage Workers', 'Create or update worker operational data.', true, 1010),
  ('action.assignLine', 'action', 'Assign Line', 'Assign employees to production lines.', true, 1020),
  ('action.transferLine', 'action', 'Transfer Line', 'Transfer employees between production lines.', true, 1030),
  ('action.resolveValidation', 'action', 'Resolve Validation', 'Resolve validation exceptions.', true, 1040),
  ('action.markValidationVerified', 'action', 'Mark Validation Verified', 'Mark validation items as verified.', true, 1050),
  ('action.escalateValidation', 'action', 'Escalate Validation', 'Escalate validation items.', true, 1060),
  ('action.manageAlerts', 'action', 'Manage Alerts', 'Create, update, read, or resolve alerts.', true, 1070),
  ('action.exportAttendance', 'action', 'Export Attendance', 'Export attendance data.', true, 1080),
  ('action.exportReports', 'action', 'Export Reports', 'Export report data.', true, 1090),
  ('action.editSettings', 'action', 'Edit Settings', 'Update system settings.', true, 1100),
  ('action.addLineOutput', 'action', 'Add Line Output', 'Record production output.', true, 1110),
  ('action.overrideAttendance', 'action', 'Override Attendance', 'Override attendance status.', true, 1120),
  ('action.addWorkerNote', 'action', 'Add Worker Note', 'Add notes to worker or validation records.', true, 1130),
  ('action.markException', 'action', 'Mark Exception', 'Mark operational exceptions.', true, 1140),
  ('action.viewAudit', 'action', 'View Audit', 'Open detailed audit records.', true, 1150)
on conflict (permission_key) do update
set
  permission_type = excluded.permission_type,
  label = excluded.label,
  description = excluded.description,
  is_active = excluded.is_active,
  display_order = excluded.display_order,
  updated_at = now();

insert into public.rbac_role_permissions (role_code, permission_key)
select 'super_admin', permission_key
from public.rbac_permissions
where is_active
on conflict (role_code, permission_key) do nothing;

with default_grants(role_code, permission_keys) as (
  values
    ('admin', array[
      'route.dashboard', 'route.ieLineAttendance', 'route.ieLineFloorPlan', 'route.ieAnalytics',
      'route.imports', 'route.workers', 'route.employeeManagement', 'route.workerProfile',
      'route.leaveManagement', 'route.employeePortal', 'route.validation', 'route.hikvision',
      'route.zkteco', 'route.skillMatrix', 'route.productionLines', 'route.lineAssignment',
      'route.alerts', 'route.attendance', 'route.reports', 'route.settings', 'route.audit',
      'route.selfService', 'route.display',
      'action.manageWorkers', 'action.assignLine', 'action.transferLine', 'action.resolveValidation',
      'action.markValidationVerified', 'action.escalateValidation', 'action.manageAlerts',
      'action.exportAttendance', 'action.exportReports', 'action.editSettings', 'action.addLineOutput',
      'action.overrideAttendance', 'action.addWorkerNote', 'action.markException', 'action.viewAudit'
    ]::text[]),
    ('supervisor', array[
      'route.dashboard', 'route.workers', 'route.workerProfile', 'route.employeePortal', 'route.validation',
      'route.hikvision', 'route.zkteco', 'route.skillMatrix', 'route.productionLines',
      'route.lineAssignment', 'route.alerts', 'route.attendance', 'route.reports', 'route.selfService',
      'route.display',
      'action.manageWorkers', 'action.assignLine', 'action.transferLine', 'action.manageAlerts',
      'action.exportReports', 'action.addLineOutput', 'action.addWorkerNote', 'action.markException'
    ]::text[]),
    ('hr', array[
      'route.dashboard', 'route.imports', 'route.workers', 'route.employeeManagement', 'route.workerProfile',
      'route.leaveManagement', 'route.employeePortal', 'route.validation', 'route.hikvision',
      'route.zkteco', 'route.productionLines', 'route.alerts', 'route.reports', 'route.audit',
      'route.selfService', 'route.display',
      'action.manageWorkers', 'action.resolveValidation', 'action.markValidationVerified',
      'action.escalateValidation', 'action.manageAlerts', 'action.exportAttendance', 'action.exportReports',
      'action.overrideAttendance', 'action.addWorkerNote', 'action.markException'
    ]::text[]),
    ('ie', array[
      'route.dashboard', 'route.ieLineAttendance', 'route.ieLineFloorPlan', 'route.ieAnalytics',
      'route.workers', 'route.workerProfile', 'route.employeePortal', 'route.hikvision',
      'route.zkteco', 'route.alerts', 'route.selfService', 'route.display',
      'action.manageAlerts'
    ]::text[]),
    ('viewer', array[
      'route.dashboard', 'route.employeePortal', 'route.hikvision', 'route.zkteco',
      'route.productionLines', 'route.attendance', 'route.reports', 'route.selfService',
      'route.display',
      'action.exportReports'
    ]::text[])
)
insert into public.rbac_role_permissions (role_code, permission_key)
select role_code, permission_key
from default_grants
cross join lateral unnest(permission_keys) as permissions(permission_key)
on conflict (role_code, permission_key) do nothing;

alter table public.rbac_roles enable row level security;
alter table public.rbac_permissions enable row level security;
alter table public.rbac_role_permissions enable row level security;

grant select, insert, update, delete on public.rbac_roles to authenticated;
grant select, insert, update, delete on public.rbac_permissions to authenticated;
grant select, insert, update, delete on public.rbac_role_permissions to authenticated;

drop policy if exists "rbac_roles_read_authenticated" on public.rbac_roles;
create policy "rbac_roles_read_authenticated"
on public.rbac_roles
for select
to authenticated
using (public.has_role(array['admin', 'hr', 'supervisor', 'ie', 'viewer']));

drop policy if exists "rbac_permissions_read_authenticated" on public.rbac_permissions;
create policy "rbac_permissions_read_authenticated"
on public.rbac_permissions
for select
to authenticated
using (public.has_role(array['admin', 'hr', 'supervisor', 'ie', 'viewer']));

drop policy if exists "rbac_role_permissions_read_authenticated" on public.rbac_role_permissions;
create policy "rbac_role_permissions_read_authenticated"
on public.rbac_role_permissions
for select
to authenticated
using (public.has_role(array['admin', 'hr', 'supervisor', 'ie', 'viewer']));

drop policy if exists "rbac_roles_manage_super_admin" on public.rbac_roles;
create policy "rbac_roles_manage_super_admin"
on public.rbac_roles
for all
to authenticated
using (public.has_role(array['super_admin']))
with check (public.has_role(array['super_admin']));

drop policy if exists "rbac_permissions_manage_super_admin" on public.rbac_permissions;
create policy "rbac_permissions_manage_super_admin"
on public.rbac_permissions
for all
to authenticated
using (public.has_role(array['super_admin']))
with check (public.has_role(array['super_admin']));

drop policy if exists "rbac_role_permissions_manage_super_admin" on public.rbac_role_permissions;
create policy "rbac_role_permissions_manage_super_admin"
on public.rbac_role_permissions
for all
to authenticated
using (public.has_role(array['super_admin']))
with check (public.has_role(array['super_admin']));

create or replace function public.replace_rbac_role_permissions(p_grants jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_count integer;
begin
  if not public.has_role(array['super_admin']) then
    raise exception 'Only super_admin can manage role access.' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_grants, '[]'::jsonb)) <> 'array' then
    raise exception 'Role permission grants must be a JSON array.' using errcode = '22023';
  end if;

  delete from public.rbac_role_permissions;

  insert into public.rbac_role_permissions (role_code, permission_key, granted_by, granted_at)
  select distinct
    input.role_code,
    input.permission_key,
    auth.uid(),
    now()
  from jsonb_to_recordset(coalesce(p_grants, '[]'::jsonb)) as input(role_code text, permission_key text)
  inner join public.rbac_roles roles
    on roles.role_code = input.role_code
    and roles.is_active
  inner join public.rbac_permissions permissions
    on permissions.permission_key = input.permission_key
    and permissions.is_active
  where btrim(coalesce(input.role_code, '')) <> ''
    and btrim(coalesce(input.permission_key, '')) <> ''
    and (
      input.permission_key <> 'action.manageRoleAccess'
      or input.role_code = 'super_admin'
    );

  get diagnostics v_updated_count = row_count;

  perform public.log_audit_event(
    'rbac.role_permissions.replace',
    'rbac_role_permissions',
    'role-access',
    null,
    jsonb_build_object('grantCount', v_updated_count),
    jsonb_build_object('module', 'rbac')
  );

  return jsonb_build_object('updatedCount', v_updated_count);
end;
$$;

grant execute on function public.replace_rbac_role_permissions(jsonb) to authenticated;

commit;
