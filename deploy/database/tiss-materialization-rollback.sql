\set ON_ERROR_STOP on

DO $smoke$
BEGIN
  IF to_regprocedure('public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback predecessor manteve RPC de materializacao TISS';
  END IF;
  IF to_regprocedure('public.create_tiss_guide_secure(text,bigint,integer,uuid,bigint,text)') IS NULL
     OR to_regclass('public.tiss_xml') IS NULL
     OR to_regclass('public.tiss_guides') IS NULL THEN
    RAISE EXCEPTION 'rollback predecessor removeu schema TISS preservado';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.tiss_xml'::regclass
      AND tgname = 'trg_m16_assign_tiss_xml_unit'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'rollback predecessor manteve trigger de materializacao';
  END IF;
END;
$smoke$;
