\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition boolean, message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(condition, false) THEN
    RAISE EXCEPTION 'AUTH_FOUNDATION_ASSERTION_FAILED: %', message;
  END IF;
END;
$$;

-- Structural contracts.
SELECT pg_temp.assert_true(
  to_regclass('public.roles') IS NOT NULL,
  'public.roles must exist'
);
SELECT pg_temp.assert_true(
  to_regclass('public.role_permissions') IS NOT NULL,
  'public.role_permissions must exist'
);
SELECT pg_temp.assert_true(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_profiles'::regclass),
  'user_profiles must have RLS enabled'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.user_profiles'::regclass
      AND contype = 'f'
      AND confrelid = 'auth.users'::regclass
      AND conkey = ARRAY[(
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.user_profiles'::regclass AND attname = 'id'
      )]::smallint[]
      AND confkey = ARRAY[(
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'auth.users'::regclass AND attname = 'id'
      )]::smallint[]
      AND convalidated
  ),
  'user_profiles.id must have a validated FK to auth.users.id'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indrelid = 'public.role_permissions'::regclass
      AND indisunique
      AND pg_get_indexdef(indexrelid) ~ '\(company_id, role_id, module\)'
  ),
  'role_permissions must enforce unique (company_id, role_id, module)'
);
SELECT pg_temp.assert_true(
  pg_get_function_result('public.log_data_access(text,text,text,jsonb)'::regprocedure) = 'bigint',
  'log_data_access must return the persisted BIGINT audit id'
);
SELECT pg_temp.assert_true(
  COALESCE(
    (SELECT 'security_invoker=true' = ANY(reloptions)
       FROM pg_class
      WHERE oid = 'public.audit_logs_stats'::regclass),
    false
  ),
  'audit_logs_stats must execute as security invoker'
);

-- Deterministic tenant fixture.
INSERT INTO public.companies (id, name)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'Empresa A'),
  ('20000000-0000-0000-0000-000000000002', 'Empresa B');

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin.a@example.test', 'test', now()),
  ('a0000000-0000-0000-0000-000000000002', 'user.a@example.test', 'test', now()),
  ('a0000000-0000-0000-0000-000000000003', 'inactive.a@example.test', 'test', now()),
  ('b0000000-0000-0000-0000-000000000001', 'admin.b@example.test', 'test', now());

INSERT INTO public.user_profiles (
  id, user_id, full_name, email, role_id, role_name, company_id, lg_ativo
)
VALUES
  (
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'Admin A', 'admin.a@example.test',
    (SELECT id FROM public.roles WHERE name = 'admin'),
    'admin', '10000000-0000-0000-0000-000000000001', true
  ),
  (
    'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000002',
    'Usuário A', 'user.a@example.test',
    (SELECT id FROM public.roles WHERE name = 'recepcao'),
    'recepcao', '10000000-0000-0000-0000-000000000001', true
  ),
  (
    'b0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'Admin B', 'admin.b@example.test',
    (SELECT id FROM public.roles WHERE name = 'admin'),
    'admin', '20000000-0000-0000-0000-000000000002', true
  ),
  (
    'a0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000003',
    'Usuário inativo A', 'inactive.a@example.test',
    (SELECT id FROM public.roles WHERE name = 'recepcao'),
    'recepcao', '10000000-0000-0000-0000-000000000001', false
  );

INSERT INTO public.units (company_id, cd_codigo, ds_nome, lg_ativo)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'AUTH-A', 'Unidade Auth A', TRUE),
  ('20000000-0000-0000-0000-000000000002', 'AUTH-B', 'Unidade Auth B', TRUE);

INSERT INTO public.memberships (id, user_id, company_id, status)
VALUES
  ('aa000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'active'),
  ('aa000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'active'),
  ('aa000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'suspended'),
  ('bb000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'active');

INSERT INTO public.membership_roles (membership_id, role_id)
VALUES
  ('aa000000-0000-0000-0000-000000000001', (SELECT id FROM public.roles WHERE name = 'admin')),
  ('aa000000-0000-0000-0000-000000000002', (SELECT id FROM public.roles WHERE name = 'recepcao')),
  ('aa000000-0000-0000-0000-000000000003', (SELECT id FROM public.roles WHERE name = 'recepcao')),
  ('bb000000-0000-0000-0000-000000000001', (SELECT id FROM public.roles WHERE name = 'admin'));

INSERT INTO public.membership_units (membership_id, unit_id)
SELECT 'aa000000-0000-0000-0000-000000000001'::UUID, id FROM public.units WHERE cd_codigo = 'AUTH-A'
UNION ALL SELECT 'aa000000-0000-0000-0000-000000000002'::UUID, id FROM public.units WHERE cd_codigo = 'AUTH-A'
UNION ALL SELECT 'aa000000-0000-0000-0000-000000000003'::UUID, id FROM public.units WHERE cd_codigo = 'AUTH-A'
UNION ALL SELECT 'bb000000-0000-0000-0000-000000000001'::UUID, id FROM public.units WHERE cd_codigo = 'AUTH-B';

INSERT INTO public.role_permissions (
  company_id, role_id, module,
  can_view, can_create, can_edit, can_delete, can_export
)
VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.roles WHERE name = 'recepcao'),
    'dashboard', false, false, false, false, false
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    (SELECT id FROM public.roles WHERE name = 'recepcao'),
    'dashboard', false, false, false, false, false
  );

-- Ordinary users see only their own profile and cannot escalate privileges.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.user_profiles) = 1,
  'ordinary users must see only their own profile'
);
DO $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.user_profiles
     SET role_name = 'admin'
   WHERE id = 'a0000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 0 THEN
    RAISE EXCEPTION 'AUTH_FOUNDATION_ASSERTION_FAILED: ordinary users must not change their role';
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
END;
$$;
DO $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.role_permissions
     SET can_delete = true
   WHERE role_id = (SELECT id FROM public.roles WHERE name = 'recepcao');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 0 THEN
    RAISE EXCEPTION 'AUTH_FOUNDATION_ASSERTION_FAILED: ordinary users must not change the permission matrix';
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
END;
$$;
RESET ROLE;

-- Inactive profiles are denied even if the Auth session is still valid.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.user_profiles) = 0,
  'inactive users must not obtain an application profile'
);
SELECT pg_temp.assert_true(
  public.auth_profile_company_id() IS NULL
  AND NOT public.auth_is_company_admin(),
  'inactive users must not obtain tenant or admin context'
);
RESET ROLE;

-- Company admins see/manage only their own tenant.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SET LOCAL request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"aa000000-0000-0000-0000-000000000099"}';
SELECT public.activate_application_context(
  'aa000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.roles WHERE name = 'admin'),
  (SELECT id FROM public.units WHERE cd_codigo = 'AUTH-A'),
  'aa000000-0000-0000-0000-000000000077',
  'Teste auth foundation',
  'psql',
  'auth-foundation'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.user_profiles) = 3,
  'company admins must see profiles from their company only'
);
WITH changed AS (
  UPDATE public.user_profiles
     SET phone = '+552100000000'
   WHERE id = 'a0000000-0000-0000-0000-000000000002'
  RETURNING 1
)
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM changed) = 1,
  'company admins must update a profile in their own company'
);
DO $$
BEGIN
  UPDATE public.user_profiles
     SET company_id = '20000000-0000-0000-0000-000000000002'
   WHERE id = 'a0000000-0000-0000-0000-000000000002';
  RAISE EXCEPTION 'AUTH_FOUNDATION_ASSERTION_FAILED: company admins must not move profiles across tenants';
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
END;
$$;
DO $$
BEGIN
  UPDATE public.role_permissions
     SET can_view = true
   WHERE role_id = (SELECT id FROM public.roles WHERE name = 'recepcao')
     AND module = 'dashboard';
  RAISE EXCEPTION 'AUTH_FOUNDATION_ASSERTION_FAILED: admins must not bypass the permission writer RPC';
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
END;
$$;

SELECT pg_temp.assert_true(
  public.log_data_access('user_profiles', 'self', 'SELECT', '{}'::jsonb) > 0,
  'log_data_access must return the persisted audit id'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.audit_logs_stats
    WHERE company_id <> '10000000-0000-0000-0000-000000000001'
  ),
  'audit statistics must not leak another tenant'
);
RESET ROLE;

ROLLBACK;
