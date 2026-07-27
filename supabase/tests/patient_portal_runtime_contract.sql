\set ON_ERROR_STOP on

DO $disposable_guard$
BEGIN
  IF current_database() !~* '(test|e2e|replay)' THEN
    RAISE EXCEPTION
      'PATIENT_PORTAL_CONTRACT: disposable test database required, got %',
      current_database();
  END IF;
END
$disposable_guard$;

DO $structure$
DECLARE
  v_function REGPROCEDURE;
  v_definition TEXT;
  v_result TEXT;
  v_count INTEGER;
  v_table TEXT;
BEGIN
  SELECT count(*)
    INTO v_count
    FROM pg_proc procedure_record
    JOIN pg_namespace namespace_record
      ON namespace_record.oid = procedure_record.pronamespace
   WHERE namespace_record.nspname = 'public'
     AND procedure_record.proname LIKE 'patient_portal_%_secure';

  IF v_count <> 4 THEN
    RAISE EXCEPTION
      'Expected exactly four public patient portal RPCs, found %',
      v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles role_record
    WHERE role_record.rolname = 'prontomedic_patient_portal_rpc_owner'
      AND role_record.rolcanlogin IS FALSE
      AND role_record.rolinherit IS FALSE
      AND role_record.rolbypassrls IS FALSE
      AND role_record.rolsuper IS FALSE
      AND role_record.rolcreatedb IS FALSE
      AND role_record.rolcreaterole IS FALSE
  ) THEN
    RAISE EXCEPTION 'Patient portal owner role is absent or unsafe';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_auth_members membership
    WHERE membership.member =
      to_regrole('prontomedic_patient_portal_rpc_owner')::OID
  ) THEN
    RAISE EXCEPTION 'Patient portal owner inherits another database role';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_record
    WHERE column_record.table_schema = 'public'
      AND column_record.table_name = 'patients'
      AND column_record.column_name = 'user_id'
      AND column_record.data_type = 'uuid'
      AND column_record.is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'patients.user_id UUID nullable contract is absent';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class relation_record
    JOIN pg_namespace namespace_record
      ON namespace_record.oid = relation_record.relnamespace
    WHERE namespace_record.nspname = 'public'
      AND relation_record.relname IN (
        'patients',
        'appointments',
        'professionals',
        'units',
        'professional_schedules',
        'scheduling_reschedules',
        'scheduling_status_history'
      )
      AND relation_record.relowner =
        to_regrole('prontomedic_patient_portal_rpc_owner')::OID
  ) THEN
    RAISE EXCEPTION 'Patient portal owner owns a clinical table';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'patients',
    'appointments',
    'professionals',
    'units',
    'professional_schedules',
    'scheduling_reschedules',
    'scheduling_status_history'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class relation_record
      JOIN pg_namespace namespace_record
        ON namespace_record.oid = relation_record.relnamespace
      WHERE namespace_record.nspname = 'public'
        AND relation_record.relname = v_table
        AND relation_record.relrowsecurity IS TRUE
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%', v_table;
    END IF;
  END LOOP;

  IF to_regclass('private.patient_portal_mutation_context') IS NULL THEN
    RAISE EXCEPTION 'Private mutation context table is missing';
  END IF;

  IF has_table_privilege(
       'anon',
       'private.patient_portal_mutation_context',
       'SELECT'
     )
     OR has_table_privilege(
       'authenticated',
       'private.patient_portal_mutation_context',
       'SELECT'
     )
     OR has_table_privilege(
       'app_prontomedic',
       'private.patient_portal_mutation_context',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'Private mutation context is exposed to a client role';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    'public.patient_portal_list_appointments_secure()'::REGPROCEDURE,
    'public.patient_portal_confirm_appointment_secure(bigint)'::REGPROCEDURE,
    'public.patient_portal_cancel_appointment_secure(bigint,text)'::REGPROCEDURE,
    'public.patient_portal_reschedule_appointment_secure(bigint,date,time without time zone,time without time zone,text)'::REGPROCEDURE
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc procedure_record
      JOIN pg_roles owner_role
        ON owner_role.oid = procedure_record.proowner
      WHERE procedure_record.oid = v_function
        AND procedure_record.prosecdef
        AND owner_role.rolname =
          'prontomedic_patient_portal_rpc_owner'
    ) THEN
      RAISE EXCEPTION
        'Patient portal RPC % has an unsafe owner contract',
        v_function;
    END IF;

    IF has_function_privilege('anon', v_function, 'EXECUTE')
       OR NOT has_function_privilege(
         'authenticated',
         v_function,
         'EXECUTE'
       )
       OR NOT has_function_privilege(
         'app_prontomedic',
         v_function,
         'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Patient portal RPC % has an invalid ACL', v_function;
    END IF;

    SELECT pg_get_functiondef(v_function)
      INTO v_definition;

    IF v_definition ~* (
      'professional_schedule_grids'
      '|org_can_access_unit'
      '|organizational_resources'
      '|preparation_instructions'
      '|confirmed_at'
      '|room_id'
      '|equipment_id'
    ) THEN
      RAISE EXCEPTION
        'Patient portal RPC % references a forbidden baseline object',
        v_function;
    END IF;

    IF v_definition ~* (
      'set_config\s*\(\s*''request\.jwt'
      '|current_setting\s*\(\s*''request\.jwt'
    ) THEN
      RAISE EXCEPTION
        'Patient portal RPC % mutates or reads raw JWT settings',
        v_function;
    END IF;
  END LOOP;

  SELECT pg_get_function_result(
    'public.patient_portal_list_appointments_secure()'::REGPROCEDURE
  )
  INTO v_result;

  IF v_result !~* '^TABLE\(id bigint, appointment_date date, start_time time without time zone, end_time time without time zone, status text, is_return boolean, professional_name text, unit_name text\)$'
     OR v_result ~* (
       'notes'
       '|company_id'
       '|patient_id'
       '|created_at'
       '|updated_at'
     ) THEN
    RAISE EXCEPTION 'Patient list DTO is not minimal: %', v_result;
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    'public.patient_portal_confirm_appointment_secure(bigint)'::REGPROCEDURE,
    'public.patient_portal_cancel_appointment_secure(bigint,text)'::REGPROCEDURE,
    'public.patient_portal_reschedule_appointment_secure(bigint,date,time without time zone,time without time zone,text)'::REGPROCEDURE
  ] LOOP
    IF pg_get_function_result(v_function) <> 'jsonb' THEN
      RAISE EXCEPTION 'Mutation RPC % does not return a stable JSON DTO', v_function;
    END IF;
  END LOOP;

  FOREACH v_function IN ARRAY ARRAY[
    'private.resolve_authenticated_patient_context()'::REGPROCEDURE,
    'private.apply_patient_portal_appointment_mutation(uuid,uuid,bigint,bigint,text,date,time without time zone,time without time zone,integer)'::REGPROCEDURE
  ] LOOP
    IF has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR has_function_privilege('app_prontomedic', v_function, 'EXECUTE')
       OR has_function_privilege('anon', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'Private helper % is exposed', v_function;
    END IF;
  END LOOP;

  SELECT pg_get_functiondef(
    'public.can_access(text,text)'::REGPROCEDURE
  )
  INTO v_definition;
  IF position('patient_portal_mutation_context' IN v_definition) = 0
     OR position('txid_current' IN v_definition) = 0
     OR position('pg_backend_pid' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'can_access lacks verifiable portal mutation context';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies policy_record
    WHERE policy_record.schemaname = 'public'
      AND policy_record.tablename = 'appointments'
      AND policy_record.policyname =
        'patient_portal_owner_appointment_update'
      AND policy_record.roles @> ARRAY[
        'prontomedic_patient_portal_rpc_owner'
      ]::name[]
  ) THEN
    RAISE EXCEPTION 'Scoped appointment update policy is missing';
  END IF;
END
$structure$;

BEGIN;

SELECT set_config('request.jwt.claim.sub', '', TRUE);
SELECT set_config('request.jwt.claims', '{}', TRUE);

INSERT INTO public.companies(id, name, lg_ativo)
VALUES
  (
    '34000000-0000-4000-8000-000000000001',
    'Patient Portal Contract A',
    TRUE
  ),
  (
    '34000000-0000-4000-8000-000000000002',
    'Patient Portal Contract B',
    TRUE
  )
ON CONFLICT (id) DO UPDATE SET lg_ativo = TRUE;

INSERT INTO public.units(
  id,
  company_id,
  cd_codigo,
  ds_nome,
  lg_ativo
)
VALUES
  (
    3401,
    '34000000-0000-4000-8000-000000000001',
    'PORTAL-A',
    'Portal Unit A',
    TRUE
  ),
  (
    3402,
    '34000000-0000-4000-8000-000000000002',
    'PORTAL-B',
    'Portal Unit B',
    TRUE
  )
ON CONFLICT (id) DO UPDATE SET lg_ativo = TRUE;

INSERT INTO auth.users(
  id,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  (
    '34000000-0000-4000-8000-000000000101',
    'patient-portal-a@example.invalid',
    '{"role":"authenticated"}'::JSONB,
    '{"synthetic":true}'::JSONB,
    NOW(),
    NOW()
  ),
  (
    '34000000-0000-4000-8000-000000000102',
    'patient-portal-b@example.invalid',
    '{"role":"authenticated"}'::JSONB,
    '{"synthetic":true}'::JSONB,
    NOW(),
    NOW()
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.roles(name, description, lg_ativo)
VALUES ('patient', 'Synthetic patient portal role', TRUE)
ON CONFLICT (name) DO UPDATE SET lg_ativo = TRUE;

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
VALUES
  (
    '34000000-0000-4000-8000-000000000101',
    '34000000-0000-4000-8000-000000000101',
    'Patient Portal Contract A',
    'patient-portal-a@example.invalid',
    'patient',
    '34000000-0000-4000-8000-000000000001',
    3401,
    TRUE
  ),
  (
    '34000000-0000-4000-8000-000000000102',
    '34000000-0000-4000-8000-000000000102',
    'Patient Portal Contract B',
    'patient-portal-b@example.invalid',
    'patient',
    '34000000-0000-4000-8000-000000000002',
    3402,
    TRUE
  )
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  role_name = EXCLUDED.role_name,
  company_id = EXCLUDED.company_id,
  primary_unit_id = EXCLUDED.primary_unit_id,
  lg_ativo = TRUE;

INSERT INTO public.memberships(id, user_id, company_id, status)
VALUES
  (
    '34000000-0000-4000-8000-000000000301',
    '34000000-0000-4000-8000-000000000101',
    '34000000-0000-4000-8000-000000000001',
    'active'
  ),
  (
    '34000000-0000-4000-8000-000000000302',
    '34000000-0000-4000-8000-000000000102',
    '34000000-0000-4000-8000-000000000002',
    'active'
  )
ON CONFLICT (user_id, company_id) DO UPDATE SET status = 'active';

INSERT INTO public.membership_roles(membership_id, role_id)
SELECT fixture.membership_id, role_record.id
FROM (
  VALUES
    ('34000000-0000-4000-8000-000000000301'::UUID),
    ('34000000-0000-4000-8000-000000000302'::UUID)
) fixture(membership_id)
CROSS JOIN public.roles role_record
WHERE role_record.name = 'patient'
ON CONFLICT DO NOTHING;

INSERT INTO public.membership_units(membership_id, unit_id)
VALUES
  ('34000000-0000-4000-8000-000000000301', 3401),
  ('34000000-0000-4000-8000-000000000302', 3402)
ON CONFLICT DO NOTHING;

INSERT INTO public.application_devices(
  id,
  user_id,
  company_id,
  unit_id,
  client_device_id,
  display_name,
  platform
)
VALUES
  (
    '34000000-0000-4000-8000-000000000401',
    '34000000-0000-4000-8000-000000000101',
    '34000000-0000-4000-8000-000000000001',
    3401,
    '34000000-0000-4000-8000-000000000411',
    'Patient Portal Contract Device A',
    'contract'
  ),
  (
    '34000000-0000-4000-8000-000000000402',
    '34000000-0000-4000-8000-000000000102',
    '34000000-0000-4000-8000-000000000002',
    3402,
    '34000000-0000-4000-8000-000000000412',
    'Patient Portal Contract Device B',
    'contract'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.application_sessions(
  id,
  user_id,
  company_id,
  unit_id,
  device_id,
  gotrue_session_id,
  idle_expires_at,
  absolute_expires_at
)
VALUES
  (
    '34000000-0000-4000-8000-000000000501',
    '34000000-0000-4000-8000-000000000101',
    '34000000-0000-4000-8000-000000000001',
    3401,
    '34000000-0000-4000-8000-000000000401',
    '34000000-0000-4000-8000-000000000201',
    NOW() + INTERVAL '30 minutes',
    NOW() + INTERVAL '12 hours'
  ),
  (
    '34000000-0000-4000-8000-000000000502',
    '34000000-0000-4000-8000-000000000102',
    '34000000-0000-4000-8000-000000000002',
    3402,
    '34000000-0000-4000-8000-000000000402',
    '34000000-0000-4000-8000-000000000202',
    NOW() + INTERVAL '30 minutes',
    NOW() + INTERVAL '12 hours'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_access_context(
  user_id,
  session_id,
  membership_id,
  role_id,
  unit_id
)
SELECT
  fixture.user_id,
  fixture.session_id,
  fixture.membership_id,
  role_record.id,
  fixture.unit_id
FROM (
  VALUES
    (
      '34000000-0000-4000-8000-000000000101'::UUID,
      '34000000-0000-4000-8000-000000000201'::UUID,
      '34000000-0000-4000-8000-000000000301'::UUID,
      3401
    ),
    (
      '34000000-0000-4000-8000-000000000102'::UUID,
      '34000000-0000-4000-8000-000000000202'::UUID,
      '34000000-0000-4000-8000-000000000302'::UUID,
      3402
    )
) fixture(user_id, session_id, membership_id, unit_id)
CROSS JOIN public.roles role_record
WHERE role_record.name = 'patient'
ON CONFLICT (user_id, session_id) DO UPDATE SET
  membership_id = EXCLUDED.membership_id,
  role_id = EXCLUDED.role_id,
  unit_id = EXCLUDED.unit_id;

INSERT INTO public.patients(
  id,
  company_id,
  unit_id,
  user_id,
  full_name,
  lg_ativo
)
VALUES
  (
    34001,
    '34000000-0000-4000-8000-000000000001',
    3401,
    '34000000-0000-4000-8000-000000000101',
    'Patient Portal Owner A',
    TRUE
  ),
  (
    34002,
    '34000000-0000-4000-8000-000000000001',
    3401,
    NULL,
    'Patient Portal Other A',
    TRUE
  ),
  (
    34003,
    '34000000-0000-4000-8000-000000000002',
    3402,
    '34000000-0000-4000-8000-000000000102',
    'Patient Portal Owner B',
    TRUE
  )
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  unit_id = EXCLUDED.unit_id,
  user_id = EXCLUDED.user_id,
  lg_ativo = TRUE;

INSERT INTO public.professionals(id, company_id, full_name, lg_ativo)
VALUES
  (
    34001,
    '34000000-0000-4000-8000-000000000001',
    'Patient Portal Professional A',
    TRUE
  ),
  (
    34002,
    '34000000-0000-4000-8000-000000000002',
    'Patient Portal Professional B',
    TRUE
  )
ON CONFLICT (id) DO UPDATE SET lg_ativo = TRUE;

INSERT INTO public.professional_schedules(
  id,
  company_id,
  professional_id,
  unit_id,
  day_of_week,
  lg_habilitado,
  slot1_start,
  slot1_end,
  slot1_duration,
  slot1_unit_id
)
VALUES (
  34001,
  '34000000-0000-4000-8000-000000000001',
  34001,
  3401,
  (
    ARRAY[
      'domingo',
      'segunda-feira',
      'terça-feira',
      'quarta-feira',
      'quinta-feira',
      'sexta-feira',
      'sábado'
    ]
  )[EXTRACT(
    DOW FROM (
      timezone('America/Sao_Paulo', now())::date + 10
    )
  )::INTEGER + 1],
  TRUE,
  1400,
  1600,
  30,
  3401
)
ON CONFLICT (id) DO UPDATE SET
  day_of_week = EXCLUDED.day_of_week,
  lg_habilitado = TRUE,
  slot1_start = EXCLUDED.slot1_start,
  slot1_end = EXCLUDED.slot1_end,
  slot1_duration = EXCLUDED.slot1_duration,
  slot1_unit_id = EXCLUDED.slot1_unit_id;

INSERT INTO public.appointments(
  id,
  company_id,
  unit_id,
  patient_id,
  professional_id,
  appointment_date,
  start_time,
  end_time,
  duration_minutes,
  status,
  notes
)
OVERRIDING SYSTEM VALUE
VALUES
  (
    34001,
    '34000000-0000-4000-8000-000000000001',
    3401,
    34001,
    34001,
    timezone('America/Sao_Paulo', now())::date + 1,
    TIME '09:00',
    TIME '09:30',
    30,
    'scheduled',
    'INTERNAL_CONFIRM_NOTE'
  ),
  (
    34002,
    '34000000-0000-4000-8000-000000000001',
    3401,
    34001,
    34001,
    timezone('America/Sao_Paulo', now())::date + 2,
    TIME '10:00',
    TIME '10:30',
    30,
    'scheduled',
    'INTERNAL_CANCEL_NOTE'
  ),
  (
    34003,
    '34000000-0000-4000-8000-000000000001',
    3401,
    34001,
    34001,
    timezone('America/Sao_Paulo', now())::date + 3,
    TIME '11:00',
    TIME '11:30',
    30,
    'scheduled',
    'INTERNAL_RESCHEDULE_NOTE'
  ),
  (
    34004,
    '34000000-0000-4000-8000-000000000001',
    3401,
    34002,
    34001,
    timezone('America/Sao_Paulo', now())::date + 10,
    TIME '15:00',
    TIME '15:30',
    30,
    'scheduled',
    'INTERNAL_OTHER_PATIENT_NOTE'
  ),
  (
    34005,
    '34000000-0000-4000-8000-000000000002',
    3402,
    34003,
    34002,
    timezone('America/Sao_Paulo', now())::date + 5,
    TIME '13:00',
    TIME '13:30',
    30,
    'scheduled',
    'INTERNAL_OTHER_TENANT_NOTE'
  )
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  unit_id = EXCLUDED.unit_id,
  patient_id = EXCLUDED.patient_id,
  professional_id = EXCLUDED.professional_id,
  appointment_date = EXCLUDED.appointment_date,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  duration_minutes = EXCLUDED.duration_minutes,
  status = EXCLUDED.status,
  notes = EXCLUDED.notes;

SET LOCAL ROLE prontomedic_patient_portal_rpc_owner;

DO $owner_rls$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM public.appointments;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Portal owner bypassed appointment RLS without context';
  END IF;
END
$owner_rls$;

RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT set_config(
  'request.jwt.claim.sub',
  '34000000-0000-4000-8000-000000000101',
  TRUE
);
SELECT set_config('request.jwt.claim.role', 'authenticated', TRUE);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '34000000-0000-4000-8000-000000000101',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '34000000-0000-4000-8000-000000000201'
  )::TEXT,
  TRUE
);

DO $behavior_a$
DECLARE
  v_count INTEGER;
  v_payload JSONB;
  v_rejected BOOLEAN;
  v_claim_sub_before TEXT;
  v_claims_before TEXT;
BEGIN
  IF public.current_company_id() IS DISTINCT FROM
     '34000000-0000-4000-8000-000000000001'::UUID THEN
    RAISE EXCEPTION 'Synthetic patient A context is not active';
  END IF;

  SELECT count(*)
    INTO v_count
    FROM public.patient_portal_list_appointments_secure();
  IF v_count <> 3 THEN
    RAISE EXCEPTION
      'Patient A portal returned % own appointments instead of 3',
      v_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.patient_portal_list_appointments_secure()
    WHERE id IN (34004, 34005)
  ) THEN
    RAISE EXCEPTION 'Patient portal leaked another patient or tenant';
  END IF;

  SELECT to_jsonb(portal_row)
    INTO v_payload
    FROM public.patient_portal_list_appointments_secure() portal_row
    WHERE portal_row.id = 34001;
  IF (
    SELECT array_agg(key_name ORDER BY key_name)
    FROM jsonb_object_keys(v_payload) key_name
  ) IS DISTINCT FROM ARRAY[
    'appointment_date',
    'end_time',
    'id',
    'is_return',
    'professional_name',
    'start_time',
    'status',
    'unit_name'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'List DTO contains unstable or internal keys: %', v_payload;
  END IF;
  IF v_payload::TEXT LIKE '%INTERNAL_%'
     OR v_payload ?| ARRAY[
       'notes',
       'company_id',
       'patient_id',
       'created_at',
       'updated_at'
     ] THEN
    RAISE EXCEPTION 'List DTO exposed an internal value or column';
  END IF;

  PERFORM set_config(
    'app.patient_portal.mutation_token',
    gen_random_uuid()::TEXT,
    TRUE
  );
  PERFORM set_config(
    'app.patient_portal.mutation_operation',
    'confirm',
    TRUE
  );
  IF public.can_access('agenda', 'edit') THEN
    RAISE EXCEPTION 'Forged portal context bypassed can_access';
  END IF;
  PERFORM set_config('app.patient_portal.mutation_token', '', TRUE);
  PERFORM set_config('app.patient_portal.mutation_operation', '', TRUE);

  v_rejected := FALSE;
  BEGIN
    PERFORM private.apply_patient_portal_appointment_mutation(
      '34000000-0000-4000-8000-000000000101',
      '34000000-0000-4000-8000-000000000001',
      34001,
      34001,
      'confirm'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Authenticated role executed the private mutation helper';
  END IF;

  FOREACH v_count IN ARRAY ARRAY[34004, 34005] LOOP
    v_rejected := FALSE;
    BEGIN
      PERFORM public.patient_portal_confirm_appointment_secure(v_count);
    EXCEPTION WHEN insufficient_privilege THEN
      v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION
        'Patient A confirmed forbidden appointment %',
        v_count;
    END IF;
  END LOOP;

  v_claim_sub_before := current_setting('request.jwt.claim.sub', TRUE);
  v_claims_before := current_setting('request.jwt.claims', TRUE);

  v_payload := public.patient_portal_confirm_appointment_secure(34001);
  IF v_payload->>'status' <> 'confirmed'
     OR (v_payload->>'id')::BIGINT <> 34001 THEN
    RAISE EXCEPTION 'Confirmation did not return the expected DTO';
  END IF;
  IF current_setting('request.jwt.claim.sub', TRUE)
       IS DISTINCT FROM v_claim_sub_before
     OR current_setting('request.jwt.claims', TRUE)
       IS DISTINCT FROM v_claims_before THEN
    RAISE EXCEPTION 'Confirmation changed JWT claims';
  END IF;

  v_payload := public.patient_portal_cancel_appointment_secure(
    34002,
    'Cancelamento sintético persistente'
  );
  IF v_payload->>'status' <> 'cancelled'
     OR (v_payload->>'id')::BIGINT <> 34002 THEN
    RAISE EXCEPTION 'Cancellation did not return the expected DTO';
  END IF;
  IF current_setting('request.jwt.claim.sub', TRUE)
       IS DISTINCT FROM v_claim_sub_before
     OR current_setting('request.jwt.claims', TRUE)
       IS DISTINCT FROM v_claims_before THEN
    RAISE EXCEPTION 'Cancellation changed JWT claims';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.patient_portal_reschedule_appointment_secure(
      34003,
      timezone('America/Sao_Paulo', now())::date - 1,
      TIME '14:00',
      NULL,
      'Data passada'
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM ILIKE '%futuro%' THEN
      v_rejected := TRUE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Past reschedule unexpectedly succeeded';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.patient_portal_reschedule_appointment_secure(
      34003,
      timezone('America/Sao_Paulo', now())::date + 10,
      TIME '15:00',
      NULL,
      'Teste de conflito'
    );
  EXCEPTION WHEN exclusion_violation THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Conflicting reschedule unexpectedly succeeded';
  END IF;

  v_payload := public.patient_portal_reschedule_appointment_secure(
    34003,
    timezone('America/Sao_Paulo', now())::date + 10,
    TIME '14:00',
    NULL,
    'Reagendamento sintético persistente'
  );
  IF (v_payload->>'appointment_date')::DATE <>
       timezone('America/Sao_Paulo', now())::date + 10
     OR (v_payload->>'start_time')::TIME <> TIME '14:00'
     OR (v_payload->>'end_time')::TIME <> TIME '14:30'
     OR v_payload->>'status' <> 'scheduled' THEN
    RAISE EXCEPTION 'Reschedule returned an invalid DTO: %', v_payload;
  END IF;
  IF current_setting('request.jwt.claim.sub', TRUE)
       IS DISTINCT FROM v_claim_sub_before
     OR current_setting('request.jwt.claims', TRUE)
       IS DISTINCT FROM v_claims_before THEN
    RAISE EXCEPTION 'Reschedule changed JWT claims';
  END IF;

END
$behavior_a$;

SELECT set_config(
  'request.jwt.claim.sub',
  '34000000-0000-4000-8000-000000000102',
  TRUE
);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '34000000-0000-4000-8000-000000000102',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '34000000-0000-4000-8000-000000000202'
  )::TEXT,
  TRUE
);

DO $behavior_b$
DECLARE
  v_count INTEGER;
  v_rejected BOOLEAN := FALSE;
BEGIN
  SELECT count(*)
    INTO v_count
    FROM public.patient_portal_list_appointments_secure();
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'Patient B portal returned % appointments instead of 1',
      v_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.patient_portal_list_appointments_secure()
    WHERE id <> 34005
  ) THEN
    RAISE EXCEPTION 'Patient B portal leaked tenant A';
  END IF;

  BEGIN
    PERFORM public.patient_portal_cancel_appointment_secure(
      34002,
      'Cross tenant'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Patient B mutated tenant A appointment';
  END IF;
END
$behavior_b$;

RESET ROLE;

DO $audit$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM private.patient_portal_mutation_context
    WHERE backend_pid = pg_backend_pid()
      AND transaction_id = txid_current()
  ) THEN
    RAISE EXCEPTION 'Portal mutation context leaked after RPC completion';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.scheduling_reschedules
    WHERE appointment_id = 34003
      AND new_appointment_date =
        timezone('America/Sao_Paulo', now())::date + 10
      AND new_start_time = TIME '14:00'
      AND reason = 'Reagendamento sintético persistente'
  ) THEN
    RAISE EXCEPTION 'Reschedule audit row was not persisted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.scheduling_status_history
    WHERE appointment_id = 34003
      AND reason =
        'Reagendamento pelo portal: Reagendamento sintético persistente'
  ) THEN
    RAISE EXCEPTION 'Reschedule status history was not persisted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.appointments
    WHERE id IN (34001, 34002, 34003)
      AND notes IS NULL
  ) THEN
    RAISE EXCEPTION 'Contract accidentally changed internal appointment notes';
  END IF;
END
$audit$;

ROLLBACK;

\echo PATIENT_PORTAL_RUNTIME_CONTRACT_OK
