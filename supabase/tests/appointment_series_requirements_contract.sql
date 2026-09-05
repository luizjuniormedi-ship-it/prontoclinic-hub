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
  IF v_definition NOT ILIKE '%v_company_id::TEXT || '':'' || p_patient_id::TEXT || '':'' || p_insurance_plan_id::TEXT%'
     OR position('pg_advisory_xact_lock' IN lower(v_definition)) > position('insert into public.patient_insurances' IN lower(v_definition))
     OR v_definition ILIKE '%FOR UPDATE%'
     OR v_definition ILIKE '%FOR KEY SHARE%' THEN
    RAISE EXCEPTION 'Patient insurance must be serialized before side effects without elevated row-lock grants';
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
  IF NOT has_function_privilege(
    'prontomedic_schedule_rpc_owner',
    'public.org_can_access_unit(uuid,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Series owner cannot validate tenant-scoped unit access';
  END IF;
  IF NOT has_table_privilege(
    'prontomedic_schedule_rpc_owner', 'public.units', 'SELECT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'units'
       AND policyname = 'units_series_owner_select'
       AND roles @> ARRAY['prontomedic_schedule_rpc_owner']::name[]
  ) THEN
    RAISE EXCEPTION 'Series owner cannot validate the active unit in insurance triggers';
  END IF;
  IF NOT has_table_privilege(
    'prontomedic_schedule_rpc_owner', 'public.patient_insurances', 'SELECT,INSERT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'patient_insurances'
       AND policyname = 'patient_insurances_series_owner_select'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'patient_insurances'
       AND policyname = 'patient_insurances_series_owner_insert'
  ) THEN
    RAISE EXCEPTION 'Series cannot preserve the canonical patient insurance card';
  END IF;
END;
$contract$;
ROLLBACK;
