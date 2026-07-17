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
  anamnesis?: string;
  evolution?: string;
  vital_signs?: Record<string, any>;
}

export const medicalRecordsService = {
  async finalizeAttendance(input: FinalizeAttendanceInput): Promise<DbMedicalRecord> {
    const { data, error } = await supabase.rpc('finalize_attendance_secure', {
      p_appointment_id: Number(input.appointment_id),
      p_anamnesis: input.anamnesis || null,
      p_evolution: input.evolution || null,
      p_vital_signs: input.vital_signs || null,
    });
    if (error) throw new Error(`Erro ao finalizar atendimento: ${error.message}`);
    return data as DbMedicalRecord;
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

  async create(input: MedicalRecordInput): Promise<DbMedicalRecord> {
    if (!input.patient_id || input.patient_id.trim() === "") {
      throw new Error("patient_id é obrigatório");
    }
    const row: Record<string, any> = { ...input };
    if (!row.record_date) row.record_date = new Date().toISOString();

    const { data, error } = await supabase
      .from('medical_records')
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar prontuário: ${error.message}`);
    return data;
  },

  async update(id: string, input: Partial<MedicalRecordInput>): Promise<DbMedicalRecord> {
    const { data, error } = await supabase
      .from('medical_records')
      .update(input)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(`Erro ao atualizar prontuário: ${error.message}`);
    return data;
  },
};
