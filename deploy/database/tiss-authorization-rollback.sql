\set ON_ERROR_STOP on
DO $smoke$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)'::regprocedure
  ) INTO v_definition;

  IF v_definition LIKE '%<ans:dadosAutorizacao>%' THEN
    RAISE EXCEPTION 'Rollback manteve serializacao da autorizacao TISS';
  END IF;

  IF has_table_privilege(
    'prontomedic_tiss_rpc_owner', 'public.insurance_authorizations', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Rollback manteve leitura do ledger de autorizacoes';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'insurance_authorizations'
       AND policyname = 'm16_materialization_authorizations_read'
  ) THEN
    RAISE EXCEPTION 'Rollback manteve policy de autorizacao TISS';
  END IF;
END;
$smoke$;
