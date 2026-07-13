-- F1 RBAC behavior gate.
-- Ephemeral PostgreSQL only. Never run against DataSIGH or production.

BEGIN;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $rbac$
  SELECT NULLIF(current_setting('app.test_user_id', true), '')::uuid
$rbac$;

INSERT INTO public.companies (id, name) VALUES
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'RBAC Tenant A'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'RBAC Tenant B');

INSERT INTO auth.users (id) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('aaaaaaaa-0000-4000-8000-000000000002'),
  ('bbbbbbbb-0000-4000-8000-000000000001');

INSERT INTO public.user_profiles
  (id, full_name, email, role_id, role_name, company_id, lg_ativo)
VALUES
  (
    'aaaaaaaa-0000-4000-8000-000000000001', 'Admin A', 'admin-a@rbac.test',
    (SELECT id::integer FROM public.roles WHERE name = 'admin'), 'admin',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd', TRUE
  ),
  (
    'aaaaaaaa-0000-4000-8000-000000000002', 'User A', 'user-a@rbac.test',
    (SELECT id::integer FROM public.roles WHERE name = 'recepcao'), 'recepcao',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd', TRUE
  ),
  (
    'bbbbbbbb-0000-4000-8000-000000000001', 'Admin B', 'admin-b@rbac.test',
    (SELECT id::integer FROM public.roles WHERE name = 'admin'), 'admin',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', TRUE
  );

SET LOCAL ROLE authenticated;
SET LOCAL app.test_user_id = 'aaaaaaaa-0000-4000-8000-000000000001';

DO $rbac$
DECLARE
  v_profile public.user_profiles;
  v_medico_id integer;
  v_denied boolean;
BEGIN
  SELECT id::integer INTO v_medico_id FROM public.roles WHERE name = 'medico';

  SELECT * INTO v_profile
    FROM public.update_user_profile_secure(
      'aaaaaaaa-0000-4000-8000-000000000002',
      jsonb_build_object('full_name', 'User A Updated', 'role_id', v_medico_id)
    );

  IF v_profile.full_name <> 'User A Updated'
     OR v_profile.role_id <> v_medico_id
     OR v_profile.role_name <> 'medico' THEN
    RAISE EXCEPTION 'F1 RBAC same-tenant update or role sync mismatch: %', row_to_json(v_profile);
  END IF;

  v_denied := FALSE;
  BEGIN
    PERFORM public.update_user_profile_secure(
      'bbbbbbbb-0000-4000-8000-000000000001',
      jsonb_build_object('full_name', 'Cross tenant')
    );
  EXCEPTION WHEN OTHERS THEN
    v_denied := TRUE;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'F1 RBAC cross-tenant profile update was accepted';
  END IF;

  v_denied := FALSE;
  BEGIN
    UPDATE public.user_profiles
       SET full_name = 'Direct DML'
     WHERE id = 'aaaaaaaa-0000-4000-8000-000000000002';
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := TRUE;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'F1 RBAC direct browser DML was accepted';
  END IF;

  v_denied := FALSE;
  BEGIN
    PERFORM public.update_user_profile_secure(
      'aaaaaaaa-0000-4000-8000-000000000001',
      jsonb_build_object('lg_ativo', FALSE)
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ultimo administrador ativo%' THEN
      v_denied := TRUE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'F1 RBAC last active administrator was disabled';
  END IF;

  PERFORM set_config('app.test_user_id', 'aaaaaaaa-0000-4000-8000-000000000002', TRUE);
  v_denied := FALSE;
  BEGIN
    PERFORM public.update_user_profile_secure(
      'aaaaaaaa-0000-4000-8000-000000000002',
      jsonb_build_object(
        'role_id', (SELECT id::integer FROM public.roles WHERE name = 'admin')
      )
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%sem permissao%' THEN
      v_denied := TRUE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'F1 RBAC non-admin self-elevation was accepted';
  END IF;
END
$rbac$;

RESET ROLE;
ROLLBACK;

SELECT 'F1_RUNTIME_RBAC_BEHAVIOR=PASS' AS result;
