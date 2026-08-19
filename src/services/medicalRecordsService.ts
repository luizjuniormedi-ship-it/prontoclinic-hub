import { supabase } from "@/lib/supabase";

// ── DB types matching Supabase schema ──

export interface DbMedicalRecord {
  id: string;
  company_id: string | null;
  unit_id: string | null;
  patient_id: string;
  professional_id: string | null;
  appointment_id: string | null;
  record_date: string;
  anamnesis: string | null;
  evolution: string | null;
  vital_signs: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
}

export interface MedicalRecordInput {
  company_id?: string;
  unit_id?: string;
  patient_id: string;
  professional_id?: string;
  appointment_id?: string;
  record_date?: string;
  anamnesis?: string;
  evolution?: string;
  vital_signs?: Record<string, unknown>;
  notes?: string;
}

export interface FinalizeAttendanceInput {
  appointment_id: string;
  chief_complaint?: string;
  anamnesis?: string;
  physical_exam?: string;
  vital_signs?: Record<string, unknown>;
  diagnoses?: Array<Record<string, unknown>>;
  conduct?: string;
  prescriptions?: Array<Record<string, unknown>>;
  exams?: Array<Record<string, unknown>>;
  return_plan?: string;
}

export interface FinalizeAttendanceResult {
  encounter: { id: string; appointment_id: number; status: string };
  billing: {
    billing_id: number;
    billing_account_id: string;
    billing_type: string;
    gross_amount: number;
    price_found: boolean;
  };
}

interface DbEncounterRecord {
  id: string;
  company_id: string;
  unit_id: number | null;
  patient_id: number;
  professional_id: number | null;
  appointment_id: number | null;
  chief_complaint: string | null;
  anamnesis: string | null;
  physical_exam: string | null;
  conduct: string | null;
  vital_signs: Record<string, unknown> | null;
  finalized_at: string | null;
  created_at: string;
}

function encounterToMedicalRecord(
  encounter: DbEncounterRecord,
): DbMedicalRecord {
  return {
    id: `encounter:${encounter.id}`,
    company_id: encounter.company_id,
    unit_id: encounter.unit_id == null ? null : String(encounter.unit_id),
    patient_id: String(encounter.patient_id),
    professional_id:
      encounter.professional_id == null
        ? null
        : String(encounter.professional_id),
    appointment_id:
      encounter.appointment_id == null
        ? null
        : String(encounter.appointment_id),
    record_date: encounter.finalized_at || encounter.created_at,
    anamnesis:
      [encounter.chief_complaint, encounter.anamnesis]
        .filter(Boolean)
        .join("\n\n") || null,
    evolution:
      [encounter.physical_exam, encounter.conduct]
        .filter(Boolean)
        .join("\n\n") || null,
    vital_signs: encounter.vital_signs,
    notes: null,
    created_at: encounter.created_at,
  };
}

export const medicalRecordsService = {
  async finalizeAttendance(
    input: FinalizeAttendanceInput,
  ): Promise<FinalizeAttendanceResult> {
    const { appointment_id, ...payload } = input;
    const { data, error } = await supabase.rpc(
      "m18_finalize_appointment_with_billing_secure",
      {
        p_appointment_id: Number(input.appointment_id),
        p_payload: payload,
        p_disposition: "FINALIZED",
      },
    );
    if (error)
      throw new Error(`Erro ao finalizar atendimento: ${error.message}`);
    return data as FinalizeAttendanceResult;
  },

  async getByPatient(patientId: string): Promise<DbMedicalRecord[]> {
    const [legacyResult, encountersResult] = await Promise.all([
      supabase
        .from("medical_records")
        .select("*")
        .eq("patient_id", patientId)
        .order("record_date", { ascending: false }),
      supabase
        .from("encounters")
        .select("*")
        .eq("patient_id", Number(patientId))
        .order("created_at", { ascending: false }),
    ]);
    if (legacyResult.error)
      throw new Error(
        `Erro ao buscar prontuários: ${legacyResult.error.message}`,
      );
    if (encountersResult.error)
      throw new Error(
        `Erro ao buscar atendimentos: ${encountersResult.error.message}`,
      );
    return [
      ...((legacyResult.data || []) as DbMedicalRecord[]),
      ...((encountersResult.data || []) as unknown as DbEncounterRecord[]).map(
        encounterToMedicalRecord,
      ),
    ].sort((a, b) => b.record_date.localeCompare(a.record_date));
  },

  async getById(id: string): Promise<DbMedicalRecord | null> {
    const { data, error } = await supabase
      .from("medical_records")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro ao buscar prontuário: ${error.message}`);
    return data;
  },
};
