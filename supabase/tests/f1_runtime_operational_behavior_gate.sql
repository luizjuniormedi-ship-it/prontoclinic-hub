-- F1 operational behavior gate.
-- Ephemeral PostgreSQL only. No DataSIGH or production writes.

BEGIN;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $f1$
  SELECT NULLIF(current_setting('app.test_user_id', true), '')::uuid
$f1$;

INSERT INTO public.companies (id, name) VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Operational Tenant');

INSERT INTO auth.users (id) VALUES
  ('33333333-3333-4333-8333-333333333333');

INSERT INTO public.user_profiles (id, full_name, email, role_name, company_id)
VALUES
  ('33333333-3333-4333-8333-333333333333', 'Operator', 'operator@test.local', 'admin',
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc');

INSERT INTO public.units (id, company_id, cd_codigo, ds_nome)
OVERRIDING SYSTEM VALUE VALUES
  (930001, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'U1', 'Unit 1');

INSERT INTO public.professionals (id, company_id, full_name)
OVERRIDING SYSTEM VALUE VALUES
  (930002, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Professional 1');

INSERT INTO public.patients (id, company_id, full_name, birth_date)
OVERRIDING SYSTEM VALUE VALUES
  (930003, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Patient 1', DATE '1980-01-01');

INSERT INTO public.professional_schedules
  (company_id, professional_id, day_of_week, slot1_start, slot1_end, slot1_duration, slot1_unit_id)
VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 930002, 'segunda-feira', 900, 1000, 30, 930001);

INSERT INTO public.appointments
  (id, company_id, patient_id, professional_id, appointment_date, start_time, end_time, status)
OVERRIDING SYSTEM VALUE VALUES
  (930004, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 930003, 930002, DATE '2026-07-20', TIME '09:00', TIME '09:30', 'scheduled');

SET LOCAL ROLE authenticated;
SET LOCAL app.test_user_id = '33333333-3333-4333-8333-333333333333';

DO $f1$
DECLARE
  available_count integer;
  readiness jsonb;
BEGIN
  SELECT count(*) INTO available_count
    FROM public.get_professional_available_slots(930002, DATE '2026-07-20', 30, 930001);
  IF available_count <> 1 THEN
    RAISE EXCEPTION 'F1 scheduling availability expected 1 free slot, got %', available_count;
  END IF;

  SELECT public.get_reception_checkin_readiness(930004) INTO readiness;
  IF COALESCE((readiness->>'ready')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'F1 reception readiness unexpectedly blocked: %', readiness;
  END IF;
END
$f1$;

RESET ROLE;
ROLLBACK;

SELECT 'F1_RUNTIME_OPERATIONAL_BEHAVIOR=PASS' AS result;
