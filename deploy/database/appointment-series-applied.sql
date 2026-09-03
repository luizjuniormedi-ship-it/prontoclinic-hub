\set ON_ERROR_STOP on
DO $smoke$
BEGIN
  IF to_regclass('public.appointment_series') IS NULL
     OR to_regclass('public.appointment_series_items') IS NULL
     OR to_regprocedure(
       'public.create_appointment_series_with_requirements_secure(uuid,bigint,bigint,date,time,time,uuid,integer,integer,bigint,bigint,boolean,text,integer,integer,text,text,integer,integer)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Contrato atomico de serie ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'prontomedic_schedule_rpc_owner'
       AND NOT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls AND NOT rolsuper
  ) THEN
    RAISE EXCEPTION 'Owner restrito da Agenda ausente';
  END IF;
  IF pg_get_userbyid((
    SELECT proowner FROM pg_proc
     WHERE oid = 'public.create_appointment_series_with_requirements_secure(uuid,bigint,bigint,date,time,time,uuid,integer,integer,bigint,bigint,boolean,text,integer,integer,text,text,integer,integer)'::regprocedure
  )) <> 'prontomedic_schedule_rpc_owner' THEN
    RAISE EXCEPTION 'RPC de serie conserva owner privilegiado';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.create_appointment_series_with_requirements_secure(uuid,bigint,bigint,date,time,time,uuid,integer,integer,bigint,bigint,boolean,text,integer,integer,text,text,integer,integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.create_appointment_series_with_requirements_secure(uuid,bigint,bigint,date,time,time,uuid,integer,integer,bigint,bigint,boolean,text,integer,integer,text,text,integer,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ACL da RPC de serie invalida';
  END IF;
END;
$smoke$;
