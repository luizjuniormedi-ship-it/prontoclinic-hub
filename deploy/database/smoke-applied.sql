\set ON_ERROR_STOP on

DO $smoke$
DECLARE
  v_owner text;
BEGIN
  IF NOT COALESCE((
    SELECT count(*) = 2
       AND bool_and(relrowsecurity)
       AND bool_and(relforcerowsecurity)
    FROM pg_class
    WHERE oid IN ('public.companies'::regclass, 'public.units'::regclass)
  ), false) THEN
    RAISE EXCEPTION 'RLS/FORCE RLS nao esta ativo em companies e units';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'units'
      AND policyname IN ('units_admin', 'units_insert', 'units_update', 'units_delete')
  ) THEN
    RAISE EXCEPTION 'Policy legada de escrita permanece ativa';
  END IF;
  IF has_table_privilege('authenticated', 'public.companies', 'INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.units', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'authenticated conserva DML direto';
  END IF;

  SELECT pg_get_userbyid(proowner) INTO v_owner
  FROM pg_proc
  WHERE oid = 'public.update_active_company_admin(text,text,text,text)'::regprocedure;
  IF v_owner IS DISTINCT FROM 'prontomedic_rpc_owner' THEN
    RAISE EXCEPTION 'Owner inesperado da RPC de empresa: %', v_owner;
  END IF;
  SELECT pg_get_userbyid(proowner) INTO v_owner
  FROM pg_proc
  WHERE oid = 'public.upsert_active_company_unit_admin(integer,text,text,text,text,boolean)'::regprocedure;
  IF v_owner IS DISTINCT FROM 'prontomedic_rpc_owner' THEN
    RAISE EXCEPTION 'Owner inesperado da RPC de unidade: %', v_owner;
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.update_active_company_admin(text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated',
       'public.upsert_active_company_unit_admin(integer,text,text,text,text,boolean)', 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc AS procedure
       CROSS JOIN LATERAL aclexplode(
         coalesce(procedure.proacl, acldefault('f', procedure.proowner))
       ) AS privilege
       WHERE procedure.oid IN (
         'public.update_active_company_admin(text,text,text,text)'::regprocedure,
         'public.upsert_active_company_unit_admin(integer,text,text,text,text,boolean)'::regprocedure
       )
         AND privilege.grantee = 0
         AND privilege.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Grants das RPCs divergem do contrato';
  END IF;
END;
$smoke$;
