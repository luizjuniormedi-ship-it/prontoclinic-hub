DROP POLICY IF EXISTS module_role_permissions_select ON public.role_permissions;

CREATE POLICY module_role_permissions_select
ON public.role_permissions
FOR SELECT TO authenticated
USING (TRUE);

CREATE POLICY module_role_permissions_admin
ON public.role_permissions
FOR ALL TO authenticated
USING (private.is_module_admin())
WITH CHECK (private.is_module_admin());

CREATE OR REPLACE FUNCTION private.is_module_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE (up.id = auth.uid() OR up.user_id = auth.uid())
      AND lower(COALESCE(up.role_name, '')) IN ('admin', 'administrador')
      AND up.lg_ativo = TRUE
      AND (up.access_valid_until IS NULL OR up.access_valid_until > NOW())
      AND up.blocked_at IS NULL
  )
$$;

REVOKE INSERT, UPDATE, DELETE ON public.role_permissions FROM authenticated;
GRANT SELECT ON public.role_permissions TO authenticated;
REVOKE ALL ON FUNCTION private.is_module_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_module_admin() TO authenticated;
