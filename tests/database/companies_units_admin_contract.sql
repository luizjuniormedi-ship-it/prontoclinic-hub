\set ON_ERROR_STOP on

DO $test$
DECLARE
  v_owner TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'companies'
       AND c.relrowsecurity AND c.relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'units'
       AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'companies and units must enforce RLS';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name IN ('companies', 'units')
       AND grantee = 'authenticated'
       AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'authenticated retains direct company or unit DML';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'units'
       AND policyname IN ('units_admin', 'units_insert', 'units_update', 'units_delete')
  ) THEN
    RAISE EXCEPTION 'legacy unit write policy remains installed';
  END IF;

  SELECT pg_get_userbyid(p.proowner) INTO v_owner
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'update_active_company_admin';
  IF v_owner IS DISTINCT FROM 'prontomedic_rpc_owner' THEN
    RAISE EXCEPTION 'unexpected company RPC owner: %', v_owner;
  END IF;

  SELECT pg_get_userbyid(p.proowner) INTO v_owner
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'upsert_active_company_unit_admin';
  IF v_owner IS DISTINCT FROM 'prontomedic_rpc_owner' THEN
    RAISE EXCEPTION 'unexpected unit RPC owner: %', v_owner;
  END IF;

  IF NOT has_function_privilege('authenticated',
      'public.update_active_company_admin(text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated',
      'public.upsert_active_company_unit_admin(integer,text,text,text,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated RPC execute grant is missing';
  END IF;

  IF NOT has_function_privilege('prontomedic_rpc_owner',
      'public.active_company_id()', 'EXECUTE')
     OR NOT has_function_privilege('prontomedic_rpc_owner',
      'public.current_context_is_company_admin(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'company RPC owner helper execute grant is missing';
  END IF;
END;
$test$;
