\set ON_ERROR_STOP on

DO $smoke$
BEGIN
  IF to_regprocedure('public.create_tiss_guide_secure(text,bigint,integer,uuid,bigint,text)') IS NULL
     OR to_regclass('public.tiss_xml') IS NULL
     OR to_regclass('public.tiss_guides') IS NULL THEN
    RAISE EXCEPTION 'baseline TISS predecessora ausente';
  END IF;
  IF to_regprocedure('public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'materializacao TISS ja existe antes da migration';
  END IF;
END;
$smoke$;
