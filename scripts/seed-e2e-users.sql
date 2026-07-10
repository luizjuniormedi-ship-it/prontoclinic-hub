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

WITH base_company AS (
  SELECT id
  FROM public.companies
  ORDER BY created_at NULLS LAST, id
  LIMIT 1
),
base_unit AS (
  SELECT u.id
  FROM public.units u
  JOIN base_company c ON c.id = u.company_id
  ORDER BY u.lg_principal DESC NULLS LAST, u.id
  LIMIT 1
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
