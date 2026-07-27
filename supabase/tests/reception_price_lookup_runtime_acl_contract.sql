\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT has_table_privilege('app_prontomedic', 'public.price_tables', 'SELECT') THEN
    RAISE EXCEPTION 'runtime da Recepcao sem leitura da tabela de precos';
  END IF;

  IF has_table_privilege('app_prontomedic', 'public.price_tables', 'INSERT')
     OR has_table_privilege('app_prontomedic', 'public.price_tables', 'UPDATE')
     OR has_table_privilege('app_prontomedic', 'public.price_tables', 'DELETE') THEN
    RAISE EXCEPTION 'runtime da Recepcao manteve escrita direta na tabela de precos';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = 'public.price_tables'::regclass
      AND relrowsecurity
      AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'price_tables sem FORCE RLS';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'price_tables'
      AND policyname = 'price_tables_app_runtime_select'
      AND cmd = 'SELECT'
      AND 'app_prontomedic' = ANY (roles)
  ) THEN
    RAISE EXCEPTION 'policy multiempresa de leitura da tabela de precos ausente';
  END IF;
END;
$$;

SELECT 'RECEPTION_PRICE_LOOKUP_RUNTIME_ACL_PASS' AS result;
