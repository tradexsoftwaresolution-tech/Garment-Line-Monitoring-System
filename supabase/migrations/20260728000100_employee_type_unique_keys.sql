alter table public.employees
  add column if not exists employee_category text;

alter table public.employees
  alter column employee_category set default 'permanent';

update public.employees
set employee_code = regexp_replace(btrim(employee_code), '\s+', '', 'g')
where employee_code is not null;

update public.employees
set employee_category = case
  when employee_code like '101%' then 'new_joiner'
  when employee_code like '303%' then 'intern'
  else 'permanent'
end
where employee_category is null
   or employee_category not in ('permanent', 'new_joiner', 'intern')
   or employee_code like '101%'
   or employee_code like '303%';

update public.employees
set epf_no = employee_code
where employee_category = 'permanent'
  and coalesce(epf_no, '') <> employee_code;

alter table public.employees
  alter column employee_category set not null;

create index if not exists employees_employee_category_idx
  on public.employees (employee_category);

create or replace function public.normalize_employee_type_unique_key()
returns trigger
language plpgsql
as $$
declare
  v_category text := lower(replace(trim(coalesce(new.employee_category, 'permanent')), '-', '_'));
begin
  v_category := replace(v_category, ' ', '_');

  if v_category in ('new', 'newjoiner') then
    v_category := 'new_joiner';
  end if;

  if v_category = 'interns' then
    v_category := 'intern';
  end if;

  if new.employee_code is null or btrim(new.employee_code) = '' then
    raise exception 'Employee number is required';
  end if;

  new.employee_code := regexp_replace(btrim(new.employee_code), '\s+', '', 'g');

  if v_category not in ('permanent', 'new_joiner', 'intern') then
    if new.employee_code like '101%' then
      v_category := 'new_joiner';
    elsif new.employee_code like '303%' then
      v_category := 'intern';
    else
      v_category := 'permanent';
    end if;
  end if;

  if v_category = 'permanent' then
    new.epf_no := new.employee_code;
  elsif v_category = 'new_joiner' and new.employee_code not like '101%' then
    raise exception 'New joiner unique key must start with 101';
  elsif v_category = 'intern' and new.employee_code not like '303%' then
    raise exception 'Intern unique key must start with 303';
  end if;

  new.employee_category := v_category;
  return new;
end;
$$;

drop trigger if exists employees_normalize_employee_type_unique_key on public.employees;

create trigger employees_normalize_employee_type_unique_key
before insert or update of employee_code, epf_no, employee_category
on public.employees
for each row
execute function public.normalize_employee_type_unique_key();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_employee_category_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_employee_category_check
      check (employee_category in ('permanent', 'new_joiner', 'intern'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_employee_type_key_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_employee_type_key_check
      check (
        (employee_category = 'permanent' and epf_no = employee_code)
        or (employee_category = 'new_joiner' and employee_code like '101%')
        or (employee_category = 'intern' and employee_code like '303%')
      );
  end if;
end;
$$;
