\set ON_ERROR_STOP on
DO $smoke$
DECLARE
  v_definition TEXT;
BEGIN
  IF to_regprocedure(
    'public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Materializador TISS predecessor ausente';
  END IF;

  SELECT pg_get_functiondef(
    'public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)'::regprocedure
  ) INTO v_definition;

  IF v_definition LIKE '%<ans:dadosAutorizacao>%' THEN
    RAISE EXCEPTION 'Serializacao da autorizacao TISS ja existe antes da migration';
  END IF;
END;
$smoke$;
