// Central permission map — single source of truth for RBAC
// Role names must match `roles.name` in Supabase

export const ROLES = {
  ADMIN: "admin",
  RECEPCAO: "recepcao",
  MEDICO: "medico",
  FINANCEIRO: "financeiro",
  DIAGNOSTICO: "diagnostico",
  GESTOR: "gestor",
  ADMINISTRATIVO: "administrativo",
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

// "*" means any authenticated user can access
type PermissionEntry = "*" | RoleName[];

// Each key is a route prefix. Order matters: more specific prefixes first.
const routePermissionMap: Record<string, PermissionEntry> = {
  "/": "*",
  "/patients": [ROLES.ADMIN, ROLES.RECEPCAO, ROLES.MEDICO, ROLES.GESTOR],
  "/professionals": [ROLES.ADMIN, ROLES.GESTOR, ROLES.ADMINISTRATIVO],
  "/schedule": [ROLES.ADMIN, ROLES.RECEPCAO, ROLES.MEDICO, ROLES.GESTOR],
  "/callcenter": [ROLES.ADMIN, ROLES.RECEPCAO],
  "/reception": [ROLES.ADMIN, ROLES.RECEPCAO],
  "/records": [ROLES.ADMIN, ROLES.MEDICO],
  "/attendance": [ROLES.ADMIN, ROLES.MEDICO],
  "/worklist": [ROLES.ADMIN, ROLES.DIAGNOSTICO],
  "/pacs": [ROLES.ADMIN, ROLES.DIAGNOSTICO],
  "/dicom": [ROLES.ADMIN, ROLES.DIAGNOSTICO],
  "/financial": [ROLES.ADMIN, ROLES.FINANCEIRO, ROLES.GESTOR],
  "/billing-production": [ROLES.ADMIN, ROLES.FINANCEIRO, ROLES.GESTOR],
  "/professional-payment": [ROLES.ADMIN, ROLES.FINANCEIRO],
  "/settings": [ROLES.ADMIN, ROLES.GESTOR, ROLES.ADMINISTRATIVO],
  "/master-data": [ROLES.ADMIN, ROLES.ADMINISTRATIVO],
  "/companies": [ROLES.ADMIN, ROLES.GESTOR, ROLES.ADMINISTRATIVO],
  "/admin": [ROLES.ADMIN, ROLES.ADMINISTRATIVO],
};

/**
 * Check if a role can access a given path.
 * - `admin` always has access.
 * - `null` role only gets access to routes marked `"*"`.
 * - Matching uses longest-prefix-first.
 */
export function canAccessRoute(roleName: string | null | undefined, path: string): boolean {
  if (roleName === ROLES.ADMIN) return true;

  // Find the best matching prefix (longest first)
  const sortedPrefixes = Object.keys(routePermissionMap).sort(
    (a, b) => b.length - a.length
  );

  for (const prefix of sortedPrefixes) {
    const matches = prefix === "/" ? path === "/" : path.startsWith(prefix);
    if (matches) {
      const entry = routePermissionMap[prefix];
      if (entry === "*") return true;
      if (!roleName) return false;
      return entry.includes(roleName as RoleName);
    }
  }

  // No matching rule — deny by default
  return false;
}

/**
 * Get all route prefixes a role can access (for sidebar filtering).
 */
export function getAccessiblePrefixes(roleName: string | null | undefined): string[] {
  if (roleName === ROLES.ADMIN) return Object.keys(routePermissionMap);

  return Object.entries(routePermissionMap)
    .filter(([, entry]) => {
      if (entry === "*") return true;
      if (!roleName) return false;
      return entry.includes(roleName as RoleName);
    })
    .map(([prefix]) => prefix);
}
