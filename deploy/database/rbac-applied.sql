\set ON_ERROR_STOP on

DO $smoke$
DECLARE
  v_definition text;
BEGIN
  IF NOT COALESCE((
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.role_permissions'::regclass
  ), false) THEN
    RAISE EXCEPTION 'RLS de role_permissions nao esta ativo';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'role_permissions'
      AND qual = 'true'
  ) THEN
    RAISE EXCEPTION 'Policy permissiva USING(TRUE) permanece ativa';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'role_permissions'
      AND policyname = 'module_role_permissions_select'
      AND qual ~ 'active_company_id'
  ) THEN
    RAISE EXCEPTION 'Policy tenant-scoped de leitura ausente';
  END IF;
  IF has_table_privilege('authenticated', 'public.role_permissions', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'authenticated conserva DML direto';
  END IF;
  SELECT pg_get_functiondef(oid) INTO v_definition
  FROM pg_proc
  WHERE oid = 'private.is_module_admin()'::regprocedure;
  IF v_definition !~ 'active_company_id' OR v_definition !~ 'current_context_is_company_admin' THEN
    RAISE EXCEPTION 'Helper administrativo nao exige contexto ativo AAL2';
  END IF;
  IF has_function_privilege('anon', 'private.is_module_admin()', 'EXECUTE')
     OR has_function_privilege('service_role', 'private.is_module_admin()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'private.is_module_admin()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Grants do helper administrativo divergem do contrato';
  END IF;
END;
$smoke$;
