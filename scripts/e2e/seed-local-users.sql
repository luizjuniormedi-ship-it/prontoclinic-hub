-- Synthetic-only CI fixture. Never run this against a remote or production database.
INSERT INTO public.companies (id, name, cnpj, phone, email, lg_ativo)
VALUES (
  '00000000-0000-4000-8000-000000000010',
  'ProntoMedic CI Synthetic',
  '00000000000000',
  '00000000000',
  'ci@example.invalid',
  true
)
ON CONFLICT (id) DO UPDATE SET lg_ativo = true;

INSERT INTO public.units (id, company_id, cd_codigo, ds_nome, lg_principal, lg_ativo)
VALUES (
  1,
  '00000000-0000-4000-8000-000000000010',
  'CI',
  'Unidade Sintetica CI',
  true,
  true
)
ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id, lg_ativo = true;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token
)
VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'admin.ci@example.invalid', crypt('E2E-Local-Password-123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Admin CI"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'doctor.ci@example.invalid', crypt('E2E-Local-Password-123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Doctor CI"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000013', 'authenticated', 'authenticated', 'reception.ci@example.invalid', crypt('E2E-Local-Password-123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Reception CI"}', now(), now(), '', '', '', '')
ON CONFLICT (id) DO UPDATE SET
  encrypted_password = EXCLUDED.encrypted_password,
  email_confirmed_at = now(),
  updated_at = now();

INSERT INTO public.user_profiles (id, user_id, full_name, email, role_name, company_id, primary_unit_id, lg_ativo)
VALUES
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011', 'Admin CI', 'admin.ci@example.invalid', 'admin', '00000000-0000-4000-8000-000000000010', 1, true),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012', 'Doctor CI', 'doctor.ci@example.invalid', 'doctor', '00000000-0000-4000-8000-000000000010', 1, true),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000013', 'Reception CI', 'reception.ci@example.invalid', 'reception', '00000000-0000-4000-8000-000000000010', 1, true)
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  email = EXCLUDED.email,
  role_name = EXCLUDED.role_name,
  company_id = EXCLUDED.company_id,
  primary_unit_id = EXCLUDED.primary_unit_id,
  lg_ativo = true,
  updated_at = now();
