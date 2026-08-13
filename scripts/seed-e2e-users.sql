-- Seed local idempotente para Playwright/E2E.
-- Nao usar em producao. Nao altera usuarios migrados do DataSIGH.
-- Uso:
--   $env:E2E_PASSWORD='<senha temporaria>'
--   psql -X -v ON_ERROR_STOP=1 -f scripts/seed-e2e-users.sql

\getenv e2e_password E2E_PASSWORD
\if :{?e2e_password}
\else
  \echo 'Variavel de ambiente obrigatoria ausente: E2E_PASSWORD'
  SELECT 1 / 0;
\endif
\getenv e2e_mfa_secret E2E_MFA_SECRET
\if :{?e2e_mfa_secret}
\else
  \echo 'Variavel de ambiente obrigatoria ausente: E2E_MFA_SECRET'
  SELECT 1 / 0;
\endif
\getenv e2e_mfa_encryption_key AUTH_MFA_ENCRYPTION_KEY
\if :{?e2e_mfa_encryption_key}
\else
  \echo 'Variavel de ambiente obrigatoria ausente: AUTH_MFA_ENCRYPTION_KEY'
  SELECT 1 / 0;
\endif

BEGIN;
SET LOCAL TIME ZONE 'America/Sao_Paulo';

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO public.companies (id, name, cnpj, lg_ativo)
VALUES (
  'eeeeeeee-1000-4000-8000-000000000001',
  'Empresa E2E', '99999999000191', TRUE
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, cnpj = EXCLUDED.cnpj, lg_ativo = TRUE;

INSERT INTO public.units (
  id, company_id, cd_codigo, ds_nome, ds_uf, cnes, lg_principal, lg_ativo
)
VALUES
  (91001, 'eeeeeeee-1000-4000-8000-000000000001', 'E2E-A', 'Unidade E2E A', 'BA', '9999999', TRUE, TRUE),
  (91002, 'eeeeeeee-1000-4000-8000-000000000001', 'E2E-B', 'Unidade E2E B', 'BA', '9999998', FALSE, TRUE)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  cd_codigo = EXCLUDED.cd_codigo,
  ds_nome = EXCLUDED.ds_nome,
  ds_uf = EXCLUDED.ds_uf,
  cnes = EXCLUDED.cnes,
  lg_ativo = TRUE;

-- O trigger de user_profiles valida o papel antes do INSERT/UPDATE. Em um
-- replay limpo, os papéis E2E precisam existir antes dos perfis.
INSERT INTO public.roles (name, description, lg_ativo)
VALUES
  ('admin', 'Administrador E2E', true),
  ('medico', 'Medico E2E', true),
  ('recepcao', 'Recepcao E2E', true),
  ('supervisor_recepcao', 'Supervisor de recepcao E2E', true),
  ('paciente', 'Paciente E2E', true),
  ('callcenter', 'Call Center E2E', true),
  ('farmacia', 'Farmacia E2E', true)
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
    ('eeeeeeee-0000-4000-8000-000000000006'::uuid, 'supervisor.recepcao@prontomedic.test', 'Supervisor Recepcao E2E', 'supervisor_recepcao'),
    ('eeeeeeee-0000-4000-8000-000000000004'::uuid, 'paciente@prontomedic.test', 'Paciente E2E', 'paciente'),
    ('eeeeeeee-0000-4000-8000-000000000005'::uuid, 'callcenter@prontomedic.test', 'Call Center E2E', 'callcenter'),
    ('eeeeeeee-0000-4000-8000-000000000007'::uuid, 'farmacia@prontomedic.test', 'Farmacia E2E', 'farmacia')
),
upsert_auth AS (
  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  SELECT
    su.id,
    su.email,
    crypt(:'e2e_password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"],"e2e":true}'::jsonb,
    jsonb_build_object('full_name', su.full_name, 'role', su.role_name, 'e2e', true),
    now(),
    now()
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

WITH seed_users(id) AS (
  VALUES
    ('eeeeeeee-0000-4000-8000-000000000001'::uuid),
    ('eeeeeeee-0000-4000-8000-000000000002'::uuid),
    ('eeeeeeee-0000-4000-8000-000000000003'::uuid),
    ('eeeeeeee-0000-4000-8000-000000000006'::uuid),
    ('eeeeeeee-0000-4000-8000-000000000004'::uuid),
    ('eeeeeeee-0000-4000-8000-000000000005'::uuid),
    ('eeeeeeee-0000-4000-8000-000000000007'::uuid)
)
INSERT INTO public.auth_mfa_factors(
  id, user_id, factor_type, friendly_name, secret_ciphertext,
  status, created_at, updated_at
)
SELECT
  md5(seed_users.id::text || ':e2e-totp')::uuid,
  seed_users.id,
  'totp',
  'ProntoMedic E2E',
  pgp_sym_encrypt(:'e2e_mfa_secret', :'e2e_mfa_encryption_key'),
  'verified',
  now(),
  now()
FROM seed_users
ON CONFLICT (user_id, friendly_name) DO UPDATE SET
  secret_ciphertext = EXCLUDED.secret_ciphertext,
  status = 'verified',
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
    ('eeeeeeee-0000-4000-8000-000000000006'::uuid, 'supervisor_recepcao'),
    ('eeeeeeee-0000-4000-8000-000000000004'::uuid, 'paciente'),
    ('eeeeeeee-0000-4000-8000-000000000005'::uuid, 'callcenter'),
    ('eeeeeeee-0000-4000-8000-000000000007'::uuid, 'farmacia')
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
    ('eeeeeeee-0000-4000-8000-000000000006'::uuid, 'supervisor_recepcao'),
    ('eeeeeeee-0000-4000-8000-000000000004'::uuid, 'paciente'),
    ('eeeeeeee-0000-4000-8000-000000000005'::uuid, 'callcenter'),
    ('eeeeeeee-0000-4000-8000-000000000007'::uuid, 'farmacia')
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
    ('eeeeeeee-0000-4000-8000-000000000006'::uuid, 'supervisor_recepcao'),
    ('eeeeeeee-0000-4000-8000-000000000004'::uuid, 'paciente'),
    ('eeeeeeee-0000-4000-8000-000000000005'::uuid, 'callcenter'),
    ('eeeeeeee-0000-4000-8000-000000000007'::uuid, 'farmacia')
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
    ('admin','faturamento',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('admin','financeiro',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('admin','dicom',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('admin','laboratorio',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('admin','enfermagem',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('admin','farmacia',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('admin','revisao_farmaceutica',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('admin','auditoria',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('admin','admin',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('admin','bi',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('admin','telemedicina',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('admin','internacao',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('admin','cirurgia',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('admin','ia',TRUE,TRUE,TRUE,TRUE,TRUE),
    ('recepcao','agenda',TRUE,FALSE,TRUE,FALSE,FALSE),
    ('recepcao','recepcao',TRUE,TRUE,TRUE,FALSE,FALSE),
    ('recepcao','pacientes',TRUE,FALSE,FALSE,FALSE,FALSE),
    ('supervisor_recepcao','agenda',TRUE,FALSE,TRUE,FALSE,FALSE),
    ('supervisor_recepcao','recepcao',TRUE,TRUE,TRUE,FALSE,FALSE),
    ('supervisor_recepcao','pacientes',TRUE,FALSE,FALSE,FALSE,FALSE),
    ('callcenter','recepcao',TRUE,TRUE,TRUE,FALSE,FALSE),
    ('callcenter','pacientes',TRUE,FALSE,FALSE,FALSE,FALSE),
    ('medico','agenda',TRUE,FALSE,TRUE,FALSE,FALSE),
    ('medico','pacientes',TRUE,FALSE,FALSE,FALSE,FALSE),
    ('medico','prontuario',TRUE,TRUE,TRUE,FALSE,FALSE),
    ('farmacia','farmacia',TRUE,TRUE,TRUE,FALSE,FALSE),
    ('farmacia','revisao_farmaceutica',TRUE,TRUE,TRUE,FALSE,FALSE)
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
    ('eeeeeeee-0000-4000-8000-000000000006'::uuid),
    ('eeeeeeee-0000-4000-8000-000000000004'::uuid),
    ('eeeeeeee-0000-4000-8000-000000000005'::uuid),
    ('eeeeeeee-0000-4000-8000-000000000007'::uuid)
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
    ('eeeeeeee-0000-4000-8000-000000000006'::uuid, 91001),
    ('eeeeeeee-0000-4000-8000-000000000004'::uuid, 91001),
    ('eeeeeeee-0000-4000-8000-000000000005'::uuid, 91001)
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
VALUES (91001, 'eeeeeeee-1000-4000-8000-000000000001', 'Exame SADT E2E', 30, 'exame', TRUE)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  name = EXCLUDED.name,
  default_duration = EXCLUDED.default_duration,
  category = EXCLUDED.category,
  lg_ativo = TRUE;

INSERT INTO public.services_catalog (id, company_id, code, name, price, lg_ativo)
VALUES (
  91001,
  'eeeeeeee-1000-4000-8000-000000000001',
  '40301010',
  'Ultrassonografia SADT E2E',
  150.00,
  TRUE
)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  price = EXCLUDED.price,
  lg_ativo = TRUE;

INSERT INTO public.insurance_companies (
  id, company_id, name, registro_ans, codigo_prestador,
  lg_ativo, lg_guia_obrigatoria, lg_cid_obrigatorio,
  lg_matric_obrigatorio, lg_autorizac_obrigatorio,
  lg_validade_matricula, lg_val_matricula, lg_val_autorizacao,
  observacao
) VALUES (
  91001,
  'eeeeeeee-1000-4000-8000-000000000001',
  'Convênio Sintético E2E',
  '999999',
  'E2E-PRESTADOR',
  TRUE,
  FALSE,
  FALSE,
  TRUE,
  FALSE,
  FALSE,
  FALSE,
  FALSE,
  'Fixture exclusivamente local; sem integração externa.'
)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  name = EXCLUDED.name,
  registro_ans = EXCLUDED.registro_ans,
  codigo_prestador = EXCLUDED.codigo_prestador,
  lg_ativo = TRUE,
  lg_guia_obrigatoria = FALSE,
  lg_cid_obrigatorio = FALSE,
  lg_matric_obrigatorio = TRUE,
  lg_autorizac_obrigatorio = FALSE,
  lg_validade_matricula = FALSE,
  lg_val_matricula = FALSE,
  lg_val_autorizacao = FALSE,
  observacao = EXCLUDED.observacao;

INSERT INTO public.insurance_plans (
  id, company_id, insurance_company_id, name, codigo, ds_plano,
  tp_cobertura, lg_ativo, lg_coparticipacao
) VALUES (
  91001,
  'eeeeeeee-1000-4000-8000-000000000001',
  91001,
  'Plano SADT Sintético E2E',
  'E2E-SADT',
  'Plano de homologação local para Agenda e Recepção',
  'AMBULATORIAL',
  TRUE,
  FALSE
)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  insurance_company_id = EXCLUDED.insurance_company_id,
  name = EXCLUDED.name,
  codigo = EXCLUDED.codigo,
  ds_plano = EXCLUDED.ds_plano,
  tp_cobertura = EXCLUDED.tp_cobertura,
  lg_ativo = TRUE,
  lg_coparticipacao = FALSE;

INSERT INTO public.price_tables (
  id, company_id, appointment_type_id, service_id, insurance_plan_id,
  dt_inicio, dt_fim, vl_particular, vl_convenio, active
) VALUES (
  91001,
  'eeeeeeee-1000-4000-8000-000000000001',
  91001,
  91001,
  91001,
  CURRENT_DATE - 1,
  NULL,
  150.00,
  125.00,
  TRUE
)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  appointment_type_id = EXCLUDED.appointment_type_id,
  service_id = EXCLUDED.service_id,
  insurance_plan_id = EXCLUDED.insurance_plan_id,
  dt_inicio = EXCLUDED.dt_inicio,
  dt_fim = NULL,
  vl_particular = EXCLUDED.vl_particular,
  vl_convenio = EXCLUDED.vl_convenio,
  active = TRUE;

INSERT INTO public.professionals (
  id, company_id, user_id, full_name, crm, specialty, email,
  council_code, council_state, cbos, lg_ativo
) VALUES (
  91001, 'eeeeeeee-1000-4000-8000-000000000001',
  'eeeeeeee-0000-4000-8000-000000000002', 'Médico E2E',
  'CRM-12345', 'Clínica Médica E2E', 'doctor@prontomedic.test',
  '06', 'BA', '225125', TRUE
)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  user_id = EXCLUDED.user_id,
  full_name = EXCLUDED.full_name,
  crm = EXCLUDED.crm,
  council_code = EXCLUDED.council_code,
  council_state = EXCLUDED.council_state,
  cbos = EXCLUDED.cbos,
  lg_ativo = TRUE;

INSERT INTO public.professional_insurances (
  company_id, professional_id, insurance_company_id,
  lg_clinica, lg_credenciado, ds_observacao,
  dt_inicio_vinculo, dt_fim_vinculo, lg_ativo
) VALUES (
  'eeeeeeee-1000-4000-8000-000000000001',
  91001,
  91001,
  TRUE,
  TRUE,
  'Credenciamento sintético E2E',
  CURRENT_DATE - 1,
  NULL,
  TRUE
)
ON CONFLICT (professional_id, insurance_company_id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  lg_clinica = TRUE,
  lg_credenciado = TRUE,
  ds_observacao = EXCLUDED.ds_observacao,
  dt_inicio_vinculo = EXCLUDED.dt_inicio_vinculo,
  dt_fim_vinculo = NULL,
  lg_ativo = TRUE;

INSERT INTO public.professional_schedules (
  id, company_id, professional_id, unit_id, day_of_week, lg_habilitado,
  slot1_start, slot1_end, slot1_duration, slot1_unit_id
) VALUES (
  91001,
  'eeeeeeee-1000-4000-8000-000000000001',
  91001,
  91001,
  CASE EXTRACT(DOW FROM CURRENT_DATE)::INTEGER
    WHEN 0 THEN 'domingo'
    WHEN 1 THEN 'segunda-feira'
    WHEN 2 THEN 'terça-feira'
    WHEN 3 THEN 'quarta-feira'
    WHEN 4 THEN 'quinta-feira'
    WHEN 5 THEN 'sexta-feira'
    ELSE 'sábado'
  END,
  TRUE,
  800,
  1800,
  30,
  91001
)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  professional_id = EXCLUDED.professional_id,
  unit_id = EXCLUDED.unit_id,
  day_of_week = EXCLUDED.day_of_week,
  lg_habilitado = TRUE,
  slot1_start = EXCLUDED.slot1_start,
  slot1_end = EXCLUDED.slot1_end,
  slot1_duration = EXCLUDED.slot1_duration,
  slot1_unit_id = EXCLUDED.slot1_unit_id;

INSERT INTO public.patients (
  id, company_id, unit_id, user_id, full_name, cpf, birth_date, phone,
  registration_status, status, insurance_plan_id, insurance_card_number, lg_ativo
) VALUES
  (91001, 'eeeeeeee-1000-4000-8000-000000000001', 91001,
   'eeeeeeee-0000-4000-8000-000000000004',
   'Paciente E2E A', '91000000001', DATE '1990-01-01', '21910000001',
   'complete', 'active', 91001, 'E2E-CARD-91001', TRUE),
  (91002, 'eeeeeeee-1000-4000-8000-000000000001', 91002,
   NULL,
   'Paciente E2E B', '91000000002', DATE '1991-01-01', '21910000002',
   'complete', 'active', NULL, NULL, TRUE)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  unit_id = EXCLUDED.unit_id,
  user_id = EXCLUDED.user_id,
  full_name = EXCLUDED.full_name,
  cpf = EXCLUDED.cpf,
  birth_date = EXCLUDED.birth_date,
  phone = EXCLUDED.phone,
  registration_status = 'complete',
  status = 'active',
  insurance_plan_id = EXCLUDED.insurance_plan_id,
  insurance_card_number = EXCLUDED.insurance_card_number,
  lg_ativo = TRUE;

DELETE FROM public.scheduling_call_center_tasks
WHERE assigned_to = 'eeeeeeee-0000-4000-8000-000000000005';
DELETE FROM public.scheduling_contact_logs
WHERE operator_id = 'eeeeeeee-0000-4000-8000-000000000005';

INSERT INTO public.patient_insurances (
  id, company_id, patient_id, insurance_plan_id, card_number,
  holder_name, holder_cpf, valid_until, is_primary, status
) VALUES (
  91001,
  'eeeeeeee-1000-4000-8000-000000000001',
  91001,
  91001,
  'E2E-CARD-91001',
  'Paciente E2E A',
  '91000000001',
  CURRENT_DATE + 365,
  TRUE,
  'active'
)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  patient_id = EXCLUDED.patient_id,
  insurance_plan_id = EXCLUDED.insurance_plan_id,
  card_number = EXCLUDED.card_number,
  holder_name = EXCLUDED.holder_name,
  holder_cpf = EXCLUDED.holder_cpf,
  valid_until = EXCLUDED.valid_until,
  is_primary = TRUE,
  status = 'active',
  updated_at = now();

DELETE FROM public.reception_checkin_workflows
WHERE appointment_id IN (91001, 91002, 91003);
DELETE FROM public.dicom_worklist_queue
WHERE appointment_id IN (91001, 91002, 91003);
DELETE FROM public.imaging_order_items
WHERE imaging_order_id IN (
  SELECT id FROM public.imaging_orders
  WHERE appointment_id IN (91001, 91002, 91003)
);
DELETE FROM public.imaging_orders
WHERE appointment_id IN (91001, 91002, 91003);
DELETE FROM public.tiss_xml WHERE appointment_id IN (91001, 91002, 91003);
DELETE FROM public.billings WHERE appointment_id IN (91001, 91002, 91003);
DELETE FROM public.tiss_guides WHERE appointment_id IN (91001, 91002, 91003);
DELETE FROM public.reception_payments WHERE appointment_id IN (91001, 91002, 91003);
DELETE FROM public.financial_transactions WHERE appointment_id IN (91001, 91002, 91003);
DELETE FROM public.billing_account_audit_reviews
WHERE billing_account_id IN (
  SELECT id FROM public.billing_accounts
  WHERE appointment_id IN (91001, 91002, 91003)
);
DELETE FROM public.billing_accounts WHERE appointment_id IN (91001, 91002, 91003);
DELETE FROM public.reception_checkin_status_history
WHERE checkin_id IN (SELECT id FROM public.reception_checkins WHERE appointment_id IN (91001, 91002, 91003));
DELETE FROM public.reception_exception_releases WHERE appointment_id IN (91001, 91002, 91003);
DELETE FROM public.reception_patient_pending_issues WHERE appointment_id IN (91001, 91002, 91003);
DELETE FROM public.reception_queue_tickets WHERE appointment_id IN (91001, 91002, 91003);
DELETE FROM public.reception_checkins WHERE appointment_id IN (91001, 91002, 91003);
DELETE FROM public.medical_records WHERE appointment_id IN (91001, 91002, 91003);

INSERT INTO public.appointments (
  id, company_id, unit_id, patient_id, professional_id, specialty_id,
  service_id, appointment_type_id, insurance_company_id, insurance_plan_id,
  appointment_date, start_time, end_time, status,
  tp_status, lg_confirmado, lg_checkin, notes
) VALUES
(
  91001, 'eeeeeeee-1000-4000-8000-000000000001', 91001,
  91001, 91001, 91001, 91001, 91001, 91001, 91001,
  CURRENT_DATE, TIME '14:00', TIME '14:30',
  'scheduled', 'agendado', TRUE, FALSE, 'Fixture fase 0/1'
),
(
  91002, 'eeeeeeee-1000-4000-8000-000000000001', 91002,
  91002, 91001, 91001, 91001, 91001, NULL, NULL,
  CURRENT_DATE, TIME '15:00', TIME '15:30',
  'scheduled', 'agendado', TRUE, FALSE, 'Fixture de isolamento da unidade B'
),
(
  91003, 'eeeeeeee-1000-4000-8000-000000000001', 91001,
  91001, 91001, 91001, 91001, 91001, 91001, 91001,
  CURRENT_DATE, TIME '16:00', TIME '16:30',
  'scheduled', 'agendado', TRUE, FALSE, 'Fixture de excecao sem elegibilidade'
)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  unit_id = EXCLUDED.unit_id,
  patient_id = EXCLUDED.patient_id,
  professional_id = EXCLUDED.professional_id,
  specialty_id = EXCLUDED.specialty_id,
  service_id = EXCLUDED.service_id,
  appointment_type_id = EXCLUDED.appointment_type_id,
  insurance_company_id = EXCLUDED.insurance_company_id,
  insurance_plan_id = EXCLUDED.insurance_plan_id,
  appointment_date = EXCLUDED.appointment_date,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  status = EXCLUDED.status,
  tp_status = EXCLUDED.tp_status,
  lg_confirmado = EXCLUDED.lg_confirmado,
  lg_checkin = EXCLUDED.lg_checkin,
  notes = EXCLUDED.notes;

INSERT INTO public.imaging_orders (
  id, company_id, unit_id, appointment_id, patient_id,
  requesting_physician_id, referring_physician_name,
  clinical_indication, priority, accession_number, status, created_by
) VALUES
(
  'eeeeeeee-9101-4000-8000-000000000001',
  'eeeeeeee-1000-4000-8000-000000000001',
  91001, 91001, 91001, 91001, 'Médico E2E',
  'Exame sintético para homologação da jornada Recepção → Worklist',
  'normal', 'PME2E91001', 'agendado',
  'eeeeeeee-0000-4000-8000-000000000001'
),
(
  'eeeeeeee-9101-4000-8000-000000000003',
  'eeeeeeee-1000-4000-8000-000000000001',
  91001, 91003, 91001, 91001, 'Médico E2E',
  'Exame sintético com exceção de elegibilidade',
  'normal', 'PME2E91003', 'agendado',
  'eeeeeeee-0000-4000-8000-000000000001'
);

INSERT INTO public.imaging_order_items (
  id, company_id, unit_id, imaging_order_id, service_id,
  exam_code, exam_name, modality_type, body_part, laterality,
  contrast_required, station_aetitle, scheduled_datetime,
  requested_procedure_id, scheduled_procedure_step_id, status
) VALUES
(
  'eeeeeeee-9102-4000-8000-000000000001',
  'eeeeeeee-1000-4000-8000-000000000001',
  91001, 'eeeeeeee-9101-4000-8000-000000000001', 91001,
  'E2E-USG', 'Ultrassonografia sintética E2E', 'US', 'ABDOME', 'na',
  FALSE, 'PRONTOMEDIC', CURRENT_DATE + TIME '14:00',
  'E2E-RP-91001', 'E2E-SPS-91001', 'agendado'
),
(
  'eeeeeeee-9102-4000-8000-000000000003',
  'eeeeeeee-1000-4000-8000-000000000001',
  91001, 'eeeeeeee-9101-4000-8000-000000000003', 91001,
  'E2E-USG', 'Ultrassonografia sintética E2E com exceção', 'US', 'ABDOME', 'na',
  FALSE, 'PRONTOMEDIC', CURRENT_DATE + TIME '16:00',
  'E2E-RP-91003', 'E2E-SPS-91003', 'agendado'
);

-- O evento de auditoria da elegibilidade e gravado por uma funcao SECURITY
-- DEFINER e exige o tenant explicito mesmo durante o seed local.
SELECT set_config(
  'request.jwt.claim.company_id',
  'eeeeeeee-1000-4000-8000-000000000001',
  TRUE
);

INSERT INTO public.insurance_eligibility_checks (
  id, company_id, unit_id, patient_id, appointment_id,
  insurance_id, insurance_plan_id, card_number,
  status, protocol_number, result_detail, source,
  checked_at, request_channel, valid_from, valid_until,
  result_code, external_request_id, requested_at, completed_at
) VALUES (
  'eeeeeeee-9100-4000-8000-000000000001',
  'eeeeeeee-1000-4000-8000-000000000001',
  91001,
  91001,
  91001,
  91001,
  91001,
  'E2E-CARD-91001',
  'elegivel',
  'E2E-ELIG-91001',
  'Elegibilidade sintética aprovada exclusivamente para homologação E2E.',
  'fixture_e2e',
  now(),
  'manual',
  CURRENT_DATE,
  CURRENT_DATE + 30,
  'E2E_APPROVED',
  'E2E-REQ-91001',
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  unit_id = EXCLUDED.unit_id,
  patient_id = EXCLUDED.patient_id,
  appointment_id = EXCLUDED.appointment_id,
  insurance_id = EXCLUDED.insurance_id,
  insurance_plan_id = EXCLUDED.insurance_plan_id,
  card_number = EXCLUDED.card_number,
  status = 'elegivel',
  protocol_number = EXCLUDED.protocol_number,
  result_detail = EXCLUDED.result_detail,
  source = EXCLUDED.source,
  checked_at = EXCLUDED.checked_at,
  request_channel = EXCLUDED.request_channel,
  valid_from = EXCLUDED.valid_from,
  valid_until = EXCLUDED.valid_until,
  result_code = EXCLUDED.result_code,
  external_request_id = EXCLUDED.external_request_id,
  requested_at = EXCLUDED.requested_at,
  completed_at = EXCLUDED.completed_at,
  updated_at = now();

DO $fixture_contract$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.appointments appointment
    JOIN public.patients patient
      ON patient.id = appointment.patient_id
     AND patient.company_id = appointment.company_id
     AND patient.unit_id = appointment.unit_id
    JOIN public.professionals professional
      ON professional.id = appointment.professional_id
     AND professional.company_id = appointment.company_id
     AND professional.lg_ativo
    JOIN public.professional_schedules schedule
      ON schedule.professional_id = professional.id
     AND schedule.company_id = appointment.company_id
     AND schedule.unit_id = appointment.unit_id
     AND schedule.slot1_unit_id = appointment.unit_id
     AND schedule.lg_habilitado
     AND schedule.slot1_start <=
       EXTRACT(HOUR FROM appointment.start_time)::INTEGER * 100
       + EXTRACT(MINUTE FROM appointment.start_time)::INTEGER
     AND schedule.slot1_end >=
       EXTRACT(HOUR FROM appointment.end_time)::INTEGER * 100
       + EXTRACT(MINUTE FROM appointment.end_time)::INTEGER
    JOIN public.insurance_plans plan
      ON plan.id = appointment.insurance_plan_id
     AND plan.company_id = appointment.company_id
     AND plan.insurance_company_id = appointment.insurance_company_id
     AND plan.lg_ativo
    JOIN public.patient_insurances patient_insurance
      ON patient_insurance.company_id = appointment.company_id
     AND patient_insurance.patient_id = appointment.patient_id
     AND patient_insurance.insurance_plan_id = appointment.insurance_plan_id
     AND patient_insurance.status = 'active'
     AND patient_insurance.valid_until >= CURRENT_DATE
    JOIN public.insurance_eligibility_checks eligibility
      ON eligibility.company_id = appointment.company_id
     AND eligibility.unit_id = appointment.unit_id
     AND eligibility.patient_id = appointment.patient_id
     AND eligibility.appointment_id = appointment.id
     AND eligibility.insurance_id = appointment.insurance_company_id
     AND eligibility.insurance_plan_id = appointment.insurance_plan_id
     AND eligibility.status = 'elegivel'
     AND eligibility.valid_until >= CURRENT_DATE
    JOIN public.professional_insurances accreditation
      ON accreditation.professional_id = professional.id
     AND accreditation.insurance_company_id = plan.insurance_company_id
     AND accreditation.company_id = appointment.company_id
     AND accreditation.lg_credenciado
     AND accreditation.lg_ativo
    JOIN public.services_catalog service
      ON service.id = appointment.service_id
     AND service.company_id = appointment.company_id
     AND service.code = '40301010'
     AND service.lg_ativo
    JOIN public.price_tables price
      ON price.company_id = appointment.company_id
     AND price.service_id = service.id
     AND price.appointment_type_id = appointment.appointment_type_id
     AND price.insurance_plan_id = plan.id
     AND price.active
     AND price.vl_convenio = 125.00
    JOIN public.imaging_orders imaging_order
      ON imaging_order.company_id = appointment.company_id
     AND imaging_order.unit_id = appointment.unit_id
     AND imaging_order.appointment_id = appointment.id
     AND imaging_order.patient_id = appointment.patient_id
     AND imaging_order.status = 'agendado'
    JOIN public.imaging_order_items imaging_item
      ON imaging_item.company_id = imaging_order.company_id
     AND imaging_item.unit_id = imaging_order.unit_id
     AND imaging_item.imaging_order_id = imaging_order.id
     AND imaging_item.status = 'agendado'
     AND imaging_item.station_aetitle = 'PRONTOMEDIC'
    WHERE appointment.id = 91001
      AND appointment.company_id = 'eeeeeeee-1000-4000-8000-000000000001'
      AND appointment.unit_id = 91001
      AND patient.insurance_plan_id = plan.id
      AND patient.insurance_card_number = 'E2E-CARD-91001'
  ) THEN
    RAISE EXCEPTION
      'E2E_FIXTURE_CONTRACT: massa Agenda->Recepcao->Worklist incompleta ou inconsistente';
  END IF;
END;
$fixture_contract$;

COMMIT;
