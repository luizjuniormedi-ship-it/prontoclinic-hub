\set ON_ERROR_STOP on

DO $smoke$
BEGIN
  IF to_regprocedure('public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)') IS NULL
     OR to_regprocedure('private.m16_assign_tiss_xml_unit()') IS NULL THEN
    RAISE EXCEPTION 'contrato de materializacao TISS ausente';
  END IF;
  IF NOT has_function_privilege(
       'authenticated',
       'public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)',
       'EXECUTE'
     ) OR has_function_privilege(
       'anon',
       'public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'grants da materializacao TISS divergem do contrato';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.tiss_xml'::regclass
      AND tgname = 'trg_m16_assign_tiss_xml_unit'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trigger de unidade do XML TISS ausente';
  END IF;
END;
$smoke$;
