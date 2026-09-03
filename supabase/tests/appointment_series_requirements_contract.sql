\set ON_ERROR_STOP on
BEGIN;
DO $contract$
DECLARE
  v_definition TEXT;
BEGIN
  IF to_regprocedure(
    'public.create_appointment_series_with_requirements_secure(uuid,bigint,bigint,date,time,time,uuid,integer,integer,bigint,bigint,boolean,text,integer,integer,text,text,integer,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Appointment series RPC is missing';
  END IF;
  SELECT pg_get_functiondef(
    'public.create_appointment_series_with_requirements_secure(uuid,bigint,bigint,date,time,time,uuid,integer,integer,bigint,bigint,boolean,text,integer,integer,text,text,integer,integer)'::regprocedure
  ) INTO v_definition;
  IF v_definition NOT ILIKE '%pg_advisory_xact_lock%'
     OR v_definition NOT ILIKE '%p_insurance_plan_id%'
     OR v_definition NOT ILIKE '%p_card_number%'
     OR v_definition NOT ILIKE '%p_authorization_number%'
     OR v_definition NOT ILIKE '%RETURN NEXT v_row%' THEN
    RAISE EXCEPTION 'Appointment series lost atomicity or insurance contract';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.appointment_series'::regclass
       AND relrowsecurity AND relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.appointment_series_items'::regclass
       AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Series audit tables are not protected by forced RLS';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'insurance_plans'
       AND policyname = 'insurance_plans_series_owner_select'
       AND roles @> ARRAY['prontomedic_schedule_rpc_owner']::name[]
  ) THEN
    RAISE EXCEPTION 'Series owner lacks a tenant-scoped insurance plan policy';
  END IF;
  IF NOT has_table_privilege(
    'prontomedic_schedule_rpc_owner',
    'public.insurance_plans',
    'SELECT'
  ) OR NOT has_function_privilege(
    'prontomedic_schedule_rpc_owner',
    'public.get_scheduling_requirements(bigint,bigint,bigint,integer,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Series owner lacks the minimum insurance requirements privileges';
  END IF;
END;
$contract$;
ROLLBACK;
