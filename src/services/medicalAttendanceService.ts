import { supabase } from "@/lib/supabase";

export interface MedicalEncounter {
  id: string;
  company_id: string;
  unit_id: number | null;
  patient_id: number;
  professional_id: number | null;
  appointment_id: number | null;
  status: string;
  signed_at: string | null;
  finalized_at: string | null;
  chief_complaint: string | null;
  anamnesis: string | null;
  physical_exam: string | null;
  vital_signs: Record<string, unknown>;
  diagnoses: unknown[];
  conduct: string | null;
  procedures: unknown[];
  prescriptions: unknown[];
  exams: unknown[];
  certificate: Record<string, unknown> | null;
  referral: Record<string, unknown> | null;
  return_plan: string | null;
  discharge_summary: string | null;
  admission_plan: string | null;
}

export interface MedicalAttendancePayload {
  chief_complaint?: string;
  anamnesis?: string;
  physical_exam?: string;
  vital_signs?: Record<string, unknown>;
  diagnoses?: unknown[];
  conduct?: string;
  procedures?: unknown[];
  prescriptions?: unknown[];
  exams?: unknown[];
  certificate?: Record<string, unknown> | null;
  referral?: Record<string, unknown> | null;
  return_plan?: string;
  discharge_summary?: string;
  admission_plan?: string;
}

export interface MedicalAttendanceBillingHandoff {
  billing_id: number;
  billing_account_id: string;
  billing_type: string;
  gross_amount: number;
  price_found: boolean;
  appointment_id?: number;
}

export interface FinalizeAppointmentWithBillingResult {
  encounter: MedicalEncounter;
  billing: MedicalAttendanceBillingHandoff;
}

const IMMUTABLE_ATTENDANCE_STATUSES = new Set([
  "finalizado",
  "finalized",
  "assinado",
  "signed",
  "alta_ambulatorial",
  "discharged",
  "encaminhado",
  "referred",
  "internado",
  "admitted",
]);

export function isMedicalEncounterImmutable(encounter: Pick<MedicalEncounter, "status" | "signed_at" | "finalized_at">): boolean {
  return Boolean(
    encounter.signed_at
    || encounter.finalized_at
    || IMMUTABLE_ATTENDANCE_STATUSES.has(encounter.status.toLowerCase()),
  );
}

function assertEditableEncounter(data: unknown): MedicalEncounter {
  if (!data || typeof data !== "object" || typeof (data as MedicalEncounter).id !== "string") {
    throw new Error("Resposta inválida ao abrir atendimento.");
  }
  const encounter = data as MedicalEncounter;
  if (isMedicalEncounterImmutable(encounter)) {
    throw new Error("Atendimento finalizado ou assinado é somente leitura.");
  }
  return encounter;
}

function assertFinalizeAppointmentResult(
  data: unknown,
  appointmentId: number,
): FinalizeAppointmentWithBillingResult {
  if (!data || typeof data !== "object") {
    throw new Error("Resposta inválida ao concluir atendimento e faturamento.");
  }
  const result = data as Partial<FinalizeAppointmentWithBillingResult>;
  if (
    !result.encounter
    || result.encounter.appointment_id !== appointmentId
    || !result.billing
    || typeof result.billing.billing_account_id !== "string"
    || !result.billing.billing_account_id
  ) {
    throw new Error("Conclusão clínica não retornou conta correlacionada ao agendamento.");
  }
  if (
    result.billing.appointment_id != null
    && result.billing.appointment_id !== appointmentId
  ) {
    throw new Error("Conta retornada pertence a outro agendamento.");
  }
  return result as FinalizeAppointmentWithBillingResult;
}

export const medicalAttendanceService = {
  async open(appointmentId: number, unitId?: number | null, professionalId?: number | null): Promise<MedicalEncounter> {
    const { data, error } = await supabase.rpc("m18_open_attendance_secure", {
      p_appointment_id: appointmentId,
      p_unit_id: unitId ?? null,
      p_professional_id: professionalId ?? null,
    });
    if (error) throw new Error(`Erro ao abrir atendimento: ${error.message}`);
    return assertEditableEncounter(data);
  },

  async save(encounterId: string, payload: MedicalAttendancePayload): Promise<MedicalEncounter> {
    const { data, error } = await supabase.rpc("m18_save_attendance_secure", {
      p_encounter_id: encounterId,
      p_payload: payload,
    });
    if (error) throw new Error(`Erro ao salvar atendimento: ${error.message}`);
    return data as MedicalEncounter;
  },

  async finalize(encounterId: string, disposition: "FINALIZED" | "DISCHARGED" | "REFERRED" | "ADMITTED" = "FINALIZED"): Promise<MedicalEncounter> {
    const { data, error } = await supabase.rpc("m18_finalize_attendance_secure", {
      p_encounter_id: encounterId,
      p_disposition: disposition,
    });
    if (error) throw new Error(`Erro ao finalizar atendimento: ${error.message}`);
    return data as MedicalEncounter;
  },

  async complete(encounterId: string, payload: MedicalAttendancePayload, disposition: "FINALIZED" | "DISCHARGED" | "REFERRED" | "ADMITTED" = "FINALIZED"): Promise<MedicalEncounter> {
    if (!encounterId) throw new Error("Atendimento inválido.");
    const { data, error } = await supabase.rpc("m18_complete_attendance_secure", {
      p_encounter_id: encounterId,
      p_payload: payload,
      p_disposition: disposition,
    });
    if (error) throw new Error(`Erro ao concluir atendimento: ${error.message}`);
    return data as MedicalEncounter;
  },

  async finalizeAppointmentWithBilling(
    appointmentId: number,
    payload: MedicalAttendancePayload,
    disposition: "FINALIZED" | "DISCHARGED" | "REFERRED" | "ADMITTED" = "FINALIZED",
  ): Promise<FinalizeAppointmentWithBillingResult> {
    if (!Number.isSafeInteger(appointmentId) || appointmentId <= 0) {
      throw new Error("Agendamento inválido para conclusão clínica.");
    }
    const { data, error } = await supabase.rpc(
      "m18_finalize_appointment_with_billing_secure",
      {
        p_appointment_id: appointmentId,
        p_payload: payload,
        p_disposition: disposition,
      },
    );
    if (error) throw new Error(`Erro ao concluir atendimento e faturamento: ${error.message}`);
    return assertFinalizeAppointmentResult(data, appointmentId);
  },
};
