-- F1 runtime tenant behavior gate.
-- Behavior-level RLS assertions on an ephemeral PostgreSQL database only.
-- Never run against DataSIGH or production.

BEGIN;

-- Fixture loading must not create audit rows; security assertions below run
-- after the trigger bypass is scoped to this disposable transaction.
SET LOCAL session_replication_role = replica;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $f1$
  SELECT NULLIF(current_setting('app.test_user_id', true), '')::uuid
$f1$;

INSERT INTO public.companies (id, name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Tenant A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Tenant B');

INSERT INTO auth.users (id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

INSERT INTO public.user_profiles (id, full_name, email, role_name, company_id)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'User A', 'a@test.local', 'admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('22222222-2222-4222-8222-222222222222', 'User B', 'b@test.local', 'admin', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

INSERT INTO public.patients (id, company_id, full_name)
OVERRIDING SYSTEM VALUE VALUES
  (910001, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Patient A'),
  (910002, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Patient B');

INSERT INTO public.professionals (id, company_id, full_name)
OVERRIDING SYSTEM VALUE VALUES
  (920001, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Professional A'),
  (920002, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Professional B');

INSERT INTO public.appointments
  (id, company_id, patient_id, professional_id, appointment_date, start_time, end_time)
OVERRIDING SYSTEM VALUE VALUES
  (930001, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 910001, 920001, DATE '2026-07-20', TIME '09:00', TIME '09:30'),
  (930002, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 910002, 920002, DATE '2026-07-20', TIME '10:00', TIME '10:30');

INSERT INTO public.billing_accounts
  (id, company_id, patient_id, billing_type, account_type, competence_month)
VALUES
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 910001, 'particular', 'ambulatorial', DATE '2026-07-01'),
  ('b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 910002, 'particular', 'ambulatorial', DATE '2026-07-01');

INSERT INTO public.nursing_medication_administrations
  (id, company_id, patient_id, medication, status)
VALUES
  (940001, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 910001, 'Medicamento A', 'em_preparo'),
  (940002, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 910002, 'Medicamento B', 'em_preparo');

INSERT INTO public.patient_allergies
  (company_id, patient_id, allergen, severity, status)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 910001, 'penicilina', 'grave', 'ativa');

INSERT INTO public.patient_medications
  (company_id, patient_id, medication, status)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 910001, 'Medicamento A', 'em_uso');

SET LOCAL ROLE authenticated;
SET LOCAL app.test_user_id = '11111111-1111-4111-8111-111111111111';

DO $f1$
DECLARE
  visible_patients integer;
  visible_appointments integer;
  inserted_id bigint;
  denied boolean := false;
BEGIN
  SELECT count(*) INTO visible_patients FROM public.patients;
  IF visible_patients <> 1 THEN
    RAISE EXCEPTION 'F1 RLS: tenant A sees % patients, expected 1', visible_patients;
  END IF;

  SELECT count(*) INTO visible_appointments FROM public.appointments;
  IF visible_appointments <> 1 THEN
    RAISE EXCEPTION 'F1 RLS: tenant A sees % appointments, expected 1', visible_appointments;
  END IF;

  INSERT INTO public.patients (company_id, full_name) VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Patient A New')
    RETURNING id INTO inserted_id;

  BEGIN
    INSERT INTO public.patients (company_id, full_name) VALUES
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Patient B Forbidden');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'F1 RLS: cross-tenant INSERT was not denied';
  END IF;

  denied := false;
  BEGIN
    UPDATE public.patients
       SET company_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     WHERE id = inserted_id;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'F1 RLS: cross-tenant UPDATE was not denied';
  END IF;

  denied := false;
  BEGIN
    INSERT INTO public.patient_allergies (company_id, patient_id, allergen)
    VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 910002, 'cross-tenant');
  EXCEPTION WHEN OTHERS THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'F1 integrity: clinical record accepted patient from another tenant';
  END IF;

  denied := false;
  BEGIN
    INSERT INTO public.billing_pending_issues (company_id, billing_account_id, issue_code, issue_label)
    VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b1000000-0000-4000-8000-000000000001', 'cross-tenant', 'Cross tenant');
  EXCEPTION WHEN OTHERS THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'F1 integrity: billing issue accepted account from another tenant';
  END IF;
END
$f1$;

DO $f1$
DECLARE
  checks integer;
  pending integer;
  alerts integer;
  denied boolean := false;
BEGIN
  SELECT count(*) INTO checks FROM public.bedside_check(940001, 910001) WHERE ok;
  IF checks <> 3 THEN
    RAISE EXCEPTION 'F1 clinical: bedside_check returned % successful checks, expected 3', checks;
  END IF;

  SELECT public.billing_check_pending('a1000000-0000-4000-8000-000000000001') INTO pending;
  IF pending <> 0 THEN
    RAISE EXCEPTION 'F1 billing: particular account returned % structural pending issues', pending;
  END IF;

  SELECT count(*) INTO alerts
    FROM public.check_prescription_safety(910001, 'penicilina');
  IF alerts <> 1 THEN
    RAISE EXCEPTION 'F1 clinical: prescription safety returned % alerts, expected 1', alerts;
  END IF;

  SET LOCAL app.test_user_id = '22222222-2222-4222-8222-222222222222';
  BEGIN
    PERFORM public.bedside_check(940001, 910001);
  EXCEPTION WHEN OTHERS THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'F1 clinical: cross-tenant bedside_check was accepted';
  END IF;

  denied := false;
  BEGIN
    PERFORM public.billing_check_pending('a1000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN OTHERS THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'F1 billing: cross-tenant billing_check_pending was accepted';
  END IF;

  denied := false;
  BEGIN
    PERFORM public.check_prescription_safety(910001, 'penicilina');
  EXCEPTION WHEN OTHERS THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'F1 clinical: cross-tenant prescription safety was accepted';
  END IF;
  SET LOCAL app.test_user_id = '11111111-1111-4111-8111-111111111111';
END
$f1$;
DO $f1$
DECLARE
  denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.create_call_center_contact_secure(
      910002, 930002, 'telefone', 'inbound', 'Cross tenant attempt',
      'recado', NULL, NULL, NULL, false
    );
  EXCEPTION
    WHEN OTHERS THEN
      denied := true;
  END;

  IF NOT denied THEN
    RAISE EXCEPTION 'F1 call center: cross-tenant contact was accepted';
  END IF;
END
$f1$;

DO $f1$
DECLARE
  denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.create_call_center_task_secure(
      910001, 930001, NULL,
      '22222222-2222-4222-8222-222222222222',
      'retornar_ligacao', 'Cross tenant assignment', NULL, 'normal'
    );
  EXCEPTION
    WHEN OTHERS THEN
      denied := true;
  END;

  IF NOT denied THEN
    RAISE EXCEPTION 'F1 call center: cross-tenant assigned_to was accepted';
  END IF;
END
$f1$;


RESET ROLE;
ROLLBACK;

SELECT 'F1_RUNTIME_TENANT_BEHAVIOR=PASS' AS result;
