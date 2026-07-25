begin;

alter table public.departments add column if not exists code text;
alter table public.departments add column if not exists description text;
alter table public.departments add column if not exists is_active boolean not null default true;
alter table public.departments add column if not exists created_at timestamptz not null default now();
alter table public.departments add column if not exists updated_at timestamptz not null default now();

with normalized as (
  select
    id,
    upper(regexp_replace(coalesce(nullif(btrim(name), ''), id::text), '[^A-Za-z0-9]+', '_', 'g')) as base_code,
    row_number() over (
      partition by upper(regexp_replace(coalesce(nullif(btrim(name), ''), id::text), '[^A-Za-z0-9]+', '_', 'g'))
      order by name, id
    ) as rn
  from public.departments
)
update public.departments department
set code =
  case
    when normalized.rn = 1 then left(normalized.base_code, 60)
    else left(normalized.base_code, 54) || '_' || normalized.rn::text
  end
from normalized
where department.id = normalized.id
  and (department.code is null or btrim(department.code) = '');

alter table public.departments alter column code set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'departments_code_key'
  ) then
    alter table public.departments add constraint departments_code_key unique (code);
  end if;
end $$;

alter table public.employees
  add column if not exists department_id uuid references public.departments(id) on delete set null;

with source_departments as (
  select distinct btrim(department_name) as name
  from public.employees
  where nullif(btrim(department_name), '') is not null
),
prepared as (
  select
    name,
    left(
      upper(regexp_replace(name, '[^A-Za-z0-9]+', '_', 'g')) || '_' || substr(md5(name), 1, 8),
      60
    ) as code
  from source_departments
)
insert into public.departments (code, name)
select code, name
from prepared
on conflict (name) do nothing;

update public.employees employee
set department_id = department.id
from public.departments department
where employee.department_id is null
  and nullif(btrim(employee.department_name), '') is not null
  and department.name = btrim(employee.department_name);

create index if not exists employees_department_id_idx on public.employees (department_id);
create index if not exists departments_is_active_idx on public.departments (is_active);

create or replace function public.sync_employee_department_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.department_id is not null then
    select name
    into new.department_name
    from public.departments
    where id = new.department_id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_employee_department_name_trigger on public.employees;
create trigger sync_employee_department_name_trigger
before insert or update of department_id on public.employees
for each row execute function public.sync_employee_department_name();

create or replace function public.touch_departments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_departments_updated_at_trigger on public.departments;
create trigger touch_departments_updated_at_trigger
before update on public.departments
for each row execute function public.touch_departments_updated_at();

grant select, insert, update, delete on public.departments to authenticated;

commit;
