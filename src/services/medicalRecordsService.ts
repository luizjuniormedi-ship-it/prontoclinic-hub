import { supabase } from '@/lib/supabase';

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
  vital_signs: Record<string, any> | null;
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
  vital_signs?: Record<string, any>;
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
  billing: { billing_id: number; billing_account_id: string; billing_type: string; gross_amount: number; price_found: boolean };
}

export const medicalRecordsService = {
  async finalizeAttendance(input: FinalizeAttendanceInput): Promise<FinalizeAttendanceResult> {
    const { appointment_id, ...payload } = input;
    const { data, error } = await supabase.rpc('m18_finalize_appointment_with_billing_secure', {
      p_appointment_id: Number(input.appointment_id),
      p_payload: payload,
      p_disposition: 'FINALIZED',
    });
    if (error) throw new Error(`Erro ao finalizar atendimento: ${error.message}`);
    return data as FinalizeAttendanceResult;
  },

  async getByPatient(patientId: string): Promise<DbMedicalRecord[]> {
    const { data, error } = await supabase
      .from('medical_records')
      .select('*')
      .eq('patient_id', patientId)
      .order('record_date', { ascending: false });
    if (error) throw new Error(`Erro ao buscar prontuários: ${error.message}`);
    return data || [];
  },

  async getById(id: string): Promise<DbMedicalRecord | null> {
    const { data, error } = await supabase
      .from('medical_records')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Erro ao buscar prontuário: ${error.message}`);
    return data;
  },

};
