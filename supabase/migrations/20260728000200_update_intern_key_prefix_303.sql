update public.employees
set employee_code = regexp_replace(btrim(employee_code), '\s+', '', 'g')
where employee_code is not null;

update public.employees
set employee_category = 'intern'
where employee_code like '303%';

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

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'employees_employee_type_key_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      drop constraint employees_employee_type_key_check;
  end if;
end;
$$;

alter table public.employees
  add constraint employees_employee_type_key_check
  check (
    (employee_category = 'permanent' and epf_no = employee_code)
    or (employee_category = 'new_joiner' and employee_code like '101%')
    or (employee_category = 'intern' and employee_code like '303%')
  )
  not valid;

