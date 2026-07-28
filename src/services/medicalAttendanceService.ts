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

export const medicalAttendanceService = {
  async open(appointmentId: number, unitId?: number | null, professionalId?: number | null): Promise<MedicalEncounter> {
    const { data, error } = await supabase.rpc("m18_open_attendance_secure", {
      p_appointment_id: appointmentId,
      p_unit_id: unitId ?? null,
      p_professional_id: professionalId ?? null,
    });
    if (error) throw new Error(`Erro ao abrir atendimento: ${error.message}`);
    return data as MedicalEncounter;
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
    const { data, error } = await supabase.rpc("m18_complete_attendance_secure", {
      p_encounter_id: encounterId,
      p_payload: payload,
      p_disposition: disposition,
    });
    if (error) throw new Error(`Erro ao concluir atendimento: ${error.message}`);
    return data as MedicalEncounter;
  },
};
