import { supabase } from "@/lib/supabase";

export type ScheduleGridStatus = "draft" | "published" | "suspended";

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

export const scheduleGridsService = {
  async list(): Promise<ProfessionalScheduleGrid[]> {
    const { data, error } = await supabase
      .from("professional_schedule_grids")
      .select("*")
      .order("professional_id")
      .order("day_of_week")
      .order("start_time");
    if (error) throw new Error(`Erro ao carregar grades: ${error.message}`);
    return ((data || []) as ProfessionalScheduleGrid[]).map(
      normalizeProfessionalScheduleGrid,
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
      "upsert_professional_schedule_grid_secure",
      {
        p_grid_id: input.id || null,
        p_professional_id: requiredNumber(input.professionalId, "Profissional"),
        p_unit_id: requiredNumber(input.unitId, "Unidade"),
        p_day_of_week: input.dayOfWeek,
        p_start_time: input.startTime,
        p_end_time: input.endTime,
        p_slot_duration_minutes: input.durationMinutes,
        p_valid_from: input.validFrom,
        p_valid_until: input.validUntil || null,
        p_specialty_id: optionalNumber(input.specialtyId),
        p_service_id: optionalNumber(input.serviceId),
        p_room_id: optionalNumber(input.roomId),
        p_equipment_id: optionalNumber(input.equipmentId),
        p_max_concurrent: input.maxConcurrent,
        p_notes: input.notes?.trim() || null,
      },
    );
    if (error) throw new Error(`Erro ao salvar grade: ${error.message}`);
    return normalizeProfessionalScheduleGrid(data as ProfessionalScheduleGrid);
  },

  async setStatus(
    id: number,
    status: ScheduleGridStatus,
    reason?: string,
  ): Promise<ProfessionalScheduleGrid> {
    const { data, error } = await supabase.rpc(
      "set_professional_schedule_grid_status_secure",
      {
        p_grid_id: id,
        p_status: status,
        p_reason: reason?.trim() || null,
      },
    );
    if (error) throw new Error(`Erro ao alterar status da grade: ${error.message}`);
    return normalizeProfessionalScheduleGrid(data as ProfessionalScheduleGrid);
  },
};
