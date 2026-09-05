\set ON_ERROR_STOP on

DO $smoke$
BEGIN
  IF has_function_privilege('authenticated',
       'public.nursing_administer_medication_secure(bigint,bigint)', 'EXECUTE')
     OR has_function_privilege('app_prontomedic',
       'public.nursing_refuse_medication_secure(bigint,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback nao desabilitou mutacoes privilegiadas';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.nursing_bedside_check_secure(bigint,bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated',
       'public.check_prescription_safety(bigint,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated',
       'public.m9_get_patient_appointments_timeline_secure(bigint,jsonb,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback removeu contratos de leitura necessarios';
  END IF;
  IF has_table_privilege('authenticated',
       'public.nursing_medication_administrations', 'UPDATE') THEN
    RAISE EXCEPTION 'Rollback reabriu UPDATE direto de medicamentos';
  END IF;
END;
$smoke$;
