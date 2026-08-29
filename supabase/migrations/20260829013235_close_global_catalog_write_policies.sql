BEGIN;

-- Global notification templates are deployment-controlled catalog data.
-- Tenant operators may read them, but cannot mutate or promote tenant rows to
-- global scope through a permissive policy or a future table grant.
DROP POLICY IF EXISTS notification_templates_admin_write
  ON public.notification_templates;
REVOKE INSERT, UPDATE, DELETE ON public.notification_templates
  FROM PUBLIC, anon, authenticated, app_prontomedic;

-- Global roles are also deployment-controlled. Tenant assignments and the
-- permission matrix continue through their scoped administrative RPCs.
DROP POLICY IF EXISTS module_roles_admin ON public.roles;
DROP POLICY IF EXISTS roles_select_authenticated ON public.roles;
REVOKE INSERT, UPDATE, DELETE ON public.roles
  FROM PUBLIC, anon, authenticated, app_prontomedic;

DROP POLICY IF EXISTS module2_role_permissions_admin
  ON public.role_permissions;
DROP POLICY IF EXISTS module_role_permissions_admin
  ON public.role_permissions;
REVOKE INSERT, UPDATE, DELETE ON public.role_permissions
  FROM PUBLIC, anon, authenticated, app_prontomedic;

-- Password reset material is accessed only by guarded functions. Permissive
-- policies here are misleading because they are OR-combined and can become
-- reachable after an unrelated grant.
DROP POLICY IF EXISTS "Users can read own password_resets"
  ON public.password_resets;
DROP POLICY IF EXISTS "Service role can insert password_resets"
  ON public.password_resets;
DROP POLICY IF EXISTS "Service role can update password_resets"
  ON public.password_resets;
DROP POLICY IF EXISTS password_resets_no_client_access
  ON public.password_resets;
REVOKE ALL ON public.password_resets
  FROM PUBLIC, anon, authenticated, app_prontomedic;

COMMIT;
