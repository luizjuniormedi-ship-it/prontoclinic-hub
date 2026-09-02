\set ON_ERROR_STOP on

DO $smoke$
BEGIN
  IF has_function_privilege('authenticated',
       'public.nursing_administer_medication_secure(bigint,bigint)', 'EXECUTE')
     OR has_function_privilege('app_prontomedic',
       'public.nursing_administer_medication_secure(bigint,bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.nursing_refuse_medication_secure(bigint,text)', 'EXECUTE')
     OR has_function_privilege('app_prontomedic',
       'public.nursing_refuse_medication_secure(bigint,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback nao desabilitou mutacoes privilegiadas de Enfermagem';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'prontomedic_nursing_rpc_owner' AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'Rollback degradou owner restrito';
  END IF;
END;
$smoke$;
