-- F1 audit data-access gate. Ephemeral PostgreSQL only; all fixtures roll back.
-- Never run against DataSIGH or production.

BEGIN;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $f1$
  SELECT NULLIF(current_setting('app.test_user_id', TRUE), '')::UUID
$f1$;

DO $f1$
DECLARE
  v_function_oid OID := to_regprocedure(
    'public.log_data_access(text,text,text,jsonb)'
  );
  v_owner OID;
  v_authenticated OID;
BEGIN
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'log_data_access function is missing';
  END IF;

  SELECT procedure_definition.proowner, authenticated_role.oid
    INTO v_owner, v_authenticated
    FROM pg_proc AS procedure_definition
    CROSS JOIN pg_roles AS authenticated_role
   WHERE procedure_definition.oid = v_function_oid
     AND authenticated_role.rolname = 'authenticated'
     AND procedure_definition.prosecdef
     AND procedure_definition.prorettype = 'pg_catalog.int8'::REGTYPE
     AND procedure_definition.proconfig @> ARRAY['search_path=public, pg_temp'];

  IF NOT FOUND THEN
    RAISE EXCEPTION 'log_data_access return type, SECURITY DEFINER, or search_path is unsafe';
  END IF;

  IF NOT has_function_privilege(
    'authenticated', 'public.log_data_access(text,text,text,jsonb)', 'EXECUTE'
  ) OR has_function_privilege(
    'anon', 'public.log_data_access(text,text,text,jsonb)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'log_data_access authenticated/anon ACL is unsafe';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_proc AS procedure_definition
      CROSS JOIN LATERAL aclexplode(COALESCE(
        procedure_definition.proacl,
        acldefault('f', procedure_definition.proowner)
      )) AS privilege
     WHERE procedure_definition.oid = v_function_oid
       AND privilege.privilege_type = 'EXECUTE'
       AND privilege.grantee NOT IN (v_owner, v_authenticated)
  ) THEN
    RAISE EXCEPTION 'log_data_access EXECUTE is granted beyond owner/authenticated';
  END IF;
END
$f1$;

INSERT INTO public.companies (id, name) VALUES
  ('a1500000-0000-4000-8000-000000000001', 'Audit Tenant A'),
  ('b1500000-0000-4000-8000-000000000001', 'Audit Tenant B');

INSERT INTO auth.users (id) VALUES
  ('a1500000-0000-4000-8000-000000000011'),
  ('b1500000-0000-4000-8000-000000000011'),
  ('01500000-0000-4000-8000-000000000011');

INSERT INTO public.user_profiles (
  id, full_name, email, role_name, company_id
) VALUES
  ('a1500000-0000-4000-8000-000000000011', 'Audit User A', 'a@audit.test', 'admin', 'a1500000-0000-4000-8000-000000000001'),
  ('b1500000-0000-4000-8000-000000000011', 'Audit User B', 'b@audit.test', 'admin', 'b1500000-0000-4000-8000-000000000001'),
  ('01500000-0000-4000-8000-000000000011', 'Audit No Company', 'none@audit.test', 'admin', NULL);

SET LOCAL ROLE authenticated;
SET LOCAL app.test_user_id = 'a1500000-0000-4000-8000-000000000011';
SET LOCAL request.headers = '{"x-request-id":"audit-gate-tenant-a"}';

DO $f1$
DECLARE
  v_log_id BIGINT;
  v_denied BOOLEAN := FALSE;
BEGIN
  v_log_id := public.log_data_access(
    'medical_records',
    'record-a',
    'VIEW_RECORD',
    '{"diagnosis":"must-not-be-persisted","clinical_note":"must-not-leak"}'::JSONB
  );
  IF v_log_id IS NULL THEN
    RAISE EXCEPTION 'Tenant A audit call did not return audit_logs.id';
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (company_id, acao, tabela)
    VALUES ('a1500000-0000-4000-8000-000000000001', 'VIEW_RECORD', 'medical_records');
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := TRUE;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'Authenticated direct audit_logs INSERT was accepted';
  END IF;
END
$f1$;

SET LOCAL app.test_user_id = 'b1500000-0000-4000-8000-000000000011';
SET LOCAL request.headers = '{"x-request-id":"audit-gate-tenant-b"}';

DO $f1$
DECLARE
  v_log_id BIGINT;
BEGIN
  v_log_id := public.log_data_access(
    'patients', 'record-b', 'VIEW_RECORD', '{}'::JSONB
  );
  IF v_log_id IS NULL THEN
    RAISE EXCEPTION 'Tenant B audit call did not return audit_logs.id';
  END IF;
END
$f1$;

SET LOCAL app.test_user_id = '01500000-0000-4000-8000-000000000011';

DO $f1$
DECLARE
  v_denied BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.log_data_access(
      'patients', 'record-without-company', 'VIEW_RECORD', '{}'::JSONB
    );
  EXCEPTION WHEN invalid_authorization_specification THEN
    v_denied := TRUE;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'User without company wrote an audit row';
  END IF;
END
$f1$;

RESET ROLE;
SET LOCAL ROLE anon;

DO $f1$
DECLARE
  v_denied BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.log_data_access(
      'patients', 'record-anon', 'VIEW_RECORD', '{}'::JSONB
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := TRUE;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'anon executed log_data_access';
  END IF;
END
$f1$;

RESET ROLE;

DO $f1$
DECLARE
  v_count INTEGER;
  v_row RECORD;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.audit_logs
   WHERE registro_id IN (
     'record-a', 'record-b', 'record-without-company', 'record-anon'
   );
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Expected exactly two successful audit rows, found %', v_count;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.audit_logs
     WHERE (registro_id = 'record-a'
            AND company_id <> 'a1500000-0000-4000-8000-000000000001'::UUID)
        OR (registro_id = 'record-b'
            AND company_id <> 'b1500000-0000-4000-8000-000000000001'::UUID)
  ) THEN
    RAISE EXCEPTION 'Audit A/B tenant isolation failed';
  END IF;

  SELECT * INTO v_row
    FROM public.audit_logs
   WHERE registro_id = 'record-a';
  IF v_row.company_id <> 'a1500000-0000-4000-8000-000000000001'::UUID
     OR v_row.cd_usuario <> 'a1500000-0000-4000-8000-000000000011'::UUID
     OR v_row.cd_usuario_nome <> 'Audit User A'
     OR v_row.role_name <> 'admin'
     OR v_row.acao <> 'VIEW_RECORD'
     OR v_row.tabela <> 'medical_records'
     OR v_row.operacao <> 'medical_records VIEW_RECORD via API'
     OR v_row.request_id <> 'audit-gate-tenant-a'
     OR v_row.dados_novos IS DISTINCT FROM '{"context_supplied":true}'::JSONB
     OR v_row.dados_novos::TEXT LIKE '%diagnosis%'
     OR v_row.dados_novos::TEXT LIKE '%clinical_note%'
     OR v_row.dados_novos::TEXT LIKE '%must-not%' THEN
    RAISE EXCEPTION 'Tenant A audit row contract mismatch: %', row_to_json(v_row);
  END IF;

  SELECT * INTO v_row
    FROM public.audit_logs
   WHERE registro_id = 'record-b';
  IF v_row.company_id <> 'b1500000-0000-4000-8000-000000000001'::UUID
     OR v_row.cd_usuario <> 'b1500000-0000-4000-8000-000000000011'::UUID
     OR v_row.request_id <> 'audit-gate-tenant-b'
     OR v_row.dados_novos IS DISTINCT FROM '{"context_supplied":false}'::JSONB THEN
    RAISE EXCEPTION 'Tenant B audit row contract mismatch: %', row_to_json(v_row);
  END IF;
END
$f1$;

ROLLBACK;

SELECT 'F1_RUNTIME_AUDIT_DATA_ACCESS_GATE=PASS' AS result;

