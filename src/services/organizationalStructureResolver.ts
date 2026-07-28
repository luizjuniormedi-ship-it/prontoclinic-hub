export interface OrganizationUnitOption {
  id: number;
  name: string;
  active?: boolean;
}

export interface ScopedOrganizationRecord {
  unit_id: number;
  status?: string | null;
  lg_ativo?: boolean | null;
}

/** Selects the first valid unit without allowing a stale unit to leak scope. */
export function resolveInitialUnit(
  units: OrganizationUnitOption[],
  preferredUnitId: number | null | undefined,
): number | null {
  const active = units.filter((unit) => unit.active !== false);
  if (preferredUnitId !== null && preferredUnitId !== undefined && active.some((unit) => unit.id === preferredUnitId)) {
    return preferredUnitId;
  }
  return active[0]?.id ?? null;
}

/** Keeps the UI deterministic and aligned with the selected unit. */
export function scopeOrganizationRecords<T extends ScopedOrganizationRecord>(records: T[], unitId: number): T[] {
  return records
    .filter((record) => record.unit_id === unitId)
    .filter((record) => record.lg_ativo !== false && record.status !== "inactive")
    .slice()
    .sort((left, right) => left.unit_id - right.unit_id);
}
