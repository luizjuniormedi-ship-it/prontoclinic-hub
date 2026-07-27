\set ON_ERROR_STOP on

DO $contract$
DECLARE
  v_definition TEXT;
BEGIN
  IF to_regprocedure(
    'public.get_reception_patient_appointments_secure(bigint,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Reception patient history RPC is missing';
  END IF;

  SELECT pg_get_functiondef(
    'public.get_reception_patient_appointments_secure(bigint,integer)'::REGPROCEDURE
  )
  INTO v_definition;

  IF position('scoped.company_id = v_company_id' IN v_definition) = 0
     OR position('private.reception_actor_can_access_unit' IN v_definition) = 0
     OR position('LIMIT v_limit' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Reception patient history scope/limit contract is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure_record
    JOIN pg_roles owner_role ON owner_role.oid = procedure_record.proowner
    WHERE procedure_record.oid =
      'public.get_reception_patient_appointments_secure(bigint,integer)'::REGPROCEDURE
      AND procedure_record.prosecdef
      AND owner_role.rolname = 'prontomedic_reception_rpc_owner'
      AND owner_role.rolcanlogin = FALSE
      AND owner_role.rolinherit = FALSE
      AND owner_role.rolsuper = FALSE
      AND owner_role.rolbypassrls = FALSE
  ) THEN
    RAISE EXCEPTION 'Reception patient history owner contract is invalid';
  END IF;

  IF NOT has_function_privilege(
       'authenticated',
       'public.get_reception_patient_appointments_secure(bigint,integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'app_prontomedic',
       'public.get_reception_patient_appointments_secure(bigint,integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.get_reception_patient_appointments_secure(bigint,integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Reception patient history ACL is invalid';
  END IF;
END
$contract$;

BEGIN;

INSERT INTO public.companies(id, name, lg_ativo)
VALUES
  ('33000000-0000-4000-8000-000000000001', 'Reception History A', TRUE),
  ('33000000-0000-4000-8000-000000000002', 'Reception History B', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.units(id, company_id, cd_codigo, ds_nome, lg_ativo)
VALUES
  (3301, '33000000-0000-4000-8000-000000000001', 'H-A', 'History A', TRUE),
  (3302, '33000000-0000-4000-8000-000000000002', 'H-B', 'History B', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users(
  id,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES (
  '33000000-0000-4000-8000-000000000101',
  'reception-history@example.invalid',
  '{"role":"authenticated"}'::JSONB,
  '{"synthetic":true}'::JSONB,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profiles(
  id,
  user_id,
  full_name,
  email,
  role_name,
  company_id,
  primary_unit_id,
  lg_ativo
)
VALUES (
  '33000000-0000-4000-8000-000000000101',
  '33000000-0000-4000-8000-000000000101',
  'Reception History User',
  'reception-history@example.invalid',
  'recepcao',
  '33000000-0000-4000-8000-000000000001',
  3301,
  TRUE
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.patients(id, company_id, unit_id, full_name, lg_ativo)
VALUES
  (33001, '33000000-0000-4000-8000-000000000001', 3301, 'History Patient A', TRUE),
  (33002, '33000000-0000-4000-8000-000000000002', 3302, 'History Patient B', TRUE);

INSERT INTO public.appointments(
  company_id,
  unit_id,
  patient_id,
  appointment_date,
  start_time,
  status
)
SELECT
  patient.company_id,
  CASE
    WHEN patient.company_id = '33000000-0000-4000-8000-000000000001'::UUID
      THEN 3301
    ELSE 3302
  END,
  patient.id,
  CURRENT_DATE,
  TIME '09:00',
  'scheduled'
FROM public.patients patient
WHERE patient.full_name IN ('History Patient A', 'History Patient B');

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '33000000-0000-4000-8000-000000000101',
  TRUE
);
SELECT set_config('request.jwt.claim.role', 'authenticated', TRUE);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"33000000-0000-4000-8000-000000000101","role":"authenticated"}',
  TRUE
);

DO $runtime$
DECLARE
  v_result JSONB;
BEGIN
  v_result := public.get_reception_patient_appointments_secure(33001, 20);
  IF jsonb_array_length(v_result) <> 1 THEN
    RAISE EXCEPTION 'Same-tenant history lookup failed';
  END IF;

  v_result := public.get_reception_patient_appointments_secure(33002, 20);
  IF jsonb_array_length(v_result) <> 0 THEN
    RAISE EXCEPTION 'Cross-tenant history leaked appointment data';
  END IF;
END
$runtime$;

ROLLBACK;

\echo RECEPTION_PATIENT_HISTORY_CONTRACT_OK
