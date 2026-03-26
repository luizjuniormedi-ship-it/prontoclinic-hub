import { supabase } from "@/lib/supabase";
import { DbAppointment } from "@/services/appointmentsService";

// ── Appointment Validation ──

export interface AppointmentValidationError {
  field?: string;
  message: string;
  type: "error" | "warning";
}

export interface OverlapCheckResult {
  hasOverlap: boolean;
  conflicting?: DbAppointment;
}

/**
 * Validate appointment fields before creating/updating.
 */
export function validateAppointmentFields(input: {
  patient_id?: string;
  professional_id?: string;
  appointment_date?: string;
  start_time?: string;
  end_time?: string;
}): AppointmentValidationError[] {
  const errors: AppointmentValidationError[] = [];

  if (!input.patient_id) {
    errors.push({ field: "patient_id", message: "Paciente é obrigatório.", type: "error" });
  }
  if (!input.professional_id) {
    errors.push({ field: "professional_id", message: "Profissional é obrigatório.", type: "error" });
  }
  if (!input.appointment_date) {
    errors.push({ field: "appointment_date", message: "Data é obrigatória.", type: "error" });
  }
  if (!input.start_time) {
    errors.push({ field: "start_time", message: "Horário de início é obrigatório.", type: "error" });
  }
  if (input.start_time && input.end_time && input.start_time >= input.end_time) {
    errors.push({ field: "end_time", message: "Horário de fim deve ser após o início.", type: "error" });
  }
  if (input.appointment_date) {
    const d = new Date(input.appointment_date + "T00:00:00");
    if (isNaN(d.getTime())) {
      errors.push({ field: "appointment_date", message: "Data inválida.", type: "error" });
    }
  }

  return errors;
}

/**
 * Check for overlapping appointments for the same professional.
 */
export async function checkOverlap(
  professionalId: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeId?: string
): Promise<OverlapCheckResult> {
  // Fetch all appointments for this professional on this date
  let query = supabase
    .from("appointments")
    .select("*")
    .eq("professional_id", professionalId)
    .eq("appointment_date", date)
    .not("status", "in", '("cancelled","no_show")');

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const { data, error } = await query;
  if (error || !data) return { hasOverlap: false };

  // Check for time overlap
  for (const appt of data) {
    const existingStart = appt.start_time;
    const existingEnd = appt.end_time || addMinutes(existingStart, 30);

    // Overlap: new start < existing end AND new end > existing start
    if (startTime < existingEnd && endTime > existingStart) {
      return { hasOverlap: true, conflicting: appt as DbAppointment };
    }
  }

  return { hasOverlap: false };
}

/**
 * Check 30-day return rule for same specialty.
 * Returns null if OK, or info about the blocking rule.
 */
export async function checkReturnRule(
  patientId: string,
  specialtyId: string
): Promise<{
  blocked: boolean;
  lastDate?: string;
  daysPassed?: number;
  availableDate?: string;
}> {
  if (!patientId || !specialtyId) return { blocked: false };

  const { data, error } = await supabase
    .from("appointments")
    .select("appointment_date")
    .eq("patient_id", patientId)
    .eq("specialty_id", specialtyId)
    .eq("status", "completed")
    .order("appointment_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return { blocked: false };

  const lastDate = data.appointment_date;
  const last = new Date(lastDate + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const daysPassed = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));

  if (daysPassed < 30) {
    const available = new Date(last);
    available.setDate(available.getDate() + 30);
    return {
      blocked: true,
      lastDate,
      daysPassed,
      availableDate: available.toISOString().split("T")[0],
    };
  }

  return { blocked: false };
}

// ── Helpers ──

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Standardized error logger + toast message.
 */
export function handleServiceError(error: any, context: string): string {
  const message = error?.message || `Erro em ${context}`;
  console.error(`[${context}]`, error);
  return message;
}
