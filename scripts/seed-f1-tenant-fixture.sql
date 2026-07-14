-- Fixture efemera para a prova F1 de isolamento entre tenants.
-- Uso exclusivo em CI/local descartavel. Nunca executar contra o DataSIGH.

\if :{?f1_password}
\else
  \echo 'Variavel psql obrigatoria ausente: -v f1_password=<senha temporaria>'
  \quit 1
\endif

\if :{?f1_ephemeral}
\else
  \echo 'Protecao: esta fixture exige -v f1_ephemeral=1 e so pode rodar em banco descartavel'
  \quit 1
\endif

\if :f1_ephemeral
\else
  \echo 'Protecao: f1_ephemeral deve ser exatamente 1; fixture recusada'
  \quit 1
\endif

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Os IDs abaixo sao reservados exclusivamente para o gate. Se qualquer um ja
-- existir, abortar em vez de usar ON CONFLICT para sobrescrever dados alheios.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.companies
    WHERE id IN (
      'f1000000-0000-4000-8000-000000000001'::uuid,
      'f1000000-0000-4000-8000-000000000002'::uuid
    )
  )
  OR EXISTS (
    SELECT 1 FROM public.units WHERE id IN (9101, 9102)
  )
  OR EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id IN (
      'f1000000-0000-4000-8000-000000000011'::uuid,
      'f1000000-0000-4000-8000-000000000012'::uuid
    )
  )
  OR EXISTS (
    SELECT 1 FROM public.patients WHERE id = 910001
  )
  OR EXISTS (
    SELECT 1 FROM public.exames_lab_catalogo
    WHERE id IN (920001, 920002)
  ) THEN
    RAISE EXCEPTION 'F1_FIXTURE_REFUSED: reserved IDs already exist; use a clean ephemeral database';
  END IF;
END
$$;

-- O dump de producao possui estas tabelas. A criacao condicional permite que a
-- prova tambem rode em um PostgreSQL limpo, sem depender de dados migrados.
CREATE TABLE IF NOT EXISTS public.roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id BIGSERIAL PRIMARY KEY,
  role_id INTEGER NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  module VARCHAR(80) NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT FALSE,
  can_create BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  can_export BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (role_id, module)
);

INSERT INTO public.roles (id, name)
VALUES (9101, 'recepcao'), (9102, 'medico')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO public.role_permissions (role_id, module, can_view, can_create, can_edit, can_delete)
VALUES
  (9101, 'pacientes', TRUE, TRUE, TRUE, FALSE),
  (9102, 'pacientes', TRUE, TRUE, TRUE, FALSE)
ON CONFLICT (role_id, module) DO UPDATE SET
  can_view = EXCLUDED.can_view,
  can_create = EXCLUDED.can_create,
  can_edit = EXCLUDED.can_edit,
  can_delete = EXCLUDED.can_delete;

INSERT INTO public.companies (id, name, cnpj, lg_ativo)
VALUES
  ('f1000000-0000-4000-8000-000000000001', 'F1 Tenant A', '00000000000191', TRUE),
  ('f1000000-0000-4000-8000-000000000002', 'F1 Tenant B', '00000000000272', TRUE)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, lg_ativo = TRUE;

INSERT INTO public.units (id, company_id, cd_codigo, ds_nome, lg_principal, lg_ativo)
VALUES
  (9101, 'f1000000-0000-4000-8000-000000000001', 'F1-A', 'Unidade F1 A', TRUE, TRUE),
  (9102, 'f1000000-0000-4000-8000-000000000002', 'F1-B', 'Unidade F1 B', TRUE, TRUE)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  cd_codigo = EXCLUDED.cd_codigo,
  ds_nome = EXCLUDED.ds_nome,
  lg_principal = TRUE,
  lg_ativo = TRUE;

WITH fixture_users(id, email, full_name, role_name, role_id, company_id, unit_id) AS (
  VALUES
    ('f1000000-0000-4000-8000-000000000011'::uuid, 'f1-tenant-a@prontomedic.test', 'F1 Tenant A', 'recepcao', 9101, 'f1000000-0000-4000-8000-000000000001'::uuid, 9101),
    ('f1000000-0000-4000-8000-000000000012'::uuid, 'f1-tenant-b@prontomedic.test', 'F1 Tenant B', 'medico', 9102, 'f1000000-0000-4000-8000-000000000002'::uuid, 9102)
), upsert_auth AS (
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  SELECT
    '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
    crypt(:'f1_password', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"],"e2e":true}'::jsonb,
    jsonb_build_object('full_name', full_name, 'role', role_name, 'e2e', true),
    now(), now(), '', '', '', ''
  FROM fixture_users
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
  id, full_name, email, role_id, role_name, company_id, primary_unit_id,
  lg_ativo, created_at, updated_at
)
SELECT id, full_name, email, role_id, role_name, company_id, unit_id, TRUE, now(), now()
FROM fixture_users
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  email = EXCLUDED.email,
  role_id = EXCLUDED.role_id,
  role_name = EXCLUDED.role_name,
  company_id = EXCLUDED.company_id,
  primary_unit_id = EXCLUDED.primary_unit_id,
  lg_ativo = TRUE,
  updated_at = now();

INSERT INTO public.patients (id, company_id, full_name, cpf, lg_ativo)
VALUES (910001, 'f1000000-0000-4000-8000-000000000001', 'Paciente controlado F1', '91000100001', TRUE)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  full_name = EXCLUDED.full_name,
  cpf = EXCLUDED.cpf,
  lg_ativo = TRUE;

INSERT INTO public.exames_lab_catalogo (id, company_id, ds_exame, ds_sigla, vl_particular, lg_ativo)
VALUES
  (920001, 'f1000000-0000-4000-8000-000000000001', 'Exame LIS Tenant A', 'F1A', 10.00, TRUE),
  (920002, 'f1000000-0000-4000-8000-000000000002', 'Exame LIS Tenant B', 'F1B', 20.00, TRUE)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  ds_exame = EXCLUDED.ds_exame,
  ds_sigla = EXCLUDED.ds_sigla,
  vl_particular = EXCLUDED.vl_particular,
  lg_ativo = TRUE;

SELECT 'F1_FIXTURE_READY' AS status,
       (SELECT count(*) FROM public.user_profiles WHERE id IN ('f1000000-0000-4000-8000-000000000011', 'f1000000-0000-4000-8000-000000000012')) AS users,
       (SELECT count(*) FROM public.patients WHERE id = 910001) AS controlled_patients;
