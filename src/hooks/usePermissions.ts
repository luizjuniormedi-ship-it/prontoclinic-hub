import { useAuth } from "@/hooks/useAuth";
import { canAccessRoute } from "@/config/routePermissions";

export function usePermissions() {
  const { user } = useAuth();
  const roleName = user?.role_name ?? null;

  function hasPermission(moduleKey: string, _actionKey: string): boolean {
    return canAccessRoute(roleName, `/${moduleKey}`);
  }

  function hasModuleAccess(moduleKey: string): boolean {
    return canAccessRoute(roleName, `/${moduleKey}`);
  }

  return { systemUser: user, profile: null, hasPermission, hasModuleAccess };
}
