BEGIN;

DO $contract$
DECLARE
  v_definition TEXT;
BEGIN
  IF to_regprocedure('public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)') IS NULL THEN
    RAISE EXCEPTION 'M16 account materialization RPC is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc procedure_record
      JOIN pg_roles owner_role ON owner_role.oid = procedure_record.proowner
     WHERE procedure_record.oid = 'public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)'::REGPROCEDURE
       AND owner_role.rolname = 'prontomedic_tiss_rpc_owner'
       AND procedure_record.prosecdef
       AND procedure_record.proconfig @> ARRAY['search_path=pg_catalog, public']
  ) THEN
    RAISE EXCEPTION 'M16 materialization owner/security/search_path contract is invalid';
  END IF;
  IF has_function_privilege('anon', 'public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('app_prontomedic', 'public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M16 materialization execute grants are invalid';
  END IF;
  SELECT pg_get_functiondef('public.m16_materialize_account_tiss_secure(uuid,uuid,integer,text,text)'::REGPROCEDURE)
    INTO v_definition;
  IF v_definition NOT LIKE '%account.unit_id = v_unit%'
     OR v_definition NOT LIKE '%account.version IS DISTINCT FROM p_expected_account_version%'
     OR v_definition NOT LIKE '%billing_type IS DISTINCT FROM ''convenio''%'
     OR v_definition NOT LIKE '%tipoAtendimento>23%'
     OR v_definition NOT LIKE '%private.m16_claim_operation%'
     OR v_definition NOT LIKE '%private.m16_finish_operation%'
     OR v_definition NOT LIKE '%private.m16_xml_unescape(match[1])%'
     OR v_definition LIKE '%p_payload JSONB%'
     OR v_definition LIKE '%p_xml TEXT%' THEN
    RAISE EXCEPTION 'M16 materialization invariants or minimal payload contract are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tiss_xml' AND column_name = 'unit_id'
  ) THEN
    RAISE EXCEPTION 'TISS XML unit scope is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'tiss_xml'
       AND policyname = 'm16_xml_owner_all'
       AND qual LIKE '%active_unit_id()%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'tiss_guides'
       AND policyname = 'm16_guide_owner_all'
       AND qual LIKE '%active_unit_id()%'
  ) THEN
    RAISE EXCEPTION 'TISS guide/XML unit isolation policies are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tiss_operation_requests'::REGCLASS
       AND conname = 'tiss_operation_requests_operation_type_check'
       AND pg_get_constraintdef(oid) LIKE '%materialize_account%'
  ) THEN
    RAISE EXCEPTION 'M16 idempotency operation type is missing';
  END IF;
  IF has_function_privilege('anon', 'public.create_tiss_guide_secure(text,bigint,integer,uuid,bigint,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.create_tiss_guide_secure(text,bigint,integer,uuid,bigint,text)', 'EXECUTE')
     OR has_function_privilege('app_prontomedic', 'public.create_tiss_guide_secure(text,bigint,integer,uuid,bigint,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Legacy guide creation remains exposed outside the atomic materializer';
  END IF;
END
$contract$;

ROLLBACK;
