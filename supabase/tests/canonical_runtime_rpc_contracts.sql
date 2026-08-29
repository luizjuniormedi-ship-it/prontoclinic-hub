BEGIN;

DO $contract$
DECLARE
  v_definition TEXT;
  v_owner TEXT;
BEGIN
  SELECT pg_get_functiondef(procedure_record.oid), owner_role.rolname
    INTO v_definition, v_owner
    FROM pg_proc AS procedure_record
    JOIN pg_roles AS owner_role ON owner_role.oid = procedure_record.proowner
   WHERE procedure_record.oid =
     'public.nursing_administer_medication_secure(bigint,bigint)'::REGPROCEDURE;

  IF v_owner <> 'prontomedic_rpc_owner' THEN
    RAISE EXCEPTION 'Unexpected nursing administer owner: %', v_owner;
  END IF;
  IF v_definition NOT ILIKE '%scheduled_at IS NULL%'
     OR v_definition NOT ILIKE '%scheduled_at NOT BETWEEN%' THEN
    RAISE EXCEPTION 'Medication administration does not reject a missing or stale schedule';
  END IF;

  SELECT pg_get_functiondef(
    'public.nursing_bedside_check_secure(bigint,bigint)'::REGPROCEDURE
  ) INTO v_definition;
  IF v_definition NOT ILIKE '%medication.unit_id = v_unit%'
     OR v_definition NOT ILIKE '%can_access(''prontuario'', ''edit'')%' THEN
    RAISE EXCEPTION 'Bedside check is not scoped to unit and edit permission';
  END IF;

  SELECT pg_get_functiondef(
    'public.m9_check_patient_appointment_conflicts_secure(bigint,date,time without time zone,time without time zone,integer,bigint,integer,bigint,bigint)'::REGPROCEDURE
  ) INTO v_definition;
  IF v_definition NOT ILIKE '%can_access(''agenda'', ''create'')%'
     OR v_definition NOT ILIKE '%can_access(''agenda'', ''edit'')%' THEN
    RAISE EXCEPTION 'Conflict check does not require a schedule write capability';
  END IF;

  SELECT pg_get_functiondef(
    'public.m9_get_patient_appointments_timeline_secure(bigint,jsonb,integer,integer)'::REGPROCEDURE
  ) INTO v_definition;
  IF v_definition NOT ILIKE '%Filtro de timeline ainda nao suportado%'
     OR v_definition NOT ILIKE '%SELECT COUNT(*)::INTEGER%'
     OR v_definition ILIKE '%COUNT(*) OVER ()%' THEN
    RAISE EXCEPTION 'Timeline filter or pagination contract is incomplete';
  END IF;
END
$contract$;

ROLLBACK;
