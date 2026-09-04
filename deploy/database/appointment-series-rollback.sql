\set ON_ERROR_STOP on
DO $smoke$
BEGIN
  IF has_function_privilege(
    'authenticated',
    'public.create_appointment_series_with_requirements_secure(uuid,bigint,bigint,date,time,time,uuid,integer,integer,bigint,bigint,boolean,text,integer,integer,text,text,integer,integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'app_prontomedic',
    'public.create_appointment_series_with_requirements_secure(uuid,bigint,bigint,date,time,time,uuid,integer,integer,bigint,bigint,boolean,text,integer,integer,text,text,integer,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Rollback nao desabilitou criacao de series';
  END IF;
  IF to_regclass('public.appointment_series') IS NULL THEN
    RAISE EXCEPTION 'Rollback removeu trilha de auditoria das series';
  END IF;
  IF has_table_privilege('prontomedic_schedule_rpc_owner', 'public.insurance_plans', 'SELECT')
     OR has_table_privilege('prontomedic_schedule_rpc_owner', 'public.units', 'SELECT')
     OR has_table_privilege('prontomedic_schedule_rpc_owner', 'public.patient_insurances', 'SELECT,INSERT') THEN
    RAISE EXCEPTION 'Rollback deixou grants auxiliares da serie ativos';
  END IF;
END;
$smoke$;
