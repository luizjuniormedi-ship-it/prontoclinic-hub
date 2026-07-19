import type { RolePermission } from "@/services/rolePermissionsService";

export type PermissionEffect = "grant" | "deny";

export interface UserPermissionOverride {
  module: string;
  action: string;
  effect: PermissionEffect;
  unit_id?: number | null;
  sector_code?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
}

export interface PermissionDelegation {
  module: string;
  actions: string[];
  approval_status: "pending" | "approved" | "rejected" | "revoked";
  starts_at: string;
  ends_at: string;
  unit_id?: number | null;
}

export interface PermissionContext {
  module: string;
  action: string;
  unitId?: number | null;
  sectorCode?: string | null;
  at?: Date;
  rolePermission?: RolePermission | null;
  overrides?: UserPermissionOverride[];
  delegations?: PermissionDelegation[];
}

function isActiveWindow(from: string | null | undefined, until: string | null | undefined, at: Date): boolean {
  const start = from ? new Date(from).getTime() : Number.NEGATIVE_INFINITY;
  const end = until ? new Date(until).getTime() : Number.POSITIVE_INFINITY;
  return Number.isFinite(start) && start > at.getTime() ? false : end > at.getTime();
}

function scopeMatches(item: { unit_id?: number | null; sector_code?: string | null }, context: PermissionContext): boolean {
  if (item.unit_id != null && item.unit_id !== context.unitId) return false;
  if (item.sector_code && item.sector_code !== context.sectorCode) return false;
  return true;
}

/** Resolves one action with deny precedence over role, grants and delegations. */
export function resolvePermission(context: PermissionContext): boolean {
  const at = context.at ?? new Date();
  const roleAllowed = Boolean(context.rolePermission?.[`can_${context.action}` as keyof RolePermission]);
  const activeOverrides = (context.overrides ?? []).filter((override) =>
    override.module === context.module && override.action === context.action &&
    scopeMatches(override, context) && isActiveWindow(override.valid_from, override.valid_until, at),
  );

  if (activeOverrides.some((override) => override.effect === "deny")) return false;
  if (roleAllowed || activeOverrides.some((override) => override.effect === "grant")) return true;

  return (context.delegations ?? []).some((delegation) =>
    delegation.module === context.module && delegation.actions.includes(context.action) &&
    delegation.approval_status === "approved" &&
    scopeMatches(delegation, context) &&
    isActiveWindow(delegation.starts_at, delegation.ends_at, at),
  );
}
