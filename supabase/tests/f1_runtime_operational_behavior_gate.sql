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

CREATE OR REPLACE FUNCTION public.f1_assert_reception_checkin(p_id bigint, p_appointment_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $f1$
  SELECT EXISTS (
    SELECT 1
      FROM public.reception_checkins
     WHERE id = p_id
       AND appointment_id = p_appointment_id
       AND status = 'checked_in'
  )
$f1$;

REVOKE ALL ON FUNCTION public.f1_assert_reception_checkin(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.f1_assert_reception_checkin(bigint, bigint) TO authenticated;

INSERT INTO public.appointments
  (id, company_id, patient_id, professional_id, appointment_date, start_time, end_time, status)
OVERRIDING SYSTEM VALUE VALUES
  (930004, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 930003, 930002, DATE '2026-07-20', TIME '09:00', TIME '09:30', 'scheduled');


INSERT INTO auth.users (id) VALUES
  ('44444444-4444-4444-8444-444444444444');

INSERT INTO public.user_profiles (id, full_name, email, role_name, company_id)
VALUES
  ('44444444-4444-4444-8444-444444444444', 'Reception Operator', 'reception@test.local', 'recepcao',
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc');

INSERT INTO public.patients (id, company_id, full_name, birth_date)
OVERRIDING SYSTEM VALUE VALUES
  (930005, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Patient With Incomplete Record', NULL);

INSERT INTO public.appointments
  (id, company_id, patient_id, professional_id, appointment_date, start_time, end_time, status)
OVERRIDING SYSTEM VALUE VALUES
  (930006, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 930005, 930002, DATE '2026-07-20', TIME '10:00', TIME '10:30', 'scheduled');


INSERT INTO public.insurance_authorizations
  (id, company_id, patient_id, appointment_id, status, quantity_requested)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   930003, 930004, 'pendente', 1),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   930003, 930004, 'pendente', 1);

INSERT INTO public.insurance_eligibility_checks
  (id, company_id, patient_id, appointment_id, status)
VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   930003, 930004, 'pendente');

SET LOCAL ROLE authenticated;
SET LOCAL app.test_user_id = '33333333-3333-4333-8333-333333333333';

DO $f1$
DECLARE
  available_count integer;
  readiness jsonb;
  checkin jsonb;
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

  SELECT public.perform_reception_checkin_secure(930004) INTO checkin;
  IF COALESCE(checkin->>'ticket', '') !~ '^C[0-9]{3}$'
     OR (checkin->>'released_by_exception')::boolean IS TRUE THEN
    RAISE EXCEPTION 'F1 reception check-in contract mismatch: %', checkin;
  END IF;

  IF NOT public.f1_assert_reception_checkin((checkin->>'checkin_id')::bigint, 930004) THEN
    RAISE EXCEPTION 'F1 reception check-in row missing: %', checkin;
  END IF;

  SELECT set_config('app.test_user_id', '44444444-4444-4444-8444-444444444444', true);
  BEGIN
    SELECT public.perform_reception_checkin_secure(930006, 'normal', 'Liberacao indevida') INTO checkin;
    RAISE EXCEPTION 'F1 unauthorized exception release was accepted: %', checkin;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Perfil sem permissao para liberar excecao%' THEN
        RAISE EXCEPTION 'F1 unauthorized exception returned unexpected error: %', SQLERRM;
      END IF;
  END;
END
$f1$;


DO $f1$
DECLARE
  v_auth public.reception_authorizations;
  v_elig public.reception_eligibility_checks;
BEGIN
  SELECT public.update_reception_authorization_secure(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001', 'autorizada',
    'PROTO-001', 'AUTH-001', 'PASS-001', DATE '2026-12-31', 1, NULL
  ) INTO v_auth;

  IF v_auth.status <> 'autorizada'
     OR v_auth.protocol_number <> 'PROTO-001'
     OR v_auth.authorization_number <> 'AUTH-001'
     OR v_auth.password_number <> 'PASS-001'
     OR v_auth.quantity_authorized <> 1 THEN
    RAISE EXCEPTION 'F1 authorization update contract mismatch: %', row_to_json(v_auth);
  END IF;

  SELECT public.update_reception_eligibility_secure(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001', 'elegivel',
    'ELIG-001', 'Cobertura confirmada'
  ) INTO v_elig;

  IF v_elig.status <> 'elegivel'
     OR v_elig.protocol_number <> 'ELIG-001'
     OR v_elig.result_detail <> 'Cobertura confirmada' THEN
    RAISE EXCEPTION 'F1 eligibility update contract mismatch: %', row_to_json(v_elig);
  END IF;

END
$f1$;

PERFORM set_config('app.test_user_id', '44444444-4444-4444-8444-444444444444', true);
DO $f1$
DECLARE
  v_auth public.reception_authorizations;
BEGIN
  BEGIN
    SELECT public.update_reception_authorization_secure(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002', 'liberada_excecao',
      NULL, NULL, NULL, NULL, NULL, 'Liberacao indevida'
    ) INTO v_auth;
    RAISE EXCEPTION 'F1 unauthorized authorization exception was accepted: %', row_to_json(v_auth);
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%Perfil sem permissao para liberar excecao%' THEN
        RAISE EXCEPTION 'F1 unauthorized authorization returned unexpected error: %', SQLERRM;
      END IF;
  END;
END
$f1$;


RESET ROLE;

DO $f1$
DECLARE
  v_history_count integer;
BEGIN
  SELECT count(*) INTO v_history_count
    FROM public.reception_admin_history
   WHERE company_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
     AND entity_id IN (
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001',
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001'
     );
  IF v_history_count <> 2 THEN
    RAISE EXCEPTION 'F1 reception admin history expected 2 rows, got %', v_history_count;
  END IF;
END
$f1$;

ROLLBACK;

SELECT 'F1_RUNTIME_OPERATIONAL_BEHAVIOR=PASS' AS result;
