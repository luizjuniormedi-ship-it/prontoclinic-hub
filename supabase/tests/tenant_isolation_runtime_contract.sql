-- Runtime tenant contract. Execute only in an approved disposable local database.
-- Required psql variables: company_a, company_b, user_a, user_b, patient_a_id, patient_b_id.
-- Every mutation is inside a transaction and is rolled back at the end.

\set ON_ERROR_STOP on
BEGIN;

SELECT set_config('mvp.company_a', :'company_a', true);
SELECT set_config('mvp.company_b', :'company_b', true);
SELECT set_config('mvp.patient_a_id', :'patient_a_id', true);
SELECT set_config('mvp.patient_b_id', :'patient_b_id', true);

-- Prevent vacuous passes: both tenant fixtures must exist before RLS is tested.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patients
    WHERE id = current_setting('mvp.patient_a_id')::BIGINT
      AND company_id = current_setting('mvp.company_a')::UUID
  ) OR NOT EXISTS (
    SELECT 1 FROM public.patients
    WHERE id = current_setting('mvp.patient_b_id')::BIGINT
      AND company_id = current_setting('mvp.company_b')::UUID
  ) THEN
    RAISE EXCEPTION 'tenant fixtures A/B are required before RLS assertions';
  END IF;
END
$$;

-- The harness must run as the application role, never as postgres/service_role.
SET LOCAL ROLE authenticated;

-- Same-company read: user_a must see the fixture row in company_a.
SELECT set_config('request.jwt.claims', json_build_object('sub', :'user_a')::text, true);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patients
    WHERE id = current_setting('mvp.patient_a_id')::BIGINT
      AND company_id = current_setting('mvp.company_a')::UUID
  ) THEN
    RAISE EXCEPTION 'same-company allow failed: fixture row is not visible';
  END IF;
END
$$;

-- Same-company write: a harmless self-update must affect exactly one row.
DO $$
DECLARE affected INTEGER;
BEGIN
  UPDATE public.patients
  SET updated_at = updated_at
  WHERE id = current_setting('mvp.patient_a_id')::BIGINT;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'same-company write failed: expected one affected row, got %', affected;
  END IF;
END
$$;

-- Cross-company read: the same user must not see a company_b row.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.patients
    WHERE company_id = current_setting('mvp.company_b')::UUID
  ) THEN
    RAISE EXCEPTION 'cross-company deny failed: company_b patient is visible';
  END IF;
END
$$;

-- Cross-company write: changing a visible row to company_b must affect zero rows
-- or fail with RLS; it must never commit a cross-tenant update.
DO $$
BEGIN
  BEGIN
    UPDATE public.patients
    SET company_id = current_setting('mvp.company_b')::UUID
    WHERE id = current_setting('mvp.patient_a_id')::BIGINT;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;
  IF EXISTS (
    SELECT 1 FROM public.patients
    WHERE id = current_setting('mvp.patient_a_id')::BIGINT
      AND company_id = current_setting('mvp.company_b')::UUID
  ) THEN
    RAISE EXCEPTION 'cross-company deny failed: tenant reassignment succeeded';
  END IF;
END
$$;

-- Symmetric tenant check: user_b must see only the company_b fixture.
SELECT set_config('request.jwt.claims', json_build_object('sub', :'user_b')::text, true);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patients
    WHERE id = current_setting('mvp.patient_b_id')::BIGINT
      AND company_id = current_setting('mvp.company_b')::UUID
  ) THEN
    RAISE EXCEPTION 'same-company allow failed for user_b';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.patients
    WHERE id = current_setting('mvp.patient_a_id')::BIGINT
      AND company_id = current_setting('mvp.company_a')::UUID
  ) THEN
    RAISE EXCEPTION 'cross-company deny failed for user_b';
  END IF;
END
$$;

ROLLBACK;
