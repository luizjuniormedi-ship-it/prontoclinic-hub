\set ON_ERROR_STOP on

DO $contract$
BEGIN
  IF NOT has_table_privilege(
    'app_prontomedic',
    'public.insurance_companies',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'runtime da Recepcao sem leitura do catalogo de convenios';
  END IF;

  IF has_table_privilege('app_prontomedic', 'public.insurance_companies', 'INSERT')
     OR has_table_privilege('app_prontomedic', 'public.insurance_companies', 'UPDATE')
     OR has_table_privilege('app_prontomedic', 'public.insurance_companies', 'DELETE') THEN
    RAISE EXCEPTION 'runtime da Recepcao manteve escrita direta no catalogo de convenios';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class
     WHERE oid = 'public.insurance_companies'::regclass
       AND relrowsecurity
       AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'insurance_companies sem FORCE RLS';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'insurance_companies'
       AND policyname = 'insurance_companies_app_runtime_select'
       AND cmd = 'SELECT'
       AND 'app_prontomedic' = ANY (roles)
       AND position('current_company_id' IN qual) > 0
  ) THEN
    RAISE EXCEPTION 'policy multiempresa do catalogo de convenios ausente';
  END IF;
END
$contract$;

\echo RECEPTION_INSURANCE_CATALOG_RUNTIME_ACL_PASS
