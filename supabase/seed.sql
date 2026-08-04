begin;

insert into public.departments (code, name)
values
  ('SEWING', 'Sewing'),
  ('FINISHING', 'Finishing'),
  ('PACKING', 'Packing'),
  ('CUTTING', 'Cutting'),
  ('QUALITY', 'Quality'),
  ('ENGINEERING', 'Engineering'),
  ('HUMAN_RESOURCES', 'Human Resources')
on conflict (code) do update
set
  name = excluded.name,
  is_active = true,
  updated_at = now();

insert into public.leave_code_map (code, description, attendance_class)
values
  ('A', 'Approved leave placeholder mapping. Confirm the exact business meaning with HR.', 'leave'),
  ('N', 'No-pay or absent placeholder mapping. Review and adjust with the client before payroll use.', 'absent'),
  ('C', 'Casual leave or partial leave placeholder mapping. Confirm the exact rule with HR.', 'leave')
on conflict (code) do update
set
  description = excluded.description,
  attendance_class = excluded.attendance_class;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  phone_change,
  phone_change_token,
  email_change_token_current,
  reauthentication_token,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'admin@garmentline.local',
    '$2y$10$378F5Gc5ey1sOhjGr90BPOmkPEBw6UovhLR8ZKc/49pTTg2RZyGmu',
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Union North Administrator","role":"admin"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'supervisor@garmentline.local',
    '$2y$10$378F5Gc5ey1sOhjGr90BPOmkPEBw6UovhLR8ZKc/49pTTg2RZyGmu',
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Dhanushka Perera","role":"supervisor"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'hr@garmentline.local',
    '$2y$10$378F5Gc5ey1sOhjGr90BPOmkPEBw6UovhLR8ZKc/49pTTg2RZyGmu',
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Ishara Fernando","role":"hr"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000004',
    'authenticated',
    'authenticated',
    'viewer@garmentline.local',
    '$2y$10$378F5Gc5ey1sOhjGr90BPOmkPEBw6UovhLR8ZKc/49pTTg2RZyGmu',
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Management Desk","role":"viewer"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000005',
    'authenticated',
    'authenticated',
    'ie@garmentline.local',
    '$2y$10$378F5Gc5ey1sOhjGr90BPOmkPEBw6UovhLR8ZKc/49pTTg2RZyGmu',
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"IE Planning Desk","role":"ie"}'::jsonb,
    now(),
    now()
  )
on conflict (id) do nothing;

insert into auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  users.id::text as provider_id,
  users.id as user_id,
  jsonb_strip_nulls(
    jsonb_build_object(
      'sub',
      users.id::text,
      'email',
      users.email,
      'full_name',
      coalesce(
        nullif(users.raw_user_meta_data ->> 'full_name', ''),
        nullif(users.raw_user_meta_data ->> 'name', ''),
        split_part(coalesce(users.email, ''), '@', 1)
      ),
      'email_verified',
      coalesce(users.email_confirmed_at is not null, false),
      'phone_verified',
      false
    )
  ) as identity_data,
  coalesce(nullif(users.raw_app_meta_data ->> 'provider', ''), 'email') as provider,
  users.last_sign_in_at,
  users.created_at,
  users.updated_at
from auth.users as users
where users.id in (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005'
)
  and not exists (
    select 1
    from auth.identities as identities
    where identities.user_id = users.id
      and identities.provider = 'email'
  );

insert into public.profiles (id, full_name, role, is_active)
values
  ('00000000-0000-0000-0000-000000000001', 'Union North Administrator', 'admin', true),
  ('00000000-0000-0000-0000-000000000002', 'Dhanushka Perera', 'supervisor', true),
  ('00000000-0000-0000-0000-000000000003', 'Ishara Fernando', 'hr', true),
  ('00000000-0000-0000-0000-000000000004', 'Management Desk', 'viewer', true),
  ('00000000-0000-0000-0000-000000000005', 'IE Planning Desk', 'ie', true)
on conflict (id) do update
set
  full_name = excluded.full_name,
  role = excluded.role,
  is_active = excluded.is_active;

commit;
