BEGIN;

DO $contract$
DECLARE
  v_definition TEXT;
  v_operator_guide_position INTEGER;
  v_authorization_date_position INTEGER;
  v_password_position INTEGER;
  v_password_validity_position INTEGER;
BEGIN
  IF to_regprocedure('public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Canonical TISS materializer is missing';
  END IF;

  SELECT pg_get_functiondef(
    'public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)'::REGPROCEDURE
  ) INTO v_definition;

  IF v_definition NOT LIKE '%authz.company_id = v_company%'
     OR v_definition NOT LIKE '%authz.unit_id = v_unit%'
     OR v_definition NOT LIKE '%authz.patient_id = v_account.patient_id%'
     OR v_definition NOT LIKE '%authz.appointment_id = v_account.appointment_id%'
     OR v_definition NOT LIKE '%authz.insurance_id = v_account.insurance_id%'
     OR v_definition NOT LIKE '%authz.authorization_number = v_account.authorization_number%'
     OR v_definition NOT LIKE '%v_authorization.authorized_at IS NULL%' THEN
    RAISE EXCEPTION 'Canonical authorization identity or fail-closed date check is missing';
  END IF;

  v_operator_guide_position := position('<ans:numeroGuiaOperadora>' IN v_definition);
  v_authorization_date_position := position('<ans:dataAutorizacao>' IN v_definition);
  v_password_position := position('<ans:senha>' IN v_definition);
  v_password_validity_position := position('<ans:dataValidadeSenha>' IN v_definition);

  IF v_definition NOT LIKE '%''</ans:cabecalhoGuia>'' || v_authorization_xml || ''<ans:dadosBeneficiario>''%' THEN
    RAISE EXCEPTION 'dadosAutorizacao is absent or outside the XSD SP/SADT sequence';
  END IF;
  IF NOT (v_operator_guide_position < v_authorization_date_position
          AND v_authorization_date_position < v_password_position
          AND v_password_position < v_password_validity_position) THEN
    RAISE EXCEPTION 'Authorization fields do not follow the TISS 4.03.00 XSD order';
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
    RAISE EXCEPTION 'Authorization ledger privileges are broader or narrower than required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'insurance_authorizations'
       AND policyname = 'm16_materialization_authorizations_read'
       AND roles = ARRAY['prontomedic_tiss_rpc_owner']::NAME[]
       AND qual LIKE '%active_company_id()%'
       AND qual LIKE '%active_unit_id()%'
  ) THEN
    RAISE EXCEPTION 'Unit-scoped authorization policy is missing';
  END IF;
END
$contract$;

ROLLBACK;
