-- F1 TISS foundation gate. Ephemeral PostgreSQL only; no RPC or transmission.
BEGIN;

DO $f1$
DECLARE
  v_fk_count INTEGER;
BEGIN
  IF to_regclass('public.tiss_xml') IS NULL THEN
    RAISE EXCEPTION 'F1 TISS foundation missing public.tiss_xml';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.tiss_xml'::regclass
      AND attname = 'company_id' AND attnotnull
  ) THEN
    RAISE EXCEPTION 'F1 TISS foundation company_id must be NOT NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.tiss_xml'::regclass
      AND attname IN (
        'billing_id', 'appointment_id', 'patient_id',
        'insurance_plan_id', 'insurance_authorization_id'
      ) AND NOT attisdropped
    GROUP BY attrelid
    HAVING count(*) = 5
  ) THEN
    RAISE EXCEPTION 'F1 TISS foundation canonical reference columns missing';
  END IF;

  SELECT count(*) INTO v_fk_count
  FROM pg_constraint c
  WHERE c.conrelid = 'public.tiss_xml'::regclass
    AND c.contype = 'f'
    AND array_length(c.conkey, 1) = 2
    AND c.confdeltype = 'r'
    AND c.confrelid IN (
      'public.billings'::regclass, 'public.appointments'::regclass,
      'public.patients'::regclass, 'public.insurance_plans'::regclass,
      'public.insurance_authorizations'::regclass
    );
  IF v_fk_count <> 5 THEN
    RAISE EXCEPTION 'F1 TISS foundation expected five composite tenant FKs, found %', v_fk_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = 'public.tiss_xml'::regclass
      AND i.indisunique AND i.indisvalid
      AND i.indnkeyatts = 2
      AND i.indkey[0] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = i.indrelid AND attname = 'company_id'
      )
      AND i.indkey[1] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = i.indrelid AND attname = 'billing_id'
      )
      AND pg_get_expr(i.indpred, i.indrelid) IN (
        '(billing_id IS NOT NULL)', 'billing_id IS NOT NULL'
      )
  ) THEN
    RAISE EXCEPTION 'F1 TISS foundation missing company-scoped billing idempotency index';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'tiss_xml'
      AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'F1 TISS foundation requires ENABLE and FORCE RLS';
  END IF;

  IF has_table_privilege('anon', 'public.tiss_xml', 'INSERT')
     OR has_table_privilege('anon', 'public.tiss_xml', 'UPDATE')
     OR has_table_privilege('anon', 'public.tiss_xml', 'DELETE')
     OR has_table_privilege('authenticated', 'public.tiss_xml', 'INSERT')
     OR has_table_privilege('authenticated', 'public.tiss_xml', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.tiss_xml', 'DELETE') THEN
    RAISE EXCEPTION 'F1 TISS foundation browser DML privileges were not revoked';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname ~* 'tiss.*(send|transmit)' OR p.proname ~* '(send|transmit).*tiss')
  ) THEN
    RAISE EXCEPTION 'F1 TISS foundation must not expose transmission functions';
  END IF;
END
$f1$;

INSERT INTO public.companies (id, name) VALUES
  ('41111111-aaaa-4111-8111-111111111111', 'TISS A'),
  ('42222222-bbbb-4222-8222-222222222222', 'TISS B');

INSERT INTO public.patients (id, company_id, full_name) OVERRIDING SYSTEM VALUE VALUES
  (960003, '41111111-aaaa-4111-8111-111111111111', 'Patient A'),
  (960004, '42222222-bbbb-4222-8222-222222222222', 'Patient B');

INSERT INTO public.appointments (
  id, company_id, patient_id, appointment_date, start_time, status
) OVERRIDING SYSTEM VALUE VALUES
  (960007, '41111111-aaaa-4111-8111-111111111111', 960003, CURRENT_DATE, '09:00', 'completed'),
  (960008, '42222222-bbbb-4222-8222-222222222222', 960004, CURRENT_DATE, '10:00', 'completed');

INSERT INTO public.billings (
  id, company_id, patient_id, appointment_id, amount, status
) OVERRIDING SYSTEM VALUE VALUES
  (960005, '41111111-aaaa-4111-8111-111111111111', 960003, 960007, 100, 'em_aberto'),
  (960006, '42222222-bbbb-4222-8222-222222222222', 960004, 960008, 200, 'em_aberto');

DO $f1$
DECLARE
  v_denied BOOLEAN;
BEGIN
  INSERT INTO public.tiss_xml(company_id, billing_id)
  VALUES ('41111111-aaaa-4111-8111-111111111111', 960005);

  INSERT INTO public.tiss_xml(company_id, billing_id)
  VALUES ('42222222-bbbb-4222-8222-222222222222', 960006);

  v_denied := FALSE;
  BEGIN
    INSERT INTO public.tiss_xml(company_id, billing_id)
    VALUES ('41111111-aaaa-4111-8111-111111111111', 960005);
  EXCEPTION WHEN unique_violation THEN v_denied := TRUE; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'F1 TISS duplicate company billing accepted'; END IF;

  v_denied := FALSE;
  BEGIN
    INSERT INTO public.tiss_xml(company_id, billing_id)
    VALUES ('41111111-aaaa-4111-8111-111111111111', 960006);
  EXCEPTION WHEN foreign_key_violation THEN v_denied := TRUE; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'F1 TISS cross-tenant billing accepted'; END IF;
END
$f1$;

SET LOCAL ROLE authenticated;
DO $f1$
DECLARE v_denied BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO public.tiss_xml(company_id, billing_id)
    VALUES ('41111111-aaaa-4111-8111-111111111111', 960005);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'F1 TISS direct authenticated DML accepted'; END IF;
END
$f1$;
RESET ROLE;

ROLLBACK;
SELECT 'F1_RUNTIME_TISS_FOUNDATION_GATE=PASS' AS result;
