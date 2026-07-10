-- =============================================================================
-- Seed: Admin user para ProntoClinic Hub v1.1.0
-- =============================================================================
-- Cria o usuário admin padrão + perfil para acesso inicial ao sistema.
--
-- Credenciais:
--   Email:    luizjuniormedi@gmail.com
--   Senha:    <ADMIN_TEMP_PASSWORD>
--   Role:     admin
--   Company:  Clinica Demo ProntoMedic
--
-- IMPORTANTE: Trocar senha no primeiro acesso em produção.
-- =============================================================================

-- 1. Empresa demo
INSERT INTO public.companies (id, name, cnpj, phone, email, lg_ativo)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Clinica Demo ProntoMedic',
  '12345678000190',
  '11999990000',
  'contato@prontomedic.local',
  true
)
ON CONFLICT (id) DO UPDATE SET lg_ativo = true;

-- 2. Unidade principal
INSERT INTO public.units (company_id, cd_codigo, ds_nome, lg_principal, lg_ativo)
SELECT '00000000-0000-0000-0000-000000000001', 'MATRIZ', 'Unidade Matriz', true, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.units WHERE company_id = '00000000-0000-0000-0000-000000000001'
);

-- 3. Usuario no auth (com senha hasheada via crypt bcrypt)
INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated',
  'authenticated',
  'luizjuniormedi@gmail.com',
  crypt('<ADMIN_TEMP_PASSWORD>', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Luiz Junior"}',
  NOW(),
  NOW(),
  '',
  '',
  '',
  ''
)
ON CONFLICT (id) DO UPDATE SET
  encrypted_password = crypt('<ADMIN_TEMP_PASSWORD>', gen_salt('bf')),
  email_confirmed_at = COALESCE(auth.users.email_confirmed_at, NOW()),
  updated_at = NOW();

-- 4. Perfil estendido
INSERT INTO public.user_profiles (
  id, full_name, email, role_name, company_id, primary_unit_id, lg_ativo
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Luiz Junior',
  'luizjuniormedi@gmail.com',
  'admin',
  '00000000-0000-0000-0000-000000000001',
  1,
  true
)
ON CONFLICT (id) DO UPDATE SET
  role_name = 'admin',
  company_id = '00000000-0000-0000-0000-000000000001',
  lg_ativo = true,
  updated_at = NOW();

-- 5. Garante email confirmado
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, NOW())
WHERE email = 'luizjuniormedi@gmail.com' AND email_confirmed_at IS NULL;
