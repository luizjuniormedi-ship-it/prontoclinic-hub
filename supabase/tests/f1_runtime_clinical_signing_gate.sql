-- F1 clinical signing and atomic finalization gate.
-- Ephemeral PostgreSQL only. Never execute against DataSIGH or production.

BEGIN;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $gate$
  SELECT NULLIF(current_setting('app.test_user_id', true), '')::uuid
$gate$;

INSERT INTO public.companies (id, name) VALUES
  ('ca000000-0000-4000-8000-000000000001', 'Clinical Tenant A'),
  ('cb000000-0000-4000-8000-000000000002', 'Clinical Tenant B');

INSERT INTO auth.users (id) VALUES
  ('da000000-0000-4000-8000-000000000001'),
  ('da000000-0000-4000-8000-000000000004'),
  ('db000000-0000-4000-8000-000000000002'),
  ('aa000000-0000-4000-8000-000000000001'),
  ('ab000000-0000-4000-8000-000000000002'),
  ('ac000000-0000-4000-8000-000000000003'),
  ('ae000000-0000-4000-8000-000000000004'),
  ('dc000000-0000-4000-8000-000000000003');

INSERT INTO public.user_profiles
  (id, full_name, email, role_name, company_id, lg_ativo)
VALUES
  ('da000000-0000-4000-8000-000000000001', 'Doctor A', 'doctor-a@test.local', 'medico', 'ca000000-0000-4000-8000-000000000001', TRUE),
  ('da000000-0000-4000-8000-000000000004', 'Doctor A2', 'doctor-a2@test.local', 'medico', 'ca000000-0000-4000-8000-000000000001', TRUE),
  ('db000000-0000-4000-8000-000000000002', 'Doctor B', 'doctor-b@test.local', 'medico', 'cb000000-0000-4000-8000-000000000002', TRUE),
  ('aa000000-0000-4000-8000-000000000001', 'Admin A', 'admin-a@test.local', 'admin', 'ca000000-0000-4000-8000-000000000001', TRUE),
  ('ab000000-0000-4000-8000-000000000002', 'Admin B', 'admin-b@test.local', 'admin', 'cb000000-0000-4000-8000-000000000002', TRUE),
  ('ac000000-0000-4000-8000-000000000003', 'Manager A', 'manager-a@test.local', 'gestor', 'ca000000-0000-4000-8000-000000000001', TRUE),
  ('ae000000-0000-4000-8000-000000000004', 'Nurse A', 'nurse-a@test.local', 'enfermagem', 'ca000000-0000-4000-8000-000000000001', TRUE),
  ('dc000000-0000-4000-8000-000000000003', 'Doctor Without Company', 'doctor-no-company@test.local', 'medico', NULL, TRUE);

INSERT INTO public.professionals (id, company_id, user_id, full_name, lg_ativo)
OVERRIDING SYSTEM VALUE VALUES
  (940001, 'ca000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000001', 'Doctor A', TRUE),
  (940002, 'cb000000-0000-4000-8000-000000000002', 'db000000-0000-4000-8000-000000000002', 'Doctor B', TRUE),
  (940003, 'ca000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000004', 'Doctor A2', TRUE),
  (940004, 'ca000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 'Admin A Professional', TRUE),
  (940005, 'ca000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000003', 'Manager A Professional', TRUE),
  (940006, 'ca000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000004', 'Nurse A Professional', TRUE);

INSERT INTO public.patients (id, company_id, full_name)
OVERRIDING SYSTEM VALUE VALUES
  (940011, 'ca000000-0000-4000-8000-000000000001', 'Patient A'),
  (940012, 'cb000000-0000-4000-8000-000000000002', 'Patient B');

INSERT INTO public.appointments
  (id, company_id, patient_id, professional_id, appointment_date, start_time, end_time, status)
OVERRIDING SYSTEM VALUE VALUES
  (940021, 'ca000000-0000-4000-8000-000000000001', 940011, 940001, DATE '2026-07-21', TIME '09:00', TIME '09:30', 'in_progress'),
  (940022, 'cb000000-0000-4000-8000-000000000002', 940012, 940002, DATE '2026-07-21', TIME '10:00', TIME '10:30', 'in_progress'),
  (940023, 'ca000000-0000-4000-8000-000000000001', 940011, 940001, DATE '2026-07-21', TIME '11:00', TIME '11:30', NULL),
  (940024, 'ca000000-0000-4000-8000-000000000001', 940011, 940003, DATE '2026-07-21', TIME '12:00', TIME '12:30', 'in_progress'),
  (940025, 'ca000000-0000-4000-8000-000000000001', 940011, 940004, DATE '2026-07-21', TIME '13:00', TIME '13:30', 'in_progress'),
  (940026, 'ca000000-0000-4000-8000-000000000001', 940011, 940005, DATE '2026-07-21', TIME '14:00', TIME '14:30', 'in_progress'),
  (940027, 'ca000000-0000-4000-8000-000000000001', 940011, 940006, DATE '2026-07-21', TIME '15:00', TIME '15:30', 'in_progress'),
  (940028, 'ca000000-0000-4000-8000-000000000001', 940011, 940001, DATE '2026-07-21', TIME '16:00', TIME '16:30', 'in_progress');

INSERT INTO public.medical_records (
  company_id, patient_id, professional_id, appointment_id, record_date,
  anamnesis, status
) VALUES
  ('ca000000-0000-4000-8000-000000000001', 940011, 940001, 940028, DATE '2026-07-21', 'Draft assigned to Doctor A', 'draft'),
  ('ca000000-0000-4000-8000-000000000001', 940011, 940003, 940024, DATE '2026-07-21', 'Draft assigned to Doctor A2', 'draft'),
  ('ca000000-0000-4000-8000-000000000001', 940011, 940004, 940025, DATE '2026-07-21', 'Draft assigned to admin professional', 'draft'),
  ('ca000000-0000-4000-8000-000000000001', 940011, 940005, 940026, DATE '2026-07-21', 'Draft assigned to manager professional', 'draft'),
  ('ca000000-0000-4000-8000-000000000001', 940011, 940006, 940027, DATE '2026-07-21', 'Draft assigned to nurse professional', 'draft');

SET LOCAL ROLE authenticated;
SET LOCAL app.test_user_id = 'da000000-0000-4000-8000-000000000001';

DO $gate$
DECLARE
  v_first public.medical_records;
  v_retry public.medical_records;
  v_signed public.medical_records;
BEGIN
  SELECT * INTO v_signed FROM public.sign_medical_record_secure(
    (SELECT id FROM public.medical_records WHERE appointment_id = 940028)
  );
  IF v_signed.status <> 'signed'
     OR v_signed.professional_id <> 940001
     OR v_signed.signed_by <> 'da000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'Assigned doctor signature contract mismatch: %', row_to_json(v_signed);
  END IF;

  SELECT * INTO v_first FROM public.finalize_medical_attendance_secure(
    940021, DATE '2026-07-21', 'Anamnese A', 'Evolucao A',
    'Diagnostico A', 'Prescricao A', '{"pa":"120/80"}'::jsonb, 'Nota A'
  );

  IF v_first.company_id <> 'ca000000-0000-4000-8000-000000000001'
     OR v_first.patient_id <> 940011
     OR v_first.professional_id <> 940001
     OR v_first.status <> 'signed'
     OR v_first.signed_by <> 'da000000-0000-4000-8000-000000000001'::uuid
     OR length(v_first.content_hash) <> 64 THEN
    RAISE EXCEPTION 'Clinical signature contract mismatch: %', row_to_json(v_first);
  END IF;

  SELECT * INTO v_retry FROM public.finalize_medical_attendance_secure(
    940021, DATE '2026-07-21', 'Anamnese A', 'Evolucao A',
    'Diagnostico A', 'Prescricao A', '{"pa":"120/80"}'::jsonb, 'Nota A'
  );
  IF v_retry.id <> v_first.id OR v_retry.signed_at <> v_first.signed_at THEN
    RAISE EXCEPTION 'Idempotent retry changed signed record';
  END IF;

  BEGIN
    PERFORM public.finalize_medical_attendance_secure(
      940021, DATE '2026-07-21', 'Anamnese alterada', 'Evolucao A',
      'Diagnostico A', 'Prescricao A', '{"pa":"120/80"}'::jsonb, 'Nota A'
    );
    RAISE EXCEPTION 'Divergent retry was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Finalizacao repetida diverge%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.finalize_medical_attendance_secure(
      940023, DATE '2026-07-21', 'Status nulo', NULL, NULL, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'Appointment with NULL status was finalized';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%deve estar em andamento%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.finalize_medical_attendance_secure(
      940022, DATE '2026-07-21', 'Cross tenant', NULL, NULL, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'Cross-tenant finalization was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%fora da empresa%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.finalize_medical_attendance_secure(
      940024, DATE '2026-07-21', 'Not assigned', NULL, NULL, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'Active doctor not assigned to appointment finalized it';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%nao esta clinicamente vinculado e atribuido%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.sign_medical_record_secure(
      (SELECT id FROM public.medical_records WHERE appointment_id = 940024)
    );
    RAISE EXCEPTION 'Active doctor not assigned to appointment signed its record';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%nao esta clinicamente vinculado e atribuido%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.update_medical_record_secure(v_first.id, '{"evolution":"alterada"}'::jsonb);
    RAISE EXCEPTION 'Signed record update was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%assinado e imutavel%' THEN RAISE; END IF;
  END;
END
$gate$;

SET LOCAL app.test_user_id = 'aa000000-0000-4000-8000-000000000001';
DO $gate$
BEGIN
  BEGIN
    PERFORM public.finalize_medical_attendance_secure(
      940025, DATE '2026-07-21', 'Admin denied', NULL, NULL, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'Admin with active professional finalized attendance';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Somente perfil medico%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.sign_medical_record_secure(
      (SELECT id FROM public.medical_records WHERE appointment_id = 940025)
    );
    RAISE EXCEPTION 'Admin with active professional signed record';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Somente perfil medico%' THEN RAISE; END IF;
  END;
END
$gate$;

SET LOCAL app.test_user_id = 'ac000000-0000-4000-8000-000000000003';
DO $gate$
BEGIN
  BEGIN
    PERFORM public.finalize_medical_attendance_secure(
      940026, DATE '2026-07-21', 'Manager denied', NULL, NULL, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'Manager with active professional finalized attendance';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Somente perfil medico%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.sign_medical_record_secure(
      (SELECT id FROM public.medical_records WHERE appointment_id = 940026)
    );
    RAISE EXCEPTION 'Manager with active professional signed record';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Somente perfil medico%' THEN RAISE; END IF;
  END;
END
$gate$;

SET LOCAL app.test_user_id = 'ae000000-0000-4000-8000-000000000004';
DO $gate$
BEGIN
  BEGIN
    PERFORM public.finalize_medical_attendance_secure(
      940027, DATE '2026-07-21', 'Nursing denied', NULL, NULL, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'Nursing user with active professional finalized attendance';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Somente perfil medico%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.sign_medical_record_secure(
      (SELECT id FROM public.medical_records WHERE appointment_id = 940027)
    );
    RAISE EXCEPTION 'Nursing user with active professional signed record';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Somente perfil medico%' THEN RAISE; END IF;
  END;
END
$gate$;

SET LOCAL app.test_user_id = 'dc000000-0000-4000-8000-000000000003';
DO $gate$
BEGIN
  BEGIN
    PERFORM public.finalize_medical_attendance_secure(
      940021, CURRENT_DATE, 'No company', NULL, NULL, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'Actor without company was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%sem empresa operacional ativa%' THEN RAISE; END IF;
  END;
END
$gate$;

SET LOCAL app.test_user_id = 'aa000000-0000-4000-8000-000000000001';
DO $gate$
DECLARE v_count INTEGER;
BEGIN
  SELECT COALESCE(sum(total), 0)::INTEGER INTO v_count
    FROM public.audit_logs_stats
   WHERE company_id = 'ca000000-0000-4000-8000-000000000001'
     AND tabela IN ('medical_records', 'appointments');
  IF v_count < 2 THEN RAISE EXCEPTION 'Tenant A audit events missing: %', v_count; END IF;
END
$gate$;

SET LOCAL app.test_user_id = 'da000000-0000-4000-8000-000000000001';
DO $gate$
DECLARE
  v_count INTEGER;
  v_record public.medical_records;
BEGIN
  SELECT * INTO v_record
    FROM public.medical_records
   WHERE appointment_id = 940021;
  IF v_record.id IS NULL
     OR v_record.company_id <> 'ca000000-0000-4000-8000-000000000001'
     OR v_record.status <> 'signed' THEN
    RAISE EXCEPTION 'Doctor cannot read own tenant signed medical record';
  END IF;

  SELECT count(*) INTO v_count FROM public.audit_logs_stats;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Doctor can read audit statistics'; END IF;
END
$gate$;

SET LOCAL app.test_user_id = 'ab000000-0000-4000-8000-000000000002';
DO $gate$
DECLARE v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM public.audit_logs_stats
   WHERE company_id = 'ca000000-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Tenant B saw Tenant A audit rows'; END IF;

  SELECT count(*) INTO v_count FROM public.medical_records
   WHERE company_id = 'ca000000-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Tenant B saw Tenant A medical records'; END IF;
END
$gate$;

RESET ROLE;

DO $gate$
DECLARE
  v_record_id BIGINT;
  v_security_invoker BOOLEAN;
  v_rls BOOLEAN;
  v_force_rls BOOLEAN;
BEGIN
  SELECT id INTO v_record_id FROM public.medical_records WHERE appointment_id = 940021;
  BEGIN
    UPDATE public.medical_records SET notes = 'direct mutation' WHERE id = v_record_id;
    RAISE EXCEPTION 'Owner direct update of signed record was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%assinado e imutavel%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.medical_records WHERE id = v_record_id;
    RAISE EXCEPTION 'Owner direct delete of signed record was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%assinado e imutavel%' THEN RAISE; END IF;
  END;

  SELECT COALESCE((c.reloptions @> ARRAY['security_invoker=true']), FALSE)
    INTO v_security_invoker
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'audit_logs_stats';
  IF v_security_invoker IS NOT TRUE THEN
    RAISE EXCEPTION 'audit_logs_stats is not security_invoker';
  END IF;

  SELECT c.relrowsecurity, c.relforcerowsecurity
    INTO v_rls, v_force_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'medical_records';
  IF v_rls IS NOT TRUE OR v_force_rls IS NOT TRUE THEN
    RAISE EXCEPTION 'medical_records RLS is not enabled and forced';
  END IF;

  IF (SELECT count(*) FROM public.medical_records WHERE appointment_id = 940021) <> 1 THEN
    RAISE EXCEPTION 'Appointment has duplicate medical records';
  END IF;
  IF (SELECT status FROM public.appointments WHERE id = 940021) <> 'completed' THEN
    RAISE EXCEPTION 'Appointment was not completed atomically';
  END IF;
  IF (SELECT count(*) FROM public.scheduling_status_history
       WHERE appointment_id = 940021 AND to_status = 'completed') <> 1 THEN
    RAISE EXCEPTION 'Atomic status history row missing or duplicated';
  END IF;
  IF (SELECT count(*) FROM public.clinical_billing_outbox
       WHERE company_id = 'ca000000-0000-4000-8000-000000000001'
         AND appointment_id = 940021
         AND status = 'pending') <> 1 THEN
    RAISE EXCEPTION 'Billing outbox row missing or duplicated';
  END IF;
END
$gate$;

INSERT INTO public.medical_records (
  company_id, patient_id, professional_id, record_date,
  status, content_hash
) VALUES (
  'ca000000-0000-4000-8000-000000000001', 940011, 940001, DATE '2026-07-20',
  'legacy_locked', repeat('0', 64)
);

DO $gate$
DECLARE v_legacy_id BIGINT;
BEGIN
  SELECT id INTO v_legacy_id FROM public.medical_records
   WHERE company_id = 'ca000000-0000-4000-8000-000000000001'
     AND status = 'legacy_locked' LIMIT 1;
  BEGIN
    UPDATE public.medical_records SET notes = 'mutacao indevida' WHERE id = v_legacy_id;
    RAISE EXCEPTION 'Legacy clinical record mutation was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%registros legados%' THEN RAISE; END IF;
  END;
END
$gate$;

SELECT set_config(
  'app.test_record_id',
  (SELECT id::TEXT FROM public.medical_records WHERE appointment_id = 940021),
  TRUE
);

SET LOCAL ROLE service_role;
DO $gate$
BEGIN
  BEGIN
    INSERT INTO public.clinical_billing_outbox (
      company_id, appointment_id, medical_record_id
    ) VALUES (
      'ca000000-0000-4000-8000-000000000001', 940022,
      current_setting('app.test_record_id')::BIGINT
    );
    RAISE EXCEPTION 'Cross-tenant billing outbox link was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%vinculo incoerente%' THEN RAISE; END IF;
  END;
END
$gate$;
RESET ROLE;

ROLLBACK;

SELECT 'F1_RUNTIME_CLINICAL_SIGNING_GATE=PASS' AS result;

