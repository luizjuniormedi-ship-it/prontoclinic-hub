-- F1 tenant surface catalog gate for the ephemeral replay database only.
-- Never run against DataSIGH or production.

DO $gate$
DECLARE
  v_table TEXT;
  v_rel RECORD;
  v_proc RECORD;
  v_definition TEXT;
  v_tenant_tables CONSTANT TEXT[] := ARRAY[
    'patients', 'professionals', 'appointments', 'appointment_types',
    'services_catalog', 'units', 'payment_sources', 'insurance_companies'
  ];
  v_all_tables CONSTANT TEXT[] := ARRAY[
    'patients', 'professionals', 'appointments', 'appointment_types',
    'services_catalog', 'units', 'payment_sources', 'insurance_companies',
    'specialties'
  ];
  v_rpc_names CONSTANT TEXT[] := ARRAY[
    'get_scheduling_actor', 'assert_scheduling_permission',
    'assert_appointment_slot_available', 'create_appointment_secure',
    'update_appointment_status_secure', 'reschedule_appointment_secure',
    'get_scheduling_requirements', 'create_appointment_with_requirements_secure',
    'convert_waitlist_to_appointment_secure', 'create_schedule_block_secure',
    'cancel_schedule_block_secure', 'get_professional_available_slots',
    'mark_overdue_appointments_no_show_secure',
    'get_reception_checkin_readiness', 'perform_reception_checkin_secure',
    'update_reception_authorization_secure', 'update_reception_eligibility_secure',
    'update_appointment_secure', 'update_patient_secure'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_all_tables LOOP
    SELECT c.relrowsecurity, c.relforcerowsecurity
      INTO v_rel
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = v_table AND c.relkind = 'r';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'tenant surface gate: public.% is missing', v_table;
    END IF;
    IF v_rel.relrowsecurity IS NOT TRUE OR v_rel.relforcerowsecurity IS NOT TRUE THEN
      RAISE EXCEPTION 'tenant surface gate: public.% must ENABLE and FORCE RLS', v_table;
    END IF;

    IF has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
       OR has_table_privilege('anon', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('anon', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('anon', format('public.%I', v_table), 'DELETE') THEN
      RAISE EXCEPTION 'tenant surface gate: anon retains privileges on public.%', v_table;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
      WHERE n.nspname = 'public' AND c.relname = v_table
        AND acl.grantee = 0
    ) THEN
      RAISE EXCEPTION 'tenant surface gate: PUBLIC retains privileges on public.%', v_table;
    END IF;
    IF NOT has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'tenant surface gate: authenticated lacks SELECT on public.%', v_table;
    END IF;
    IF has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') THEN
      RAISE EXCEPTION 'tenant surface gate: authenticated has direct DML on public.%', v_table;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
      JOIN pg_roles r ON r.oid = acl.grantee
      WHERE n.nspname = 'public' AND c.relname = v_table
        AND r.rolname = 'authenticated' AND acl.privilege_type <> 'SELECT'
    ) THEN
      RAISE EXCEPTION 'tenant surface gate: authenticated has non-SELECT ACL on public.%', v_table;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY v_tenant_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table
        AND cmd = 'SELECT' AND roles = ARRAY['authenticated']::name[]
        AND qual ~ 'get_my_company_id'
    ) THEN
      RAISE EXCEPTION 'tenant surface gate: tenant SELECT policy missing on public.%', v_table;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table AND cmd <> 'SELECT'
    ) THEN
      RAISE EXCEPTION 'tenant surface gate: non-SELECT policy remains on public.%', v_table;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'specialties'
      AND cmd = 'SELECT' AND roles = ARRAY['authenticated']::name[]
      AND regexp_replace(qual, '[()[:space:]]', '', 'g') = 'true'
  ) THEN
    RAISE EXCEPTION 'tenant surface gate: specialties shared read-only policy missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = ANY(v_all_tables) AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'tenant surface gate: protected browser surface has a write policy';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patients'
      AND column_name = 'insurance_plan_id' AND data_type = 'integer'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patients'
      AND column_name = 'allergies'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patients'
      AND column_name = 'clinical_alerts'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'name'
  ) THEN
    RAISE EXCEPTION 'tenant surface gate: required frontend compatibility columns are missing';
  END IF;

  IF has_table_privilege('authenticated', 'public.appointments', 'INSERT')
     OR has_table_privilege('authenticated', 'public.appointments', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.appointments', 'DELETE') THEN
    RAISE EXCEPTION 'tenant surface gate: direct appointment mutation is still granted';
  END IF;

  FOR v_proc IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(v_rpc_names)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(
        (SELECT proacl FROM pg_proc WHERE oid = v_proc.oid),
        acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = v_proc.oid))
      )) acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'tenant surface gate: PUBLIC can execute function %', v_proc.oid::regprocedure;
    END IF;
    IF has_function_privilege('anon', v_proc.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'tenant surface gate: anon can execute function %', v_proc.oid::regprocedure;
    END IF;
    IF NOT has_function_privilege('authenticated', v_proc.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'tenant surface gate: authenticated cannot execute function %', v_proc.oid::regprocedure;
    END IF;
  END LOOP;

  SELECT pg_get_functiondef('public.assert_scheduling_permission()'::regprocedure)
    INTO v_definition;
  IF v_definition !~ 'auth\.uid\(\) IS NULL' OR v_definition !~ 'RAISE EXCEPTION' THEN
    RAISE EXCEPTION 'tenant surface gate: assert_scheduling_permission is not fail-closed for null auth';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'tenant surface gate precondition: auth.uid() must be null';
  END IF;
  BEGIN
    PERFORM public.assert_scheduling_permission();
    RAISE EXCEPTION 'tenant surface gate: null auth was accepted';
  EXCEPTION
    WHEN invalid_authorization_specification THEN NULL;
  END;

  SELECT pg_get_functiondef(
    'public.create_appointment_secure(bigint,bigint,date,time without time zone,time without time zone,uuid,integer,integer,bigint,bigint,text,boolean,boolean,text)'::regprocedure
  ) INTO v_definition;
  IF v_definition !~ 'v_company_id IS DISTINCT FROM v_actor\.company_id'
     OR v_definition !~ 'Paciente fora da empresa do usuario'
     OR v_definition !~ 'Profissional fora da empresa do usuario' THEN
    RAISE EXCEPTION 'tenant surface gate: create_appointment_secure lacks preserved actor-company predicates';
  END IF;

  SELECT pg_get_functiondef('public.update_appointment_status_secure(bigint,text,text)'::regprocedure)
    INTO v_definition;
  IF v_definition !~ 'v_old\.company_id IS DISTINCT FROM v_actor\.company_id' THEN
    RAISE EXCEPTION 'tenant surface gate: update_appointment_status_secure lacks actor-company predicate';
  END IF;

  SELECT pg_get_functiondef(
    'public.reschedule_appointment_secure(bigint,date,time without time zone,time without time zone,text)'::regprocedure
  ) INTO v_definition;
  IF v_definition !~ 'v_old\.company_id IS DISTINCT FROM v_actor\.company_id' THEN
    RAISE EXCEPTION 'tenant surface gate: reschedule_appointment_secure lacks actor-company predicate';
  END IF;
END
$gate$;

SELECT 'F1_RUNTIME_TENANT_SURFACE_GATE=PASS' AS result;
