-- F1 runtime tenant behavior gate.
-- Behavior-level RLS assertions on an ephemeral PostgreSQL database only.
-- Never run against DataSIGH or production.

BEGIN;

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
END
$f1$;

RESET ROLE;
ROLLBACK;

SELECT 'F1_RUNTIME_TENANT_BEHAVIOR=PASS' AS result;
