import { useAuth } from "@/hooks/useAuth";
import { canAccessRoute } from "@/config/routePermissions";
import { useActiveAccessRole } from "@/hooks/useActiveAccessRole";

export function usePermissionGate(path: string) {
  const { user, isLoading } = useAuth();
  const roleName = useActiveAccessRole(user?.role_name);
  const allowed = canAccessRoute(roleName, path);

  if (!isLoading && !allowed) {
    console.warn(`[ACCESS_DENIED] role=${roleName} path=${path} user=${user?.email}`);
  }

  return { allowed, roleName, isLoading };
}
