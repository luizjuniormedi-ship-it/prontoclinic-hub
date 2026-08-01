export type ScheduleResourceKind = "professional" | "room" | "equipment";

export interface AvailabilityRecord {
  id: string | number;
  companyId?: string | number | null;
  unitId?: string | number | null;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  professionalId?: string | number | null;
  roomId?: string | number | null;
  equipmentId?: string | number | null;
  status?: string | null;
}

export interface AvailabilityConflict {
  appointmentId: string | number;
  scope: ScheduleResourceKind;
  startTime: string;
  endTime: string;
}

const INACTIVE_STATUSES = new Set(["cancelled", "cancelado", "no_show", "no-show", "noshow"]);

function normalizeId(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function timeToSeconds(value: string): number {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) throw new Error(`Horário inválido: ${value}`);

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  if (hours > 23 || minutes > 59 || seconds > 59) {
    throw new Error(`Horário inválido: ${value}`);
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function sameScope(left: AvailabilityRecord, right: AvailabilityRecord): boolean {
  if (left.appointmentDate !== right.appointmentDate) return false;

  const leftCompany = normalizeId(left.companyId);
  const rightCompany = normalizeId(right.companyId);
  return !leftCompany || !rightCompany || leftCompany === rightCompany;
}

function overlaps(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return leftStart < rightEnd && leftEnd > rightStart;
}

function sameResource(
  left: AvailabilityRecord,
  right: AvailabilityRecord,
  field: "professionalId" | "roomId" | "equipmentId",
): boolean {
  const leftId = normalizeId(left[field]);
  const rightId = normalizeId(right[field]);
  return Boolean(leftId && rightId && leftId === rightId);
}

/**
 * Resolves conflicts for a single day. The database RPC remains authoritative
 * for writes; this resolver is for deterministic availability and UI decisions.
 */
export function findAvailabilityConflicts(
  records: AvailabilityRecord[],
  candidate: AvailabilityRecord,
): AvailabilityConflict[] {
  const candidateStart = timeToSeconds(candidate.startTime);
  const candidateEnd = timeToSeconds(candidate.endTime);
  if (candidateEnd <= candidateStart) {
    throw new Error("O horário final deve ser posterior ao horário inicial.");
  }

  return records
    .filter((record) => normalizeId(record.id) !== normalizeId(candidate.id))
    .filter((record) => !INACTIVE_STATUSES.has((record.status || "").toLowerCase()))
    .filter((record) => sameScope(record, candidate))
    .filter((record) => {
      const recordStart = timeToSeconds(record.startTime);
      const recordEnd = timeToSeconds(record.endTime);
      if (recordEnd <= recordStart) return false;
      return overlaps(candidateStart, candidateEnd, recordStart, recordEnd);
    })
    .flatMap((record) => {
      const scopes: AvailabilityConflict[] = [];
      if (sameResource(record, candidate, "professionalId")) {
        scopes.push({ appointmentId: record.id, scope: "professional", startTime: record.startTime, endTime: record.endTime });
      }
      if (sameResource(record, candidate, "roomId")) {
        scopes.push({ appointmentId: record.id, scope: "room", startTime: record.startTime, endTime: record.endTime });
      }
      if (sameResource(record, candidate, "equipmentId")) {
        scopes.push({ appointmentId: record.id, scope: "equipment", startTime: record.startTime, endTime: record.endTime });
      }
      return scopes;
    })
    .sort((left, right) => timeToSeconds(left.startTime) - timeToSeconds(right.startTime));
}

export function isAvailabilitySlotFree(
  records: AvailabilityRecord[],
  candidate: AvailabilityRecord,
): boolean {
  return findAvailabilityConflicts(records, candidate).length === 0;
}
