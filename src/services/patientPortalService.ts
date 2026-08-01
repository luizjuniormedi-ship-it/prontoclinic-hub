import { supabase } from "@/lib/supabase";
import { z } from "zod";

export interface PatientPortalAppointment {
  id: string;
  appointment_date: string;
  start_time: string;
  end_time: string | null;
  status: string;
  is_return: boolean | null;
  professional_name: string | null;
  unit_name: string | null;
}

export interface PatientPortalRescheduleInput {
  appointmentDate: string;
  startTime: string;
  endTime?: string;
  reason: string;
}

const idSchema = z.union([
  z.string().regex(/^[1-9]\d*$/),
  z.number().int().positive(),
]).transform(String);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/);

const appointmentSchema = z.object({
  id: idSchema,
  appointment_date: dateSchema,
  start_time: timeSchema,
  end_time: timeSchema.nullable(),
  status: z.enum([
    "scheduled",
    "confirmed",
    "completed",
    "cancelled",
    "no_show",
  ]),
  is_return: z.boolean().nullable(),
  professional_name: z.string().trim().min(1).nullable(),
  unit_name: z.string().trim().min(1).nullable(),
}).strict();

function requiredId(value: string, field: string): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error(`${field} inválido.`);
  }
  return normalized;
}

function parseAppointment(value: unknown): PatientPortalAppointment {
  const parsed = appointmentSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Resposta inválida do portal do paciente.");
  }
  return {
    id: parsed.data.id!,
    appointment_date: parsed.data.appointment_date!,
    start_time: parsed.data.start_time!,
    end_time: parsed.data.end_time!,
    status: parsed.data.status!,
    is_return: parsed.data.is_return!,
    professional_name: parsed.data.professional_name!,
    unit_name: parsed.data.unit_name!,
  };
}

function normalizeMutationResult(result: {
  data: unknown;
  error: { message: string } | null;
}): PatientPortalAppointment {
  const { data, error } = result;
  if (error) throw new Error(error.message);
  return parseAppointment(data);
}

export const patientPortalService = {
  async listAppointments(): Promise<PatientPortalAppointment[]> {
    const { data, error } = await supabase.rpc(
      "patient_portal_list_appointments_secure",
    );
    if (error) throw new Error(error.message);
    if (!Array.isArray(data)) {
      throw new Error("Resposta inválida do portal do paciente.");
    }
    return data.map(parseAppointment);
  },

  async confirmAppointment(id: string): Promise<PatientPortalAppointment> {
    return normalizeMutationResult(
      await supabase.rpc("patient_portal_confirm_appointment_secure", {
        p_appointment_id: requiredId(id, "Agendamento"),
      }),
    );
  },

  async cancelAppointment(
    id: string,
    reason?: string,
  ): Promise<PatientPortalAppointment> {
    return normalizeMutationResult(
      await supabase.rpc("patient_portal_cancel_appointment_secure", {
        p_appointment_id: requiredId(id, "Agendamento"),
        p_reason: reason?.trim() || null,
      }),
    );
  },

  async rescheduleAppointment(
    id: string,
    input: PatientPortalRescheduleInput,
  ): Promise<PatientPortalAppointment> {
    const appointmentDate = input.appointmentDate.trim();
    const startTime = input.startTime.trim();
    const reason = input.reason.trim();
    if (!appointmentDate || !startTime) {
      throw new Error("Nova data e horário são obrigatórios.");
    }
    if (reason.length < 3) {
      throw new Error("Informe o motivo do reagendamento.");
    }

    return normalizeMutationResult(
      await supabase.rpc("patient_portal_reschedule_appointment_secure", {
        p_appointment_id: requiredId(id, "Agendamento"),
        p_new_appointment_date: appointmentDate,
        p_new_start_time: startTime,
        p_new_end_time: input.endTime?.trim() || null,
        p_reason: reason,
      }),
    );
  },
};
