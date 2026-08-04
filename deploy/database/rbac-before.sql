\set ON_ERROR_STOP on

DO $smoke$
BEGIN
  IF current_database() !~ '^prontoclinic' THEN
    RAISE EXCEPTION 'Banco inesperado: %', current_database();
  END IF;
  IF to_regclass('public.role_permissions') IS NULL
     OR to_regprocedure('public.active_company_id()') IS NULL
     OR to_regprocedure('public.current_context_is_company_admin(uuid)') IS NULL
     OR to_regprocedure('private.is_module_admin()') IS NULL THEN
    RAISE EXCEPTION 'Baseline RBAC incompleta';
  END IF;
  IF NOT COALESCE((
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.role_permissions'::regclass
  ), false) THEN
    RAISE EXCEPTION 'RLS de role_permissions deve estar ativo';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'role_permissions'
  ) THEN
    RAISE EXCEPTION 'Baseline inesperada: role_permissions sem policy';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'role_permissions'
      AND policyname NOT IN (
        'role_permissions_select_company',
        'role_permissions_insert_company_admin',
        'role_permissions_update_company_admin',
        'module2_role_permissions_select',
        'module2_role_permissions_admin',
        'role_permissions_active_company_select',
        'module_role_permissions_select',
        'module_role_permissions_admin'
      )
  ) THEN
    RAISE EXCEPTION 'Baseline inesperada: policy desconhecida em role_permissions';
  END IF;
  IF has_table_privilege('authenticated', 'public.role_permissions', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Baseline insegura: authenticated possui escrita direta em role_permissions';
  END IF;
END;
$smoke$;
