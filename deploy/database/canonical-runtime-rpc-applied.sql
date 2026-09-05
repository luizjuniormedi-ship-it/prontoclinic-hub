\set ON_ERROR_STOP on

DO $smoke$
DECLARE
  v_definition TEXT;
BEGIN
  IF to_regprocedure('public.nursing_bedside_check_secure(bigint,bigint)') IS NULL
     OR to_regprocedure('public.nursing_administer_medication_secure(bigint,bigint)') IS NULL
     OR to_regprocedure('public.nursing_refuse_medication_secure(bigint,text)') IS NULL
     OR to_regprocedure('public.check_prescription_safety(bigint,text)') IS NULL
     OR to_regprocedure('public.m9_check_patient_appointment_conflicts_secure(bigint,date,time without time zone,time without time zone,integer,bigint,integer,bigint,bigint)') IS NULL
     OR to_regprocedure('public.m9_get_patient_appointments_timeline_secure(bigint,jsonb,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'RPC canonica ausente apos migration';
  END IF;
  IF has_function_privilege('anon', 'public.nursing_administer_medication_secure(bigint,bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.m9_check_patient_appointment_conflicts_secure(bigint,date,time without time zone,time without time zone,integer,bigint,integer,bigint,bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.nursing_administer_medication_secure(bigint,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL das RPCs canonicas diverge do contrato';
  END IF;
  SELECT pg_get_functiondef('public.m9_get_patient_appointments_timeline_secure(bigint,jsonb,integer,integer)'::regprocedure)
    INTO v_definition;
  IF v_definition NOT ILIKE '%Filtro de timeline ainda nao suportado%'
     OR v_definition ILIKE '%COUNT(*) OVER ()%' THEN
    RAISE EXCEPTION 'Contrato de filtros/paginacao da timeline incompleto';
  END IF;
END;
$smoke$;
