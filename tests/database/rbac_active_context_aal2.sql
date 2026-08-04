\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_policy_count INTEGER;
  v_definition TEXT;
BEGIN
  SELECT count(*)
  INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'role_permissions';

  IF v_policy_count <> 1 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: role_permissions deve possuir exatamente uma policy, encontrou %', v_policy_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'role_permissions'
      AND policyname = 'module_role_permissions_select'
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND qual LIKE '%active_company_id()%'
      AND COALESCE(with_check, '') = ''
  ) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: policy de leitura contextual não foi instalada corretamente';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'role_permissions'
      AND (lower(COALESCE(qual, '')) IN ('true', '(true)')
        OR lower(COALESCE(with_check, '')) IN ('true', '(true)'))
  ) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: role_permissions mantém policy permissiva';
  END IF;

  IF has_table_privilege('authenticated', 'public.role_permissions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.role_permissions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.role_permissions', 'DELETE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: authenticated mantém escrita direta em role_permissions';
  END IF;

  SELECT pg_get_functiondef('private.is_module_admin()'::regprocedure)
  INTO v_definition;

  IF v_definition NOT LIKE '%active_company_id()%'
     OR v_definition NOT LIKE '%current_context_is_company_admin%'
     OR v_definition NOT LIKE '%SET row_security TO ''off''%' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: helper administrativo não exige contexto ativo e AAL2';
  END IF;
END;
$$;

ROLLBACK;
