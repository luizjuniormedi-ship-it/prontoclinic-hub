\set ON_ERROR_STOP on

DO $contract$
DECLARE
  v_function REGPROCEDURE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'prontomedic_reception_rpc_owner'
      AND NOT rolcanlogin
      AND NOT rolinherit
      AND NOT rolbypassrls
      AND NOT rolsuper
      AND NOT rolcreatedb
      AND NOT rolcreaterole
      AND NOT rolreplication
  ) THEN
    RAISE EXCEPTION 'Module 15 restricted owner is not hardened';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    'public.create_insurance_authorization_secure(bigint,bigint,integer,integer,bigint,text,text,text,bigint,text,text,integer,date,date)'::REGPROCEDURE,
    'public.transition_insurance_authorization_secure(uuid,text,text,text,text,date,integer,integer,text)'::REGPROCEDURE,
    'public.create_insurance_authorization_followup_secure(uuid,text,text,date,date,integer)'::REGPROCEDURE,
    'public.add_insurance_authorization_attachment_secure(uuid,text,text,text,bigint,text)'::REGPROCEDURE,
    'public.consume_insurance_authorization(uuid,integer)'::REGPROCEDURE
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc AS procedure_record
      JOIN pg_roles AS owner_role
        ON owner_role.oid = procedure_record.proowner
      WHERE procedure_record.oid = v_function
        AND procedure_record.prosecdef
        AND owner_role.rolname = 'prontomedic_reception_rpc_owner'
        AND NOT owner_role.rolsuper
        AND NOT owner_role.rolbypassrls
    ) THEN
      RAISE EXCEPTION
        'Module 15 mutator % has an unsafe owner or mode',
        v_function;
    END IF;

    IF NOT has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR NOT has_function_privilege('app_prontomedic', v_function, 'EXECUTE')
       OR has_function_privilege('anon', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'Module 15 mutator % has an unsafe ACL', v_function;
    END IF;
  END LOOP;

  IF NOT has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.insurance_authorizations',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.insurance_authorizations',
       'INSERT'
     )
     OR NOT has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.insurance_authorizations',
       'UPDATE'
     )
     OR has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.insurance_authorizations',
       'DELETE'
     )
     OR has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.insurance_authorizations',
       'TRUNCATE'
     )
     OR has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.insurance_authorizations',
       'TRIGGER'
     )
     OR NOT has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.insurance_authorization_attachments',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.insurance_authorization_attachments',
       'INSERT'
     )
     OR has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.insurance_authorization_attachments',
       'UPDATE'
     )
     OR has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.insurance_authorization_attachments',
       'DELETE'
     )
     OR has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.insurance_authorization_attachments',
       'TRUNCATE'
     )
     OR has_table_privilege(
       'prontomedic_reception_rpc_owner',
       'public.insurance_authorization_attachments',
       'TRIGGER'
     ) THEN
    RAISE EXCEPTION 'Module 15 restricted owner table ACL is invalid';
  END IF;

  IF NOT has_function_privilege(
       'prontomedic_reception_rpc_owner',
       'public.m15_can_operate_authorizations()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.m15_can_operate_authorizations()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'app_prontomedic',
       'public.m15_can_operate_authorizations()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.m15_can_operate_authorizations()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Module 15 permission helper is unavailable to the owner';
  END IF;

  IF position(
       'Autorizacao indisponivel no contexto atual'
       IN pg_get_functiondef(
         'public.transition_insurance_authorization_secure(uuid,text,text,text,text,date,integer,integer,text)'::REGPROCEDURE
       )
     ) = 0
     OR position(
       'ERRCODE = ''42501'''
       IN pg_get_functiondef(
         'public.transition_insurance_authorization_secure(uuid,text,text,text,text,date,integer,integer,text)'::REGPROCEDURE
       )
     ) = 0 THEN
    RAISE EXCEPTION
      'Module 15 transition RPC does not fail closed with SQLSTATE 42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'insurance_authorizations'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'insurance_authorization_attachments'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Module 15 FORCE RLS contract is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'insurance_authorizations'
      AND policyname = 'm15_authorizations_reception_owner_select'
      AND cmd = 'SELECT'
      AND roles = ARRAY['prontomedic_reception_rpc_owner']::NAME[]
      AND qual ILIKE '%active_company_id%'
      AND qual ILIKE '%active_unit_id%'
      AND qual ILIKE '%org_can_access_unit%'
      AND qual ILIKE '%m15_can_operate_authorizations%'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'insurance_authorizations'
      AND policyname = 'm15_authorizations_reception_owner_insert'
      AND cmd = 'INSERT'
      AND roles = ARRAY['prontomedic_reception_rpc_owner']::NAME[]
      AND with_check ILIKE '%active_company_id%'
      AND with_check ILIKE '%active_unit_id%'
      AND with_check ILIKE '%org_can_access_unit%'
      AND with_check ILIKE '%m15_can_operate_authorizations%'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'insurance_authorizations'
      AND policyname = 'm15_authorizations_reception_owner_update'
      AND cmd = 'UPDATE'
      AND roles = ARRAY['prontomedic_reception_rpc_owner']::NAME[]
      AND qual ILIKE '%active_company_id%'
      AND qual ILIKE '%active_unit_id%'
      AND qual ILIKE '%org_can_access_unit%'
      AND qual ILIKE '%m15_can_operate_authorizations%'
      AND with_check ILIKE '%active_company_id%'
      AND with_check ILIKE '%active_unit_id%'
      AND with_check ILIKE '%org_can_access_unit%'
      AND with_check ILIKE '%m15_can_operate_authorizations%'
  ) OR (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'insurance_authorizations'
      AND 'prontomedic_reception_rpc_owner' = ANY (roles)
  ) <> 3 THEN
    RAISE EXCEPTION 'Module 15 authorization owner policies are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'insurance_authorization_attachments'
      AND policyname =
        'm15_authorization_attachments_reception_owner_select'
      AND cmd = 'SELECT'
      AND roles = ARRAY['prontomedic_reception_rpc_owner']::NAME[]
      AND qual ILIKE '%active_company_id%'
      AND qual ILIKE '%active_unit_id%'
      AND qual ILIKE '%m15_can_operate_authorizations%'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'insurance_authorization_attachments'
      AND policyname =
        'm15_authorization_attachments_reception_owner_insert'
      AND cmd = 'INSERT'
      AND roles = ARRAY['prontomedic_reception_rpc_owner']::NAME[]
      AND with_check ILIKE '%active_company_id%'
      AND with_check ILIKE '%active_unit_id%'
      AND with_check ILIKE '%m15_can_operate_authorizations%'
  ) OR (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'insurance_authorization_attachments'
      AND 'prontomedic_reception_rpc_owner' = ANY (roles)
  ) <> 2 THEN
    RAISE EXCEPTION 'Module 15 attachment owner policies are incomplete';
  END IF;
END
$contract$;

SELECT 'module15_authorization_rpc_owner_contract_ok' AS result;
