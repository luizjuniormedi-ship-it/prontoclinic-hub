-- F1 TISS read-model gate. Ephemeral PostgreSQL only; no DML survives rollback.
BEGIN;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID LANGUAGE sql STABLE AS $f1$
  SELECT NULLIF(current_setting('app.test_user_id', true), '')::UUID
$f1$;

DO $f1$
DECLARE
  v_result_columns TEXT[];
  v_definition TEXT;
BEGIN
  IF to_regprocedure(
    'public.list_tiss_read_model_secure(integer,integer,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'F1 TISS read model RPC is missing';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.list_tiss_read_model_secure(integer,integer,integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.list_tiss_read_model_secure(integer,integer,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'F1 TISS read model RPC grants are unsafe';
  END IF;

  SELECT p.proargnames, pg_get_functiondef(p.oid)
    INTO v_result_columns, v_definition
    FROM pg_proc AS p
   WHERE p.oid = to_regprocedure(
     'public.list_tiss_read_model_secure(integer,integer,integer)'
   );

  IF v_result_columns && ARRAY['cd_convenio', 'dt_fatura', 'status']::TEXT[] THEN
    RAISE EXCEPTION 'F1 TISS read model exposes a forbidden legacy projection';
  END IF;

  IF v_definition !~ 'tiss\.company_id = v_company_id'
     OR v_definition !~ 'plan\.id = tiss\.insurance_plan_id'
     OR v_definition !~ 'operator\.id = plan\.insurance_company_id' THEN
    RAISE EXCEPTION 'F1 TISS read model lacks explicit tenant/operator predicates';
  END IF;

  IF v_definition ~* '\m(insert|update|delete|merge|call)\M' THEN
    RAISE EXCEPTION 'F1 TISS read model function contains DML';
  END IF;
END
$f1$;

INSERT INTO public.companies (id, name) VALUES
  ('51111111-aaaa-4111-8111-111111111111', 'TISS Read A'),
  ('52222222-bbbb-4222-8222-222222222222', 'TISS Read B');
INSERT INTO auth.users (id) VALUES
  ('51111111-0000-4000-8000-000000000001'),
  ('52222222-0000-4000-8000-000000000001');
INSERT INTO public.user_profiles (id, full_name, email, role_name, company_id) VALUES
  ('51111111-0000-4000-8000-000000000001', 'TISS User A', 'a@tiss.test', 'faturamento', '51111111-aaaa-4111-8111-111111111111'),
  ('52222222-0000-4000-8000-000000000001', 'TISS User B', 'b@tiss.test', 'faturamento', '52222222-bbbb-4222-8222-222222222222');

INSERT INTO public.insurance_companies (id, company_id, name) OVERRIDING SYSTEM VALUE VALUES
  (970001, '51111111-aaaa-4111-8111-111111111111', 'Operator A'),
  (970002, '52222222-bbbb-4222-8222-222222222222', 'Operator B');
INSERT INTO public.insurance_plans (id, company_id, insurance_company_id, name) OVERRIDING SYSTEM VALUE VALUES
  (970003, '51111111-aaaa-4111-8111-111111111111', 970001, 'Plan A'),
  (970004, '52222222-bbbb-4222-8222-222222222222', 970002, 'Plan B');

INSERT INTO public.patients (id, company_id, full_name) OVERRIDING SYSTEM VALUE VALUES
  (970009, '51111111-aaaa-4111-8111-111111111111', 'TISS Patient A'),
  (970010, '52222222-bbbb-4222-8222-222222222222', 'TISS Patient B');
INSERT INTO public.appointments (
  id, company_id, patient_id, appointment_date, start_time, status
) OVERRIDING SYSTEM VALUE VALUES
  (970011, '51111111-aaaa-4111-8111-111111111111', 970009, CURRENT_DATE, '09:00', 'completed'),
  (970012, '52222222-bbbb-4222-8222-222222222222', 970010, CURRENT_DATE, '10:00', 'completed');
INSERT INTO public.billings (
  id, company_id, patient_id, appointment_id, amount, status
) OVERRIDING SYSTEM VALUE VALUES
  (970005, '51111111-aaaa-4111-8111-111111111111', 970009, 970011, 125.50, 'em_aberto'),
  (970006, '52222222-bbbb-4222-8222-222222222222', 970010, 970012, 250.00, 'em_aberto');
INSERT INTO public.tiss_xml (
  id, company_id, billing_id, appointment_id, patient_id, insurance_plan_id, created_at
)
OVERRIDING SYSTEM VALUE VALUES
  (970007, '51111111-aaaa-4111-8111-111111111111', 970005, 970011, 970009, 970003, '2026-07-10T12:00:00Z'),
  (970008, '52222222-bbbb-4222-8222-222222222222', 970006, 970012, 970010, 970004, '2026-07-10T13:00:00Z');

SET LOCAL ROLE authenticated;
SET LOCAL app.test_user_id = '51111111-0000-4000-8000-000000000001';

DO $f1$
DECLARE
  v_row RECORD;
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.list_tiss_read_model_secure(2026, 7, NULL);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'F1 TISS cross-tenant isolation failed: expected 1, found %', v_count;
  END IF;

  SELECT * INTO v_row
  FROM public.list_tiss_read_model_secure(2026, 7, NULL);
  IF v_row.tiss_xml_id <> 970007
     OR v_row.appointment_id <> 970011
     OR v_row.patient_id <> 970009
     OR v_row.insurance_plan_id <> 970003
     OR v_row.insurance_company_id <> 970001
     OR v_row.insurance_company_name <> 'Operator A'
     OR v_row.insurance_plan_name <> 'Plan A'
     OR v_row.billing_amount <> 125.50 THEN
    RAISE EXCEPTION 'F1 TISS read model contract mismatch: %', row_to_json(v_row);
  END IF;

  SELECT count(*) INTO v_count
  FROM public.list_tiss_read_model_secure(2026, 7, 970002);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'F1 TISS accepted a cross-tenant operator filter';
  END IF;
END
$f1$;

RESET ROLE;
SET LOCAL ROLE anon;
DO $f1$
DECLARE v_denied BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.list_tiss_read_model_secure(NULL, NULL, NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'F1 anon executed TISS read model RPC'; END IF;
END
$f1$;
RESET ROLE;

ROLLBACK;
SELECT 'F1_RUNTIME_TISS_READ_MODEL=PASS' AS result;
