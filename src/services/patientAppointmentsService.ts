import { supabase } from "@/lib/supabase";
import type {
  AppointmentConflictResult,
  PatientAppointmentsFilters,
  PatientAppointmentsTimelineResponse,
} from "@/features/scheduling/patientAppointments";

function toPositiveInteger(value: string | number, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} inválido.`);
  }
  return parsed;
}

export const patientAppointmentsService = {
  async getTimeline(input: {
    patientId: string | number;
    filters?: PatientAppointmentsFilters;
    page?: number;
    pageSize?: number;
  }): Promise<PatientAppointmentsTimelineResponse> {
    const { data, error } = await supabase.rpc(
      "m9_get_patient_appointments_timeline_secure",
      {
        p_patient_id: toPositiveInteger(input.patientId, "Paciente"),
        p_filters: input.filters ?? {},
        p_page: input.page ?? 1,
        p_page_size: input.pageSize ?? 20,
      },
    );
    if (error) {
      throw new Error(`Erro ao consultar agendamentos do paciente: ${error.message}`);
    }
    return data as PatientAppointmentsTimelineResponse;
  },

  async getQuickView(
    patientId: string | number,
  ): Promise<PatientAppointmentsTimelineResponse> {
    const load = (section: "today" | "upcoming" | "history", pageSize: number) =>
      this.getTimeline({
        patientId,
        filters: { section },
        page: 1,
        pageSize,
      });
    const [today, upcoming, history] = await Promise.all([
      load("today", 20),
      load("upcoming", 3),
      load("history", 3),
    ]);
    return {
      ...today,
      groups: [...today.groups, ...upcoming.groups, ...history.groups],
      pagination: {
        page: 1,
        pageSize: 26,
        total:
          today.pagination.total +
          upcoming.pagination.total +
          history.pagination.total,
        totalPages: 1,
      },
    };
  },

  async checkConflicts(input: {
    patientId: string | number;
    appointmentDate: string;
    startTime: string;
    endTime?: string;
    unitId?: string | number;
    professionalId?: string | number;
    specialtyId?: string | number;
    serviceId?: string | number;
    excludeAppointmentId?: string | number;
  }): Promise<AppointmentConflictResult> {
    const optionalId = (value: string | number | undefined, field: string) =>
      value === undefined ? null : toPositiveInteger(value, field);
    const { data, error } = await supabase.rpc(
      "m9_check_patient_appointment_conflicts_secure",
      {
        p_patient_id: toPositiveInteger(input.patientId, "Paciente"),
        p_appointment_date: input.appointmentDate,
        p_start_time: input.startTime,
        p_end_time: input.endTime ?? null,
        p_unit_id: optionalId(input.unitId, "Unidade"),
        p_professional_id: optionalId(input.professionalId, "Profissional"),
        p_specialty_id: optionalId(input.specialtyId, "Especialidade"),
        p_service_id: optionalId(input.serviceId, "Serviço"),
        p_exclude_appointment_id: optionalId(
          input.excludeAppointmentId,
          "Agendamento",
        ),
      },
    );
    if (error) {
      throw new Error(`Erro ao verificar conflitos do paciente: ${error.message}`);
    }
    return data as AppointmentConflictResult;
  },
};
