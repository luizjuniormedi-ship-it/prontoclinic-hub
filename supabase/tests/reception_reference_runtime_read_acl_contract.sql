\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT has_table_privilege('app_prontomedic', 'public.specialties', 'SELECT')
     OR NOT has_table_privilege('app_prontomedic', 'public.insurance_plans', 'SELECT') THEN
    RAISE EXCEPTION 'runtime da Recepcao sem leitura dos catalogos obrigatorios';
  END IF;

  IF has_table_privilege('app_prontomedic', 'public.specialties', 'INSERT')
     OR has_table_privilege('app_prontomedic', 'public.specialties', 'UPDATE')
     OR has_table_privilege('app_prontomedic', 'public.specialties', 'DELETE')
     OR has_table_privilege('app_prontomedic', 'public.insurance_plans', 'INSERT')
     OR has_table_privilege('app_prontomedic', 'public.insurance_plans', 'UPDATE')
     OR has_table_privilege('app_prontomedic', 'public.insurance_plans', 'DELETE') THEN
    RAISE EXCEPTION 'runtime da Recepcao manteve escrita direta em catalogos';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = 'public.insurance_plans'::regclass
      AND relrowsecurity
      AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'insurance_plans sem FORCE RLS';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'insurance_plans'
      AND policyname = 'insurance_plans_app_runtime_select'
      AND cmd = 'SELECT'
      AND 'app_prontomedic' = ANY (roles)
  ) THEN
    RAISE EXCEPTION 'policy de leitura multiempresa dos planos ausente';
  END IF;
END;
$$;

SELECT 'RECEPTION_REFERENCE_RUNTIME_READ_ACL_PASS' AS result;
