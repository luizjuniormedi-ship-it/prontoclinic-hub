-- Close the legacy permissive RBAC path. Administrative writes remain behind
-- upsert_role_permission(), which already requires active context and AAL2.

BEGIN;

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_permissions_select_company ON public.role_permissions;
DROP POLICY IF EXISTS role_permissions_insert_company_admin ON public.role_permissions;
DROP POLICY IF EXISTS role_permissions_update_company_admin ON public.role_permissions;
DROP POLICY IF EXISTS module2_role_permissions_select ON public.role_permissions;
DROP POLICY IF EXISTS module2_role_permissions_admin ON public.role_permissions;
DROP POLICY IF EXISTS role_permissions_active_company_select ON public.role_permissions;
DROP POLICY IF EXISTS module_role_permissions_select ON public.role_permissions;
DROP POLICY IF EXISTS module_role_permissions_admin ON public.role_permissions;

CREATE POLICY module_role_permissions_select
ON public.role_permissions
FOR SELECT TO authenticated
USING (company_id = public.active_company_id());

REVOKE INSERT, UPDATE, DELETE ON public.role_permissions FROM authenticated;
GRANT SELECT ON public.role_permissions TO authenticated;

CREATE OR REPLACE FUNCTION private.is_module_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
  SELECT public.active_company_id() IS NOT NULL
     AND public.current_context_is_company_admin(public.active_company_id())
$$;

REVOKE ALL ON FUNCTION private.is_module_admin() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.is_module_admin() TO authenticated;

COMMENT ON FUNCTION private.is_module_admin() IS
  'True only for an active AAL2 application context with an administrative role in the active company.';

COMMIT;
