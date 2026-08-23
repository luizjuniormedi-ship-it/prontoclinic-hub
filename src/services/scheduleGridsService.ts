import { supabase } from "@/lib/supabase";

export type ScheduleGridStatus = "draft" | "published" | "suspended";

type CanonicalScheduleRule = {
  id: number;
  grade_id: number;
  day_of_week: number;
  starts_at: string;
  ends_at: string;
  service_id: number | null;
  duration_minutes: number | null;
  capacity: number | null;
  room_id: number | null;
  equipment_id: number | null;
  status: "active" | "inactive";
};

export interface ProfessionalScheduleGrid {
  id: number;
  company_id: string;
  unit_id: number;
  professional_id: number;
  specialty_id: number | null;
  service_id: number | null;
  room_id: number | null;
  equipment_id: number | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  valid_from: string;
  valid_until: string | null;
  status: ScheduleGridStatus;
  max_concurrent: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleResource {
  id: number;
  unit_id: number;
  name: string;
  resource_type: "room" | "equipment" | string;
}

export interface ScheduleGridInput {
  id?: number;
  professionalId: string;
  unitId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  validFrom: string;
  validUntil?: string;
  specialtyId?: string;
  serviceId?: string;
  roomId?: string;
  equipmentId?: string;
  maxConcurrent: number;
  notes?: string;
}

function optionalNumber(value: string | undefined): number | null {
  if (!value || value === "none") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("Identificador inválido.");
  return parsed;
}

function requiredNumber(value: string, field: string): number {
  const parsed = optionalNumber(value);
  if (parsed === null) throw new Error(`${field} é obrigatório.`);
  return parsed;
}

export function normalizeProfessionalScheduleGrid(
  row: ProfessionalScheduleGrid,
): ProfessionalScheduleGrid {
  return {
    ...row,
    id: Number(row.id),
    unit_id: Number(row.unit_id),
    professional_id: Number(row.professional_id),
    specialty_id: row.specialty_id === null ? null : Number(row.specialty_id),
    service_id: row.service_id === null ? null : Number(row.service_id),
    room_id: row.room_id === null ? null : Number(row.room_id),
    equipment_id: row.equipment_id === null ? null : Number(row.equipment_id),
    day_of_week: Number(row.day_of_week),
    slot_duration_minutes: Number(row.slot_duration_minutes),
    max_concurrent: Number(row.max_concurrent),
  };
}

function bundleToGrid(bundle: unknown): ProfessionalScheduleGrid {
  if (!bundle || typeof bundle !== "object") {
    throw new Error("Resposta inválida da grade canônica.");
  }
  const value = bundle as { grade?: Record<string, unknown>; rules?: CanonicalScheduleRule[] };
  const grade = value.grade;
  const rule = value.rules?.[0];
  if (!grade || !rule) throw new Error("A grade precisa conter ao menos uma regra de horário.");

  return normalizeProfessionalScheduleGrid({
    id: grade.id as number,
    company_id: grade.company_id as string,
    unit_id: grade.unit_id as number,
    professional_id: grade.professional_id as number,
    specialty_id: (grade.specialty_id as number | null) ?? null,
    service_id: rule.service_id,
    room_id: rule.room_id,
    equipment_id: rule.equipment_id,
    day_of_week: rule.day_of_week,
    start_time: rule.starts_at,
    end_time: rule.ends_at,
    slot_duration_minutes: rule.duration_minutes ?? (grade.default_duration_minutes as number),
    valid_from: grade.valid_from as string,
    valid_until: (grade.valid_until as string | null) ?? null,
    status: grade.status as ScheduleGridStatus,
    max_concurrent: rule.capacity ?? (grade.default_capacity as number),
    notes: null,
    created_at: grade.created_at as string,
    updated_at: grade.updated_at as string,
  });
}

function idempotencyKey(input: ScheduleGridInput): string {
  return `schedule-grid-${input.id ?? "new"}-${input.professionalId}-${input.unitId}-${input.validFrom}`;
}

export const scheduleGridsService = {
  async list(): Promise<ProfessionalScheduleGrid[]> {
    const [gradesResult, rulesResult] = await Promise.all([
      supabase
        .from("professional_schedule_grades")
        .select("*")
        .order("professional_id")
        .order("valid_from"),
      supabase
        .from("professional_schedule_rules")
        .select("*")
        .eq("status", "active")
        .order("day_of_week")
        .order("starts_at"),
    ]);
    if (gradesResult.error) throw new Error(`Erro ao carregar grades: ${gradesResult.error.message}`);
    if (rulesResult.error) throw new Error(`Erro ao carregar horários: ${rulesResult.error.message}`);

    const rulesByGrade = new Map<number, CanonicalScheduleRule[]>();
    for (const rule of (rulesResult.data || []) as CanonicalScheduleRule[]) {
      const current = rulesByGrade.get(Number(rule.grade_id)) || [];
      current.push(rule);
      rulesByGrade.set(Number(rule.grade_id), current);
    }
    return ((gradesResult.data || []) as Record<string, unknown>[]).flatMap((grade) =>
      (rulesByGrade.get(Number(grade.id)) || []).map((rule) => bundleToGrid({ grade, rules: [rule] })),
    );
  },

  async listResources(): Promise<ScheduleResource[]> {
    const { data, error } = await supabase
      .from("organizational_resources")
      .select("id, unit_id, name, resource_type")
      .eq("status", "active")
      .in("resource_type", ["room", "equipment"])
      .order("name");
    if (error) throw new Error(`Erro ao carregar salas e equipamentos: ${error.message}`);
    return (data || []) as ScheduleResource[];
  },

  async save(input: ScheduleGridInput): Promise<ProfessionalScheduleGrid> {
    const { data, error } = await supabase.rpc(
      "m9_save_professional_schedule_grade_secure",
      {
        p_grade: {
          id: input.id || null,
          professionalId: requiredNumber(input.professionalId, "Profissional"),
          unitId: requiredNumber(input.unitId, "Unidade"),
          specialtyId: optionalNumber(input.specialtyId),
          name: `Grade profissional ${input.professionalId}`,
          modality: "in_person",
          validFrom: input.validFrom,
          validUntil: input.validUntil || null,
          status: "draft",
          defaultDurationMinutes: input.durationMinutes,
          defaultCapacity: input.maxConcurrent,
          defaultRoomId: optionalNumber(input.roomId),
          defaultEquipmentId: optionalNumber(input.equipmentId),
        },
        p_rules: [{
          dayOfWeek: input.dayOfWeek,
          startsAt: input.startTime,
          endsAt: input.endTime,
          serviceId: optionalNumber(input.serviceId),
          durationMinutes: input.durationMinutes,
          capacity: input.maxConcurrent,
          roomId: optionalNumber(input.roomId),
          equipmentId: optionalNumber(input.equipmentId),
          allowReturn: true,
          allowWalkin: false,
          status: "active",
        }],
        p_idempotency_key: idempotencyKey(input),
      },
    );
    if (error) throw new Error(`Erro ao salvar grade: ${error.message}`);
    return bundleToGrid(data);
  },

  async setStatus(
    id: number,
    status: ScheduleGridStatus,
    reason?: string,
  ): Promise<ProfessionalScheduleGrid> {
    const action = status === "published" ? "publish" : status === "suspended" ? "suspend" : "cancel";
    const { data, error } = await supabase.rpc(
      "m9_publish_schedule_grade_secure",
      {
        p_grade_id: id,
        p_action: action,
        p_reason: reason?.trim() || (action === "cancel" ? "Cancelamento solicitado pelo operador" : null),
        p_idempotency_key: `schedule-transition-${id}-${action}-${Date.now()}`,
      },
    );
    if (error) throw new Error(`Erro ao alterar status da grade: ${error.message}`);
    return bundleToGrid(data);
  },
};
