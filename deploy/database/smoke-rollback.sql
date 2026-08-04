\set ON_ERROR_STOP on

DO $smoke$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid IN ('public.companies'::regclass, 'public.units'::regclass)
      AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Rollback manteve FORCE RLS fora do baseline anterior';
  END IF;
  IF to_regprocedure('public.update_active_company_admin(text,text,text,text)') IS NOT NULL
     OR to_regprocedure('public.upsert_active_company_unit_admin(integer,text,text,text,text,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'RPC administrativa permaneceu apos rollback';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'units'
      AND policyname = 'units_admin'
  ) THEN
    RAISE EXCEPTION 'Policy canonica units_admin nao foi restaurada';
  END IF;
  IF has_table_privilege('authenticated', 'public.companies', 'INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.units', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Rollback reintroduziu DML direto';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.units', 'SELECT')
     OR NOT has_sequence_privilege('authenticated', 'public.units_id_seq', 'USAGE,SELECT') THEN
    RAISE EXCEPTION 'Grants canonicos de leitura da unidade nao foram restaurados';
  END IF;
END;
$smoke$;
