\set ON_ERROR_STOP on
DO $smoke$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)'::regprocedure
  ) INTO v_definition;

  IF v_definition NOT LIKE '%<ans:dadosAutorizacao>%'
     OR v_definition NOT LIKE '%<ans:numeroGuiaOperadora>%'
     OR v_definition NOT LIKE '%<ans:dataAutorizacao>%'
     OR v_definition NOT LIKE '%<ans:senha>%'
     OR v_definition NOT LIKE '%<ans:dataValidadeSenha>%'
     OR v_definition NOT LIKE '%Canonical TISS authorization is missing%' THEN
    RAISE EXCEPTION 'Materializador TISS nao serializa a autorizacao canonica completa';
  END IF;

  IF has_table_privilege(
       'prontomedic_tiss_rpc_owner', 'public.insurance_authorizations', 'SELECT'
     )
     OR NOT has_column_privilege(
       'prontomedic_tiss_rpc_owner', 'public.insurance_authorizations', 'authorized_at', 'SELECT'
     )
     OR NOT has_column_privilege(
       'prontomedic_tiss_rpc_owner', 'public.insurance_authorizations', 'password_number', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'Owner TISS fora do conjunto minimo de colunas da autorizacao';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'insurance_authorizations'
       AND policyname = 'm16_materialization_authorizations_read'
       AND roles = ARRAY['prontomedic_tiss_rpc_owner']::name[]
  ) THEN
    RAISE EXCEPTION 'Policy de leitura das autorizacoes TISS ausente';
  END IF;
END;
$smoke$;
