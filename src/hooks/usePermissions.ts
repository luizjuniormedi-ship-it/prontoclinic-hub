import { useAuth } from "@/hooks/useAuth";
import { mockSystemUsers, mockPermissionProfiles, mockUserOverrides } from "@/services/adminMockData";

export function usePermissions() {
  const { user } = useAuth();

  const systemUser = user
    ? mockSystemUsers.find((su) => su.email === user.email) || null
    : null;

  const profile = systemUser
    ? mockPermissionProfiles.find((p) => p.id === systemUser.profileId) || null
    : null;

  const overrides = systemUser
    ? mockUserOverrides.find((o) => o.userId === systemUser.id) || null
    : null;

  function hasPermission(moduleKey: string, actionKey: string): boolean {
    if (!profile) return false;

    // Check blocks first
    if (overrides?.blocks[moduleKey]?.includes(actionKey)) return false;

    // Check profile permissions
    if (profile.permissions[moduleKey]?.includes(actionKey)) return true;

    // Check grants
    if (overrides?.grants[moduleKey]?.includes(actionKey)) return true;

    return false;
  }

  function hasModuleAccess(moduleKey: string): boolean {
    if (!profile) return false;
    const profileActions = profile.permissions[moduleKey] || [];
    const grantedActions = overrides?.grants[moduleKey] || [];
    return profileActions.length > 0 || grantedActions.length > 0;
  }

  return { systemUser, profile, hasPermission, hasModuleAccess };
}
