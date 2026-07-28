DO $contract$
DECLARE
  v_create_definition TEXT;
  v_update_definition TEXT;
  v_queue_definition TEXT;
  v_checkin_definition TEXT;
  v_capability_definition TEXT;
  v_role RECORD;
BEGIN
  IF has_function_privilege(
    'authenticated',
    'public.update_reception_authorization_secure(uuid,text,text,text,text,date,integer,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'app_prontomedic',
    'public.update_reception_authorization_secure(uuid,text,text,text,text,date,integer,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Legacy authorization mutation RPC remains executable';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.get_reception_exception_capability(bigint)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.get_reception_exception_capability(bigint)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Reception exception capability ACL is invalid';
  END IF;

  SELECT pg_get_functiondef(
    'public.get_reception_exception_capability(bigint)'::regprocedure
  )
  INTO v_capability_definition;

  IF v_capability_definition NOT LIKE
    '%private.reception_actor_has_selected_unit%'
  THEN
    RAISE EXCEPTION
      'Reception exception capability bypasses the active unit boundary';
  END IF;

  IF (
    SELECT qual
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'appointments'
      AND policyname = 'appointments_reception_rpc_select'
  ) NOT LIKE '%reception_actor_has_selected_unit%'
  THEN
    RAISE EXCEPTION
      'Reception appointment owner policy bypasses the active unit boundary';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.update_reception_eligibility_secure(uuid,text,text,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'app_prontomedic',
    'public.update_reception_eligibility_secure(uuid,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Legacy eligibility mutation RPC remains executable';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.transition_insurance_authorization_secure(uuid,text,text,text,text,date,integer,integer,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'app_prontomedic',
    'public.transition_insurance_authorization_secure(uuid,text,text,text,text,date,integer,integer,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Canonical authorization mutation RPC is unavailable';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.update_insurance_eligibility_check_secure(uuid,text,text,text,date,date,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'app_prontomedic',
    'public.update_insurance_eligibility_check_secure(uuid,text,text,text,date,date,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Canonical eligibility mutation RPC is unavailable';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.m14_can_operate_eligibility(integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'app_prontomedic',
    'public.m14_can_operate_eligibility(integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Internal eligibility permission helper is externally executable';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.m14_can_release_eligibility_exception(integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'app_prontomedic',
    'public.m14_can_release_eligibility_exception(integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Internal eligibility exception helper is externally executable';
  END IF;

  IF to_regprocedure('public.m14_can_operate_eligibility()') IS NOT NULL THEN
    RAISE EXCEPTION 'Obsolete zero-argument eligibility permission helper remains exposed';
  END IF;

  IF to_regprocedure('private.org_can_access_unit_runtime(uuid,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Reception package still depends on the Module 19 unit helper';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure_record
    JOIN pg_roles owner_role ON owner_role.oid = procedure_record.proowner
    WHERE procedure_record.oid =
      'public.org_can_access_unit(uuid,integer)'::regprocedure
      AND procedure_record.prosecdef = FALSE
      AND owner_role.rolname <> 'prontomedic_reception_rpc_owner'
  ) OR NOT has_function_privilege(
    'prontomedic_reception_rpc_owner',
    'public.org_can_access_unit(uuid,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Shared unit access helper contract is invalid';
  END IF;

  FOR v_role IN
    SELECT procedure_record.oid::regprocedure AS procedure_name,
           owner_role.rolname AS owner_name,
           owner_role.rolsuper,
           owner_role.rolbypassrls
    FROM pg_proc procedure_record
    JOIN pg_roles owner_role ON owner_role.oid = procedure_record.proowner
    WHERE procedure_record.oid = ANY (ARRAY[
      'public.create_insurance_eligibility_check_secure(bigint,bigint,integer,integer,integer,text,text,text,date,date,text,text,text,text,text,text,text,text,text)'::regprocedure,
      'public.update_insurance_eligibility_check_secure(uuid,text,text,text,date,date,text,text,text,text,text,text,text)'::regprocedure,
      'public.capture_insurance_eligibility_event()'::regprocedure,
      'public.m14_can_operate_eligibility(integer)'::regprocedure,
      'public.m14_can_release_eligibility_exception(integer)'::regprocedure,
      'public.get_reception_exception_capability(bigint)'::regprocedure
    ])
  LOOP
    IF v_role.owner_name <> 'prontomedic_reception_rpc_owner'
       OR v_role.rolsuper
       OR v_role.rolbypassrls THEN
      RAISE EXCEPTION
        'Eligibility function % has unsafe owner %',
        v_role.procedure_name,
        v_role.owner_name;
    END IF;
  END LOOP;

  IF NOT has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.insurance_eligibility_checks',
       'SELECT,INSERT,UPDATE'
     )
     OR has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.insurance_eligibility_checks',
       'DELETE'
     )
     OR NOT has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.insurance_eligibility_events',
       'INSERT'
     )
     OR has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.insurance_eligibility_events',
       'UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION 'Eligibility owner table privileges are missing or too broad';
  END IF;

  SELECT pg_get_functiondef(
    'public.create_insurance_eligibility_check_secure(bigint,bigint,integer,integer,integer,text,text,text,date,date,text,text,text,text,text,text,text,text,text)'::regprocedure
  ) INTO v_create_definition;
  SELECT pg_get_functiondef(
    'public.update_insurance_eligibility_check_secure(uuid,text,text,text,date,date,text,text,text,text,text,text,text)'::regprocedure
  ) INTO v_update_definition;

  IF position('m14_can_operate_eligibility(v_effective_unit_id)' IN v_create_definition) = 0
     OR position('org_can_access_unit' IN v_create_definition) = 0
     OR position('m14_can_release_eligibility_exception(v_effective_unit_id)' IN v_create_definition) = 0
     OR position('m14_can_operate_eligibility(v_old.unit_id)' IN v_update_definition) = 0
     OR position('org_can_access_unit' IN v_update_definition) = 0
     OR position('m14_can_release_eligibility_exception(v_old.unit_id)' IN v_update_definition) = 0 THEN
    RAISE EXCEPTION 'Canonical eligibility RPCs do not enforce permission, exception capability and unit scope';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.insurance_eligibility_checks'::regclass
      AND conname = 'insurance_eligibility_unit_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'Eligibility unit foreign key is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'insurance_eligibility_checks'
      AND policyname = 'insurance_eligibility_select_tenant'
      AND qual ILIKE '%org_can_access_unit%'
  ) THEN
    RAISE EXCEPTION 'Eligibility SELECT policy is not unit-aware';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'insurance_eligibility_checks'
      AND policyname = 'insurance_eligibility_reception_owner'
      AND roles = ARRAY['prontomedic_reception_rpc_owner']::NAME[]
      AND qual ILIKE '%org_can_access_unit%'
      AND with_check ILIKE '%org_can_access_unit%'
  ) THEN
    RAISE EXCEPTION 'Eligibility owner policy is missing or not unit-aware';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'insurance_eligibility_events'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'insurance_eligibility_events'
      AND policyname = 'insurance_eligibility_events_unit_select'
      AND qual ILIKE '%org_can_access_unit%'
      AND qual ILIKE '%eligibility_check_id%'
  ) THEN
    RAISE EXCEPTION 'Eligibility event history is not FORCE-RLS and unit-aware';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'reception_eligibility_checks'
      AND relation.reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE EXCEPTION 'Reception eligibility view is not security_invoker';
  END IF;

  SELECT pg_get_functiondef(
    'public.transition_reception_queue_ticket_secure(bigint,text,text,integer)'::regprocedure
  ) INTO v_queue_definition;
  IF position('ticket.ticket_date = CURRENT_DATE' IN v_queue_definition) = 0 THEN
    RAISE EXCEPTION 'Reception queue RPC does not reject historical tickets';
  END IF;

  SELECT pg_get_functiondef(
    'public.perform_reception_checkin_secure(uuid,bigint,text,text)'::regprocedure
  ) INTO v_checkin_definition;

  IF position(
       'private.reception_mark_appointment_waiting' IN v_checkin_definition
     ) = 0
     OR position(
       'public.update_appointment_status_secure' IN v_checkin_definition
     ) > 0 THEN
    RAISE EXCEPTION
      'Reception check-in still depends on the broad legacy Agenda transition';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure_record
    JOIN pg_roles owner_role ON owner_role.oid = procedure_record.proowner
    WHERE procedure_record.oid =
      'private.reception_mark_appointment_waiting(bigint,text)'::regprocedure
      AND procedure_record.prosecdef
      AND owner_role.rolname = 'prontomedic_reception_rpc_owner'
      AND owner_role.rolsuper = FALSE
      AND owner_role.rolbypassrls = FALSE
  ) THEN
    RAISE EXCEPTION
      'Reception appointment transition helper owner contract is invalid';
  END IF;

  IF NOT has_function_privilege(
       'prontomedic_reception_rpc_owner',
       'private.reception_mark_appointment_waiting(bigint,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'private.reception_mark_appointment_waiting(bigint,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'app_prontomedic',
       'private.reception_mark_appointment_waiting(bigint,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'private.reception_mark_appointment_waiting(bigint,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'Reception appointment transition helper ACL is invalid';
  END IF;

  RAISE NOTICE 'RECEPTION_PENDING_SECURITY_CONTRACT_OK';
END
$contract$;
