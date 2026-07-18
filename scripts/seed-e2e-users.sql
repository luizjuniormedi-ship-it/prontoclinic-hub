-- Seed local idempotente para Playwright/E2E.
-- Nao usar em producao. Nao altera usuarios migrados do DataSIGH.
-- Uso:
--   psql -v e2e_password='<senha temporaria>' -f scripts/seed-e2e-users.sql

\if :{?e2e_password}
\else
  \echo 'Variavel psql obrigatoria ausente: -v e2e_password=<senha temporaria>'
  \quit 1
\endif

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO public.companies (id, name, lg_ativo)
VALUES ('eeeeeeee-1000-4000-8000-000000000001', 'Empresa E2E', TRUE)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, lg_ativo = TRUE;

INSERT INTO public.units (id, company_id, cd_codigo, ds_nome, lg_principal, lg_ativo)
VALUES
  (91001, 'eeeeeeee-1000-4000-8000-000000000001', 'E2E-A', 'Unidade E2E A', TRUE, TRUE),
  (91002, 'eeeeeeee-1000-4000-8000-000000000001', 'E2E-B', 'Unidade E2E B', FALSE, TRUE)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  cd_codigo = EXCLUDED.cd_codigo,
  ds_nome = EXCLUDED.ds_nome,
  lg_ativo = TRUE;

-- O trigger de user_profiles valida o papel antes do INSERT/UPDATE. Em um
-- replay limpo, os papéis E2E precisam existir antes dos perfis.
INSERT INTO public.roles (name, description, lg_ativo)
VALUES
  ('admin', 'Administrador E2E', true),
  ('medico', 'Medico E2E', true),
  ('recepcao', 'Recepcao E2E', true),
  ('paciente', 'Paciente E2E', true)
ON CONFLICT (name) DO UPDATE SET lg_ativo = true;

WITH base_company AS (
  SELECT id
  FROM public.companies
  WHERE id = 'eeeeeeee-1000-4000-8000-000000000001'
),
base_unit AS (
  SELECT u.id
  FROM public.units u
  JOIN base_company c ON c.id = u.company_id
  WHERE u.id = 91001
),
seed_users(id, email, full_name, role_name) AS (
  VALUES
    ('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'admin@prontomedic.test', 'Admin E2E', 'admin'),
    ('eeeeeeee-0000-4000-8000-000000000002'::uuid, 'doctor@prontomedic.test', 'Medico E2E', 'medico'),
    ('eeeeeeee-0000-4000-8000-000000000003'::uuid, 'recepcao@prontomedic.test', 'Recepcao E2E', 'recepcao'),
    ('eeeeeeee-0000-4000-8000-000000000004'::uuid, 'paciente@prontomedic.test', 'Paciente E2E', 'paciente')
),
upsert_auth AS (
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  SELECT
    '00000000-0000-0000-0000-000000000000',
    su.id,
    'authenticated',
    'authenticated',
    su.email,
    crypt(:'e2e_password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"],"e2e":true}'::jsonb,
    jsonb_build_object('full_name', su.full_name, 'role', su.role_name, 'e2e', true),
    now(),
    now(),
    '',
    '',
    '',
    ''
  FROM seed_users su
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    encrypted_password = EXCLUDED.encrypted_password,
    email_confirmed_at = COALESCE(auth.users.email_confirmed_at, now()),
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = now()
  RETURNING id
)
INSERT INTO public.user_profiles (
  id, full_name, email, role_name, company_id, primary_unit_id, lg_ativo, created_at, updated_at
)
SELECT
  su.id,
  su.full_name,
  su.email,
  su.role_name,
  c.id,
  u.id,
  true,
  now(),
  now()
FROM seed_users su
CROSS JOIN base_company c
CROSS JOIN base_unit u
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  email = EXCLUDED.email,
  role_name = EXCLUDED.role_name,
  company_id = EXCLUDED.company_id,
  primary_unit_id = EXCLUDED.primary_unit_id,
  lg_ativo = true,
  updated_at = now();

UPDATE public.user_profiles
SET user_id = id,
    must_change_password = false,
    lg_ativo = true
WHERE id::text LIKE 'eeeeeeee-0000-4000-8000-%';

UPDATE public.user_profiles p
SET role_id = r.id,
    updated_at = now()
FROM public.roles r
WHERE p.id::text LIKE 'eeeeeeee-0000-4000-8000-%'
  AND r.name = p.role_name;

WITH seed_users(id, role_name) AS (
  VALUES
    ('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'admin'),
    ('eeeeeeee-0000-4000-8000-000000000002'::uuid, 'medico'),
    ('eeeeeeee-0000-4000-8000-000000000003'::uuid, 'recepcao'),
    ('eeeeeeee-0000-4000-8000-000000000004'::uuid, 'paciente')
), base_company AS (
  SELECT id FROM public.companies WHERE id = 'eeeeeeee-1000-4000-8000-000000000001'
)
INSERT INTO public.memberships (id, user_id, company_id, status)
SELECT md5(su.id::text || ':membership:' || c.id::text)::uuid, su.id, c.id, 'active'
FROM seed_users su CROSS JOIN base_company c
ON CONFLICT (user_id, company_id) DO UPDATE SET status = 'active';

WITH desired(user_id, role_name) AS (
  VALUES
    ('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'admin'),
    ('eeeeeeee-0000-4000-8000-000000000002'::uuid, 'medico'),
    ('eeeeeeee-0000-4000-8000-000000000003'::uuid, 'recepcao'),
    ('eeeeeeee-0000-4000-8000-000000000004'::uuid, 'paciente')
)
DELETE FROM public.membership_roles mr
USING public.memberships m, public.roles r
WHERE mr.membership_id = m.id
  AND mr.role_id = r.id
  AND m.company_id = 'eeeeeeee-1000-4000-8000-000000000001'
  AND m.user_id IN (SELECT user_id FROM desired)
  AND NOT EXISTS (
    SELECT 1 FROM desired d
    WHERE d.user_id = m.user_id AND d.role_name = r.name
  );

WITH seed_users(id, role_name) AS (
  VALUES
    ('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'admin'),
    ('eeeeeeee-0000-4000-8000-000000000002'::uuid, 'medico'),
    ('eeeeeeee-0000-4000-8000-000000000003'::uuid, 'recepcao'),
    ('eeeeeeee-0000-4000-8000-000000000004'::uuid, 'paciente')
)
INSERT INTO public.membership_roles (membership_id, role_id)
SELECT m.id, r.id
FROM seed_users su
JOIN public.memberships m ON m.user_id = su.id
JOIN public.roles r ON r.name = su.role_name
ON CONFLICT DO NOTHING;

WITH permissions(role_name,module,can_view,can_create,can_edit,can_delete,can_export) AS (
  VALUES
    ('admin','agenda',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('admin','recepcao',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('admin','pacientes',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('admin','prontuario',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('recepcao','agenda',TRUE,FALSE,TRUE,FALSE,FALSE),
    ('recepcao','recepcao',TRUE,TRUE,TRUE,FALSE,FALSE),
    ('recepcao','pacientes',TRUE,FALSE,FALSE,FALSE,FALSE),
    ('medico','agenda',TRUE,FALSE,TRUE,FALSE,FALSE),
    ('medico','pacientes',TRUE,FALSE,FALSE,FALSE,FALSE),
    ('medico','prontuario',TRUE,TRUE,TRUE,FALSE,FALSE)
)
INSERT INTO public.role_permissions (
  company_id, role_id, module, can_view, can_create, can_edit, can_delete, can_export
)
SELECT
  'eeeeeeee-1000-4000-8000-000000000001', r.id, p.module,
  p.can_view, p.can_create, p.can_edit, p.can_delete, p.can_export
FROM permissions p
JOIN public.roles r ON r.name = p.role_name
ON CONFLICT (company_id, role_id, module) DO UPDATE SET
  can_view = EXCLUDED.can_view,
  can_create = EXCLUDED.can_create,
  can_edit = EXCLUDED.can_edit,
  can_delete = EXCLUDED.can_delete,
  can_export = EXCLUDED.can_export,
  updated_at = now();

WITH seed_users(id) AS (
  VALUES
    ('eeeeeeee-0000-4000-8000-000000000001'::uuid),
    ('eeeeeeee-0000-4000-8000-000000000002'::uuid),
    ('eeeeeeee-0000-4000-8000-000000000003'::uuid),
    ('eeeeeeee-0000-4000-8000-000000000004'::uuid)
), base_unit AS (
  SELECT id, company_id FROM public.units WHERE id = 91001
)
INSERT INTO public.membership_units (membership_id, unit_id)
SELECT m.id, u.id
FROM seed_users su
JOIN public.memberships m ON m.user_id = su.id
JOIN base_unit u ON u.company_id = m.company_id
ON CONFLICT DO NOTHING;

INSERT INTO public.membership_units (membership_id, unit_id)
SELECT m.id, 91002
FROM public.memberships m
WHERE m.user_id = 'eeeeeeee-0000-4000-8000-000000000001'
  AND m.company_id = 'eeeeeeee-1000-4000-8000-000000000001'
ON CONFLICT DO NOTHING;

WITH desired(user_id, unit_id) AS (
  VALUES
    ('eeeeeeee-0000-4000-8000-000000000001'::uuid, 91001),
    ('eeeeeeee-0000-4000-8000-000000000001'::uuid, 91002),
    ('eeeeeeee-0000-4000-8000-000000000002'::uuid, 91001),
    ('eeeeeeee-0000-4000-8000-000000000003'::uuid, 91001),
    ('eeeeeeee-0000-4000-8000-000000000004'::uuid, 91001)
)
DELETE FROM public.membership_units mu
USING public.memberships m
WHERE mu.membership_id = m.id
  AND m.company_id = 'eeeeeeee-1000-4000-8000-000000000001'
  AND m.user_id IN (SELECT user_id FROM desired)
  AND NOT EXISTS (
    SELECT 1 FROM desired d
    WHERE d.user_id = m.user_id AND d.unit_id = mu.unit_id
  );

INSERT INTO public.specialties (id, name, code, lg_ativo)
VALUES (91001, 'Clínica Médica E2E', 'E2E-CM', TRUE)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, lg_ativo = TRUE;

INSERT INTO public.appointment_types (id, company_id, name, default_duration, category, lg_ativo)
VALUES (91001, 'eeeeeeee-1000-4000-8000-000000000001', 'Consulta E2E', 30, 'consulta', TRUE)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, lg_ativo = TRUE;

INSERT INTO public.professionals (
  id, company_id, user_id, full_name, crm, specialty, email, lg_ativo
) VALUES (
  91001, 'eeeeeeee-1000-4000-8000-000000000001',
  'eeeeeeee-0000-4000-8000-000000000002', 'Médico E2E',
  'CRM-E2E', 'Clínica Médica E2E', 'doctor@prontomedic.test', TRUE
)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  user_id = EXCLUDED.user_id,
  full_name = EXCLUDED.full_name,
  lg_ativo = TRUE;

INSERT INTO public.patients (
  id, company_id, unit_id, full_name, cpf, birth_date, phone,
  registration_status, status, lg_ativo
) VALUES
  (91001, 'eeeeeeee-1000-4000-8000-000000000001', 91001,
   'Paciente E2E A', '91000000001', DATE '1990-01-01', '21910000001',
   'complete', 'active', TRUE),
  (91002, 'eeeeeeee-1000-4000-8000-000000000001', 91002,
   'Paciente E2E B', '91000000002', DATE '1991-01-01', '21910000002',
   'complete', 'active', TRUE)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  unit_id = EXCLUDED.unit_id,
  full_name = EXCLUDED.full_name,
  status = 'active',
  lg_ativo = TRUE;

DELETE FROM public.reception_checkin_status_history
WHERE checkin_id IN (SELECT id FROM public.reception_checkins WHERE appointment_id IN (91001, 91002));
DELETE FROM public.reception_exception_releases WHERE appointment_id IN (91001, 91002);
DELETE FROM public.reception_patient_pending_issues WHERE appointment_id IN (91001, 91002);
DELETE FROM public.reception_queue_tickets WHERE appointment_id IN (91001, 91002);
DELETE FROM public.reception_checkins WHERE appointment_id IN (91001, 91002);
DELETE FROM public.medical_records WHERE appointment_id IN (91001, 91002);

INSERT INTO public.appointments (
  id, company_id, unit_id, patient_id, professional_id, specialty_id,
  appointment_type_id, appointment_date, start_time, end_time, status,
  tp_status, lg_confirmado, lg_checkin, notes
) VALUES
(
  91001, 'eeeeeeee-1000-4000-8000-000000000001', 91001,
  91001, 91001, 91001, 91001, CURRENT_DATE, TIME '14:00', TIME '14:30',
  'scheduled', 'agendado', TRUE, FALSE, 'Fixture fase 0/1'
),
(
  91002, 'eeeeeeee-1000-4000-8000-000000000001', 91002,
  91002, 91001, 91001, 91001, CURRENT_DATE, TIME '15:00', TIME '15:30',
  'scheduled', 'agendado', TRUE, FALSE, 'Fixture de isolamento da unidade B'
)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  unit_id = EXCLUDED.unit_id,
  patient_id = EXCLUDED.patient_id,
  professional_id = EXCLUDED.professional_id,
  specialty_id = EXCLUDED.specialty_id,
  appointment_type_id = EXCLUDED.appointment_type_id,
  appointment_date = EXCLUDED.appointment_date,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  status = EXCLUDED.status,
  tp_status = EXCLUDED.tp_status,
  lg_confirmado = EXCLUDED.lg_confirmado,
  lg_checkin = EXCLUDED.lg_checkin,
  notes = EXCLUDED.notes;
