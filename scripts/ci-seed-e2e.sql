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
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@prontomedic.test',crypt('TestPassword123!',gen_salt('bf')),now(),'{"provider":"email"}'::jsonb,'{"role":"admin"}'::jsonb),
 ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','doctor@prontomedic.test',crypt('TestPassword123!',gen_salt('bf')),now(),'{"provider":"email"}'::jsonb,'{"role":"doctor"}'::jsonb),
 ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recepcao@prontomedic.test',crypt('TestPassword123!',gen_salt('bf')),now(),'{"provider":"email"}'::jsonb,'{"role":"reception"}'::jsonb),
 ('44444444-4444-4444-4444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','paciente@prontomedic.test',crypt('TestPassword123!',gen_salt('bf')),now(),'{"provider":"email"}'::jsonb,'{"role":"patient"}'::jsonb)
ON CONFLICT (id) DO UPDATE SET encrypted_password=EXCLUDED.encrypted_password, email_confirmed_at=now(), updated_at=now();

INSERT INTO public.user_profiles (id, full_name, email, role_name, company_id, primary_unit_id, lg_ativo)
VALUES
 ('11111111-1111-1111-1111-111111111111','CI Admin','admin@prontomedic.test','admin','00000000-0000-0000-0000-000000000001',1,true),
 ('22222222-2222-2222-2222-222222222222','CI Doctor','doctor@prontomedic.test','doctor','00000000-0000-0000-0000-000000000001',1,true),
 ('33333333-3333-3333-3333-333333333333','CI Recepcao','recepcao@prontomedic.test','reception','00000000-0000-0000-0000-000000000001',1,true),
 ('44444444-4444-4444-4444-444444444444','CI Paciente','paciente@prontomedic.test','patient','00000000-0000-0000-0000-000000000001',1,true)
ON CONFLICT (id) DO UPDATE SET full_name=EXCLUDED.full_name, email=EXCLUDED.email, role_name=EXCLUDED.role_name, company_id=EXCLUDED.company_id, primary_unit_id=EXCLUDED.primary_unit_id, lg_ativo=true;