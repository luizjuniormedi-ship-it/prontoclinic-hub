-- CI-only seed for the ephemeral PostgreSQL service in GitHub Actions.
-- Never execute this against DataSIGH or production.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY, instance_id uuid, aud text, role text,
  email text UNIQUE NOT NULL, encrypted_password text NOT NULL,
  email_confirmed_at timestamptz, raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  confirmation_token text DEFAULT '', email_change text DEFAULT '',
  email_change_token_new text DEFAULT '', recovery_token text DEFAULT ''
);

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS instance_id uuid;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS aud text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS encrypted_password text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb DEFAULT '{}'::jsonb;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb DEFAULT '{}'::jsonb;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS confirmation_token text DEFAULT '';
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_change text DEFAULT '';
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_change_token_new text DEFAULT '';
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS recovery_token text DEFAULT '';

CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  token text PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent text, revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.companies (id, name, lg_ativo)
VALUES ('00000000-0000-0000-0000-000000000001', 'CI ProntoMedic', true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.units (company_id, cd_codigo, ds_nome, lg_principal, lg_ativo)
VALUES ('00000000-0000-0000-0000-000000000001', 'CI', 'Unidade CI', true, true)
ON CONFLICT DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@prontomedic.test',crypt('TestPassword123!',gen_salt('bf')),now(),'{"provider":"email"}'::jsonb,'{"role":"admin"}'::jsonb),
 ('22222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','doctor@prontomedic.test',crypt('TestPassword123!',gen_salt('bf')),now(),'{"provider":"email"}'::jsonb,'{"role":"doctor"}'::jsonb),
 ('33333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recepcao@prontomedic.test',crypt('TestPassword123!',gen_salt('bf')),now(),'{"provider":"email"}'::jsonb,'{"role":"reception"}'::jsonb),
 ('44444444-4444-4444-8444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','paciente@prontomedic.test',crypt('TestPassword123!',gen_salt('bf')),now(),'{"provider":"email"}'::jsonb,'{"role":"patient"}'::jsonb),
 ('55555555-5555-4555-8555-555555555555','00000000-0000-0000-0000-000000000000','authenticated','authenticated','financeiro@prontomedic.test',crypt('TestPassword123!',gen_salt('bf')),now(),'{"provider":"email"}'::jsonb,'{"role":"financeiro"}'::jsonb)
ON CONFLICT (id) DO UPDATE SET encrypted_password=EXCLUDED.encrypted_password, email_confirmed_at=now(), updated_at=now();

INSERT INTO public.user_profiles (id, full_name, email, role_name, company_id, primary_unit_id, lg_ativo)
VALUES
 ('11111111-1111-4111-8111-111111111111','CI Admin','admin@prontomedic.test','admin','00000000-0000-0000-0000-000000000001',1,true),
 ('22222222-2222-4222-8222-222222222222','CI Doctor','doctor@prontomedic.test','medico','00000000-0000-0000-0000-000000000001',1,true),
 ('33333333-3333-4333-8333-333333333333','CI Recepcao','recepcao@prontomedic.test','recepcao','00000000-0000-0000-0000-000000000001',1,true),
 ('44444444-4444-4444-8444-444444444444','CI Paciente','paciente@prontomedic.test','paciente','00000000-0000-0000-0000-000000000001',1,true),
 ('55555555-5555-4555-8555-555555555555','CI Financeiro','financeiro@prontomedic.test','financeiro','00000000-0000-0000-0000-000000000001',1,true)
ON CONFLICT (id) DO UPDATE SET full_name=EXCLUDED.full_name, email=EXCLUDED.email, role_name=EXCLUDED.role_name, company_id=EXCLUDED.company_id, primary_unit_id=EXCLUDED.primary_unit_id, lg_ativo=true;

UPDATE public.user_profiles AS profile
   SET role_id = canonical_role.id
  FROM public.roles AS canonical_role
 WHERE canonical_role.name = profile.role_name
   AND profile.id IN (
     '11111111-1111-4111-8111-111111111111',
     '22222222-2222-4222-8222-222222222222',
     '33333333-3333-4333-8333-333333333333',
     '44444444-4444-4444-8444-444444444444',
     '55555555-5555-4555-8555-555555555555'
   );

INSERT INTO public.role_permissions (
  role_id, module, can_view, can_create, can_edit
)
SELECT id, 'financeiro', TRUE, TRUE, TRUE
  FROM public.roles
 WHERE name = 'financeiro'
ON CONFLICT (role_id, module) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      updated_at = NOW();

INSERT INTO public.professionals (id, company_id, full_name, lg_ativo)
OVERRIDING SYSTEM VALUE
VALUES (
  995101, '00000000-0000-0000-0000-000000000001',
  'CI Profissional Repasse', TRUE
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.professional_payments (
  id, company_id, cd_professional, cd_unit, dt_reference, ds_reference,
  total_procedures, total_value, total_received, tp_remuneration,
  percentage, status, lg_ativo, created_by, updated_by
)
OVERRIDING SYSTEM VALUE
SELECT
  995101, '00000000-0000-0000-0000-000000000001', 995101, unit.id,
  DATE '2026-07-01', 'E2E Repasse Julho/2026',
  4, 400.00, 0.00, 'FIXED', 0.00, 'apurado', TRUE,
  '55555555-5555-4555-8555-555555555555',
  '55555555-5555-4555-8555-555555555555'
FROM public.units AS unit
WHERE unit.company_id = '00000000-0000-0000-0000-000000000001'
ORDER BY unit.id
LIMIT 1
ON CONFLICT (id) DO NOTHING;

