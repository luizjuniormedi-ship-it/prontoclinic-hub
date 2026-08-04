\set ON_ERROR_STOP on

DO $smoke$
BEGIN
  IF current_database() !~ '^prontoclinic' THEN
    RAISE EXCEPTION 'Banco inesperado: %', current_database();
  END IF;
  IF to_regclass('public.companies') IS NULL
     OR to_regclass('public.units') IS NULL
     OR to_regprocedure('public.active_company_id()') IS NULL
     OR to_regprocedure('public.current_context_is_company_admin(uuid)') IS NULL
     OR to_regrole('prontomedic_rpc_owner') IS NULL THEN
    RAISE EXCEPTION 'Baseline organizacional incompleta';
  END IF;
  IF to_regprocedure('public.update_active_company_admin(text,text,text,text)') IS NOT NULL
     OR to_regprocedure('public.upsert_active_company_unit_admin(integer,text,text,text,text,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'Contrato 20260804033225 ja existe sem historico canonico';
  END IF;
  IF NOT COALESCE((
    SELECT count(*) = 2
       AND bool_and(relrowsecurity)
       AND bool_and(relforcerowsecurity)
    FROM pg_class
    WHERE oid IN ('public.companies'::regclass, 'public.units'::regclass)
  ), false) THEN
    RAISE EXCEPTION 'Baseline inesperada: RLS/FORCE RLS deve estar ativo';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'units'
      AND policyname = 'units_admin'
  ) THEN
    RAISE EXCEPTION 'Baseline inesperada: policy units_admin ausente';
  END IF;
END;
$smoke$;
