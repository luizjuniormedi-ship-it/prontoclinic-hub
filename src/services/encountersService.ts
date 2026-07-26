/**
 * Compatibility facade for the former `encounters` module.
 *
 * The canonical clinical contracts are:
 * - appointments: operational attendance queue;
 * - medical_records/finalize_attendance_secure: clinical record and attendance;
 * - log_data_access: sensitive-data audit trail.
 *
 * There is intentionally no query or write against a synthetic `encounters`
 * table. The facade keeps the route stable while the UI points to the canonical
 * attendance and records flows.
 */
import { auditService } from "@/services/auditService";
import { supabase } from "@/lib/supabase";

export type EncounterStatus =
  | "scheduled"
  | "confirmed"
  | "waiting"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export interface Encounter {
  id: string;
  appointment_id: string;
  patient_id: string | null;
  professional_id: string | null;
  encounter_type: string;
  status: EncounterStatus | string;
  appointment_date: string;
  start_time: string;
  created_at: string;
  patient_name?: string;
}

interface AppointmentRow {
  id: string | number;
  patient_id: string | number | null;
  professional_id: string | number | null;
  appointment_date: string;
  start_time: string;
  status: string;
  service_name: string | null;
  tipo?: string | null;
  created_at: string;
}

interface MedicalRecordTimelineRow {
  id: string | number;
  record_date: string;
  anamnesis: string | null;
  evolution: string | null;
  professional_id: string | number | null;
}

export const ENC_STATUS_LABELS: Record<string, string> = {
  scheduled: "Agendado",
  confirmed: "Confirmado",
  waiting: "Aguardando atendimento",
  in_progress: "Em atendimento",
  completed: "Finalizado",
  cancelled: "Cancelado",
  no_show: "Faltou",
};

function appointmentTimestamp(row: AppointmentRow): string {
  if (row.appointment_date && row.start_time) {
    return `${row.appointment_date}T${row.start_time}`;
  }
  return row.created_at;
}

function mapAppointment(row: AppointmentRow, patientName?: string): Encounter {
  return {
    id: String(row.id),
    appointment_id: String(row.id),
    patient_id: row.patient_id == null ? null : String(row.patient_id),
    professional_id: row.professional_id == null ? null : String(row.professional_id),
    encounter_type: row.service_name || row.tipo || "Atendimento",
    status: row.status,
    appointment_date: row.appointment_date,
    start_time: row.start_time,
    created_at: appointmentTimestamp(row),
    patient_name: patientName,
  };
}

async function patientNames(patientIds: string[]): Promise<Record<string, string>> {
  if (patientIds.length === 0) return {};

  const { data, error } = await supabase
    .from("patients")
    .select("id, full_name")
    .in("id", patientIds);

  if (error) throw new Error(`Erro ao identificar pacientes dos atendimentos: ${error.message}`);

  return Object.fromEntries(
    (data || []).map((patient: { id: string | number; full_name: string }) => [
      String(patient.id),
      patient.full_name,
    ]),
  );
}

export const encountersService = {
  async list(filters?: { status?: string; patient_id?: string | number }): Promise<Encounter[]> {
    let query = supabase
      .from("appointments")
      .select(
        "id, patient_id, professional_id, appointment_date, start_time, status, service_name, tipo, created_at",
      );

    if (filters?.status) query = query.eq("status", filters.status);
    if (filters?.patient_id != null) query = query.eq("patient_id", filters.patient_id);

    const { data, error } = await query
      .order("appointment_date", { ascending: false })
      .order("start_time", { ascending: false })
      .limit(200);
    if (error) throw new Error(`Erro ao buscar atendimentos: ${error.message}`);

    const rows = (data || []) as AppointmentRow[];
    const ids = [...new Set(
      rows
        .map((row) => row.patient_id)
        .filter((id): id is string | number => id != null)
        .map(String),
    )];
    const names = await patientNames(ids);

    return rows.map((row) =>
      mapAppointment(row, row.patient_id == null ? undefined : names[String(row.patient_id)]),
    );
  },

  async get(id: string): Promise<Encounter | null> {
    const { data, error } = await supabase
      .from("appointments")
      .select(
        "id, patient_id, professional_id, appointment_date, start_time, status, service_name, tipo, created_at",
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`Erro ao buscar atendimento: ${error.message}`);
    if (!data) return null;

    const row = data as AppointmentRow;
    const names = await patientNames(row.patient_id == null ? [] : [String(row.patient_id)]);
    return mapAppointment(
      row,
      row.patient_id == null ? undefined : names[String(row.patient_id)],
    );
  },

  async timeline(patientId: string | number): Promise<Array<{
    event_type: string;
    event_id: string;
    event_date: string | null;
    title: string | null;
    detail: string | null;
    professional: string | null;
  }>> {
    const { data, error } = await supabase
      .from("medical_records")
      .select("id, record_date, anamnesis, evolution, professional_id")
      .eq("patient_id", patientId)
      .order("record_date", { ascending: false })
      .limit(200);

    if (error) throw new Error(`Erro ao carregar a timeline clínica: ${error.message}`);

    return ((data || []) as MedicalRecordTimelineRow[]).map((record) => ({
      event_type: "medical_record",
      event_id: String(record.id),
      event_date: record.record_date,
      title: "Registro clínico",
      detail: record.evolution || record.anamnesis,
      professional: record.professional_id == null ? null : String(record.professional_id),
    }));
  },

  async prescriptions(patientId: string | number): Promise<Array<{
    id: number;
    ds_prescricao: string | null;
    dt_prescricao: string | null;
  }>> {
    const { data, error } = await supabase
      .from("medical_records")
      .select("id, record_date, evolution")
      .eq("patient_id", patientId)
      .order("record_date", { ascending: false })
      .limit(50);

    if (error) throw new Error(`Erro ao carregar prescrições: ${error.message}`);

    return ((data || []) as Array<{
      id: string | number;
      record_date: string;
      evolution: string | null;
    }>)
      .map((record) => {
        const prescription = record.evolution?.match(
          /\*\*Prescrição:\*\*\s*([\s\S]*?)(?=\n\n\*\*|$)/i,
        )?.[1]?.trim();
        return {
          id: Number(record.id),
          ds_prescricao: prescription || null,
          dt_prescricao: record.record_date,
        };
      })
      .filter((record) => Boolean(record.ds_prescricao));
  },

  async logAccess(
    patientId: string | number,
    action: string,
    options?: { encounter_id?: string; emergency?: boolean; justificativa?: string },
  ): Promise<void> {
    await auditService.logApiAccess("patients", String(patientId), action, {
      appointment_id: options?.encounter_id,
      emergency: options?.emergency ?? false,
      justificativa: options?.justificativa,
    });
  },
};
