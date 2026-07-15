BEGIN;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $f1$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$f1$;

DO $f1$
DECLARE
  v_signature REGPROCEDURE;
  v_result JSONB;
  v_company UUID;
  v_denied BOOLEAN;
BEGIN
  v_signature := to_regprocedure(
    'public.validate_insurance_operation_secure(text,integer,integer,bigint,integer,bigint,bigint,bigint,date,boolean)'
  );
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'F1 blocker: secure Convenios RPC signature missing';
  END IF;

  IF has_function_privilege(
    'anon', v_signature, 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'F1 blocker: anon can execute secure Convenios RPC';
  END IF;
  IF NOT has_function_privilege(
    'authenticated', v_signature, 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'F1 blocker: authenticated cannot execute secure Convenios RPC';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.validate_insurance_operation(uuid,text,integer,integer,bigint,integer,bigint,bigint,bigint,date,boolean)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'F1 blocker: authenticated can execute legacy Convenios RPC';
  END IF;

  INSERT INTO public.companies (id, name)
  VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Tenant A'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Tenant B')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_profiles (id, full_name, email, role_name, company_id, lg_ativo)
  VALUES
    ('11111111-1111-4111-8111-111111111111', 'F1 User A', 'f1-a@test.local', 'admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', TRUE),
    ('22222222-2222-4222-8222-222222222222', 'F1 User B', 'f1-b@test.local', 'admin', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', TRUE)
  ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id, role_name = EXCLUDED.role_name, lg_ativo = TRUE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

  SELECT public.get_my_company_id() INTO v_company;
  IF v_company <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::UUID THEN
    RAISE EXCEPTION 'F1 tenant binding mismatch for user A: %', v_company;
  END IF;

  SELECT public.validate_insurance_operation_secure(
    'f1_tenant_probe', 2147483647, NULL, NULL, NULL, NULL, NULL, NULL, CURRENT_DATE, FALSE
  ) INTO v_result;
  IF NOT (v_result @> '{"blockers":[{"code":"INSURANCE_INACTIVE_OR_MISSING"}]}'::JSONB) THEN
    RAISE EXCEPTION 'F1 secure RPC did not bind user A tenant: %', v_result;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  SELECT public.get_my_company_id() INTO v_company;
  IF v_company <> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::UUID THEN
    RAISE EXCEPTION 'F1 tenant binding mismatch for user B: %', v_company;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_denied := FALSE;
  BEGIN
    PERFORM public.validate_insurance_operation_secure(
      'f1_unauthenticated_probe', 2147483647, NULL, NULL, NULL, NULL, NULL, NULL, CURRENT_DATE, FALSE
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_denied := TRUE;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'F1 blocker: secure RPC accepted missing auth.uid()';
  END IF;
END
$f1$;

ROLLBACK;

SELECT 'CONVENIOS_SECURE_RPC=PASS' AS gate;

