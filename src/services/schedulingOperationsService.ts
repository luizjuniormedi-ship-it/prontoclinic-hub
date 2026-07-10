import { supabase } from "@/lib/supabase";

export type WaitlistPriority = "low" | "normal" | "high" | "urgent";
export type PreferredPeriod = "any" | "morning" | "afternoon" | "evening";

export interface WaitlistEntry {
  id: number;
  patient_id: number;
  professional_id: number | null;
  specialty_id: number | null;
  appointment_type_id: number | null;
  unit_id: number | null;
  preferred_date_from: string | null;
  preferred_date_to: string | null;
  preferred_period: PreferredPeriod;
  priority: WaitlistPriority;
  status: "waiting" | "contacting" | "converted" | "cancelled" | "expired";
  reason: string;
  notes: string | null;
  created_at: string;
  patient_name?: string;
  patient_phone?: string;
  professional_name?: string;
  specialty_name?: string;
}

export interface ScheduleBlock {
  id: number;
  professional_id: number | null;
  unit_id: number | null;
  starts_at: string;
  ends_at: string;
  block_type: string;
  reason: string;
  status: "active" | "cancelled";
  professional_name?: string;
  unit_name?: string;
}

export interface AvailableSlot {
  start_time: string;
  end_time: string;
  unit_id: number | null;
}

export interface PrecheckIssue {
  id: string;
  kind: "authorization" | "eligibility";
  appointment_id: number | null;
  patient_id: number | null;
  status: string;
  detail: string | null;
  created_at: string;
  patient_name?: string;
}

function requiredNumber(value: string | number | null | undefined, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} inválido.`);
  return parsed;
}

function optionalNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const schedulingOperationsService = {
  async listWaitlist(): Promise<WaitlistEntry[]> {
    const { data, error } = await supabase
      .from("scheduling_waitlist")
      .select("*")
      .in("status", ["waiting", "contacting"])
      .order("created_at", { ascending: true })
      .limit(300);
    if (error) throw new Error(`Erro ao carregar lista de espera: ${error.message}`);

    const rows = (data || []) as WaitlistEntry[];
    const patientIds = [...new Set(rows.map((row) => row.patient_id))];
    const professionalIds = [...new Set(rows.map((row) => row.professional_id).filter(Boolean))] as number[];
    const specialtyIds = [...new Set(rows.map((row) => row.specialty_id).filter(Boolean))] as number[];
    const [patients, professionals, specialties] = await Promise.all([
      patientIds.length ? supabase.from("patients").select("id, full_name, phone").in("id", patientIds) : Promise.resolve({ data: [] }),
      professionalIds.length ? supabase.from("professionals").select("id, full_name").in("id", professionalIds) : Promise.resolve({ data: [] }),
      specialtyIds.length ? supabase.from("specialties").select("id, name").in("id", specialtyIds) : Promise.resolve({ data: [] }),
    ]);
    const patientMap = new Map((patients.data || []).map((row: any) => [Number(row.id), row]));
    const professionalMap = new Map((professionals.data || []).map((row: any) => [Number(row.id), row.full_name]));
    const specialtyMap = new Map((specialties.data || []).map((row: any) => [Number(row.id), row.name]));
    return rows.map((row) => ({
      ...row,
      patient_name: patientMap.get(Number(row.patient_id))?.full_name,
      patient_phone: patientMap.get(Number(row.patient_id))?.phone,
      professional_name: row.professional_id ? professionalMap.get(Number(row.professional_id)) : undefined,
      specialty_name: row.specialty_id ? specialtyMap.get(Number(row.specialty_id)) : undefined,
    }));
  },

  async createWaitlist(input: {
    patientId: string;
    reason: string;
    professionalId?: string;
    specialtyId?: string;
    appointmentTypeId?: string;
    unitId?: string;
    dateFrom?: string;
    dateTo?: string;
    period: PreferredPeriod;
    priority: WaitlistPriority;
    notes?: string;
  }): Promise<WaitlistEntry> {
    const { data, error } = await supabase.rpc("create_waitlist_entry_secure", {
      p_patient_id: requiredNumber(input.patientId, "Paciente"),
      p_reason: input.reason.trim(),
      p_professional_id: optionalNumber(input.professionalId),
      p_specialty_id: optionalNumber(input.specialtyId),
      p_appointment_type_id: optionalNumber(input.appointmentTypeId),
      p_unit_id: optionalNumber(input.unitId),
      p_preferred_date_from: input.dateFrom || null,
      p_preferred_date_to: input.dateTo || null,
      p_preferred_period: input.period,
      p_priority: input.priority,
      p_notes: input.notes?.trim() || null,
    });
    if (error) throw new Error(`Erro ao incluir na lista de espera: ${error.message}`);
    return data as WaitlistEntry;
  },

  async closeWaitlist(id: number, reason: string): Promise<void> {
    const { error } = await supabase.rpc("close_waitlist_entry_secure", {
      p_waitlist_id: id,
      p_status: "cancelled",
      p_reason: reason,
    });
    if (error) throw new Error(`Erro ao encerrar espera: ${error.message}`);
  },

  async convertWaitlist(id: number, date: string, startTime: string, endTime?: string): Promise<void> {
    const { error } = await supabase.rpc("convert_waitlist_to_appointment_secure", {
      p_waitlist_id: id,
      p_appointment_date: date,
      p_start_time: startTime,
      p_end_time: endTime || null,
    });
    if (error) throw new Error(`Erro ao converter espera: ${error.message}`);
  },

  async listBlocks(dateFrom: string, dateTo: string): Promise<ScheduleBlock[]> {
    const { data, error } = await supabase
      .from("scheduling_blocks")
      .select("*")
      .eq("status", "active")
      .gte("ends_at", `${dateFrom}T00:00:00`)
      .lte("starts_at", `${dateTo}T23:59:59`)
      .order("starts_at")
      .limit(300);
    if (error) throw new Error(`Erro ao carregar bloqueios: ${error.message}`);
    return (data || []) as ScheduleBlock[];
  },

  async createBlock(input: { professionalId?: string; unitId?: string; startsAt: string; endsAt: string; reason: string; type: string }): Promise<void> {
    const { error } = await supabase.rpc("create_schedule_block_secure", {
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_reason: input.reason.trim(),
      p_professional_id: optionalNumber(input.professionalId),
      p_unit_id: optionalNumber(input.unitId),
      p_block_type: input.type,
    });
    if (error) throw new Error(`Erro ao criar bloqueio: ${error.message}`);
  },

  async cancelBlock(id: number): Promise<void> {
    const { error } = await supabase.rpc("cancel_schedule_block_secure", { p_block_id: id });
    if (error) throw new Error(`Erro ao cancelar bloqueio: ${error.message}`);
  },

  async getAvailableSlots(professionalId: string, date: string, duration = 30, unitId?: string): Promise<AvailableSlot[]> {
    const { data, error } = await supabase.rpc("get_professional_available_slots", {
      p_professional_id: requiredNumber(professionalId, "Profissional"),
      p_date: date,
      p_duration_minutes: duration,
      p_unit_id: optionalNumber(unitId),
    });
    if (error) throw new Error(`Erro ao calcular horários: ${error.message}`);
    if (!data) return [];
    return (Array.isArray(data) ? data : [data]) as AvailableSlot[];
  },

  async listPrecheckIssues(): Promise<PrecheckIssue[]> {
    const [authorizations, eligibility] = await Promise.all([
      supabase.from("reception_authorizations").select("id, appointment_id, patient_id, status, procedure_desc, created_at").in("status", ["pendente", "solicitada", "em_analise", "reenviada"]).order("created_at").limit(150),
      supabase.from("reception_eligibility_checks").select("id, appointment_id, patient_id, status, result_detail, created_at").in("status", ["pendente", "em_analise", "portal_indisponivel"]).order("created_at").limit(150),
    ]);
    if (authorizations.error) throw new Error(`Erro ao carregar autorizações: ${authorizations.error.message}`);
    if (eligibility.error) throw new Error(`Erro ao carregar elegibilidades: ${eligibility.error.message}`);
    const issues: PrecheckIssue[] = [
      ...(authorizations.data || []).map((row: any) => ({ id: row.id, kind: "authorization" as const, appointment_id: row.appointment_id, patient_id: row.patient_id, status: row.status, detail: row.procedure_desc, created_at: row.created_at })),
      ...(eligibility.data || []).map((row: any) => ({ id: row.id, kind: "eligibility" as const, appointment_id: row.appointment_id, patient_id: row.patient_id, status: row.status, detail: row.result_detail, created_at: row.created_at })),
    ];
    const patientIds = [...new Set(issues.map((row) => row.patient_id).filter(Boolean))] as number[];
    const patients = patientIds.length ? await supabase.from("patients").select("id, full_name").in("id", patientIds) : { data: [] as any[] };
    const patientMap = new Map((patients.data || []).map((row: any) => [Number(row.id), row.full_name]));
    return issues.map((issue) => ({ ...issue, patient_name: issue.patient_id ? patientMap.get(Number(issue.patient_id)) : undefined })).sort((a, b) => a.created_at.localeCompare(b.created_at));
  },
};
