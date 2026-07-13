-- F1 billing behavior gate. Ephemeral PostgreSQL only.

BEGIN;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $f1$
  SELECT NULLIF(current_setting('app.test_user_id', true), '')::uuid
$f1$;

INSERT INTO public.companies (id, name) VALUES
  ('11111111-aaaa-4111-8111-111111111111', 'Billing Tenant A'),
  ('22222222-bbbb-4222-8222-222222222222', 'Billing Tenant B');
INSERT INTO auth.users (id) VALUES
  ('11111111-0000-4000-8000-000000000001'),
  ('22222222-0000-4000-8000-000000000001');
INSERT INTO public.user_profiles (id, full_name, email, role_name, company_id) VALUES
  ('11111111-0000-4000-8000-000000000001', 'Finance A', 'finance-a@billing.test', 'financeiro', '11111111-aaaa-4111-8111-111111111111'),
  ('22222222-0000-4000-8000-000000000001', 'Finance B', 'finance-b@billing.test', 'financeiro', '22222222-bbbb-4222-8222-222222222222');
INSERT INTO public.professionals (id, company_id, full_name) OVERRIDING SYSTEM VALUE VALUES
  (940001, '11111111-aaaa-4111-8111-111111111111', 'Doctor A'),
  (940002, '22222222-bbbb-4222-8222-222222222222', 'Doctor B');
INSERT INTO public.patients (id, company_id, full_name) OVERRIDING SYSTEM VALUE VALUES
  (940003, '11111111-aaaa-4111-8111-111111111111', 'Patient A'),
  (940004, '22222222-bbbb-4222-8222-222222222222', 'Patient B');
INSERT INTO public.appointments
  (id, company_id, patient_id, professional_id, appointment_date, start_time, end_time, status)
OVERRIDING SYSTEM VALUE VALUES
  (940005, '11111111-aaaa-4111-8111-111111111111', 940003, 940001, DATE '2026-07-21', TIME '09:00', TIME '09:30', 'completed'),
  (940006, '22222222-bbbb-4222-8222-222222222222', 940004, 940002, DATE '2026-07-21', TIME '10:00', TIME '10:30', 'completed');

SET LOCAL ROLE authenticated;
SET LOCAL app.test_user_id = '11111111-0000-4000-8000-000000000001';

DO $f1$
DECLARE v_billing public.billings; v_denied BOOLEAN;
BEGIN
  SELECT * INTO v_billing FROM public.create_billing_secure(940005, 125.50, 'particular', NULL);
  IF v_billing.company_id <> '11111111-aaaa-4111-8111-111111111111'::uuid
     OR v_billing.patient_id <> 940003 OR v_billing.status <> 'em_aberto'
     OR v_billing.amount <> 125.50 THEN
    RAISE EXCEPTION 'F1 billing create mismatch: %', row_to_json(v_billing);
  END IF;

  v_denied := FALSE;
  BEGIN
    PERFORM public.create_billing_secure(940005, 125.50, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_denied := SQLERRM LIKE '%ja possui faturamento%';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'F1 duplicate billing was accepted'; END IF;

  v_denied := FALSE;
  BEGIN
    PERFORM public.create_billing_secure(940006, 100, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_denied := SQLERRM LIKE '%fora da empresa%';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'F1 cross-tenant billing was accepted'; END IF;

  SELECT * INTO v_billing FROM public.update_billing_status_secure(v_billing.id, 'faturado', NULL);
  IF v_billing.status <> 'faturado' THEN RAISE EXCEPTION 'F1 valid billing transition failed'; END IF;

  v_denied := FALSE;
  BEGIN
    PERFORM public.update_billing_status_secure(v_billing.id, 'em_aberto', NULL);
  EXCEPTION WHEN OTHERS THEN
    v_denied := SQLERRM LIKE '%Transicao de faturamento invalida%';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'F1 invalid billing transition was accepted'; END IF;

  v_denied := FALSE;
  BEGIN
    INSERT INTO public.billings (company_id, patient_id, appointment_id, amount, status)
    VALUES ('11111111-aaaa-4111-8111-111111111111', 940003, 940005, 1, 'em_aberto');
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'F1 direct billing DML was accepted'; END IF;
END
$f1$;

RESET ROLE;
ROLLBACK;
SELECT 'F1_RUNTIME_BILLING_BEHAVIOR=PASS' AS result;
