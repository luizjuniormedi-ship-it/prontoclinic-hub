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
  diagnosis: string | null;
  prescription: string | null;
  vital_signs: Record<string, any> | null;
  notes: string | null;
  status: 'draft' | 'signed' | 'legacy_locked';
  signed_at: string | null;
  signed_by: string | null;
  content_hash: string | null;
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
  diagnosis?: string;
  prescription?: string;
  vital_signs?: Record<string, any>;
  notes?: string;
}

export interface FinalizeMedicalAttendanceInput {
  appointment_id: string;
  record_date?: string;
  anamnesis?: string;
  evolution?: string;
  diagnosis?: string;
  prescription?: string;
  vital_signs?: Record<string, unknown>;
  notes?: string;
}

export const medicalRecordsService = {
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
    if (!input.patient_id || !/^\d+$/.test(input.patient_id)) {
      throw new Error("patient_id deve ser um identificador numérico");
    }

    const { data, error } = await supabase.rpc('create_medical_record_secure', {
      p_patient_id: Number(input.patient_id),
      p_professional_id: input.professional_id ? Number(input.professional_id) : null,
      p_appointment_id: input.appointment_id ? Number(input.appointment_id) : null,
      p_record_date: input.record_date || null,
      p_anamnesis: input.anamnesis || null,
      p_evolution: input.evolution || null,
      p_diagnosis: input.diagnosis || null,
      p_prescription: input.prescription || null,
      p_vital_signs: input.vital_signs || null,
      p_notes: input.notes || null,
    });
    if (error) throw new Error('Erro ao criar prontuário: ' + error.message);
    return data as DbMedicalRecord;
  },

  async update(id: string, input: Partial<MedicalRecordInput>): Promise<DbMedicalRecord> {
    if (!/^\d+$/.test(id)) {
      throw new Error("id do prontuário deve ser numérico");
    }

    const patch: Record<string, unknown> = {};
    for (const field of ['record_date', 'anamnesis', 'evolution', 'diagnosis', 'prescription', 'vital_signs', 'notes'] as const) {
      if (field in input) patch[field] = input[field] ?? null;
    }
    if (Object.keys(patch).length === 0) {
      throw new Error('Nenhum campo clínico informado');
    }

    const { data, error } = await supabase.rpc('update_medical_record_secure', {
      p_record_id: Number(id),
      p_patch: patch,
    });
    if (error) throw new Error('Erro ao atualizar prontuário: ' + error.message);
    return data as DbMedicalRecord;
  },

  async finalizeAttendance(input: FinalizeMedicalAttendanceInput): Promise<DbMedicalRecord> {
    if (!input.appointment_id || !/^\d+$/.test(input.appointment_id)) {
      throw new Error('appointment_id deve ser um identificador numérico');
    }

    const { data, error } = await supabase.rpc('finalize_medical_attendance_secure', {
      p_appointment_id: input.appointment_id,
      p_record_date: input.record_date || null,
      p_anamnesis: input.anamnesis || null,
      p_evolution: input.evolution || null,
      p_diagnosis: input.diagnosis || null,
      p_prescription: input.prescription || null,
      p_vital_signs: input.vital_signs || null,
      p_notes: input.notes || null,
    });
    if (error) throw new Error('Erro ao finalizar atendimento: ' + error.message);
    return data as DbMedicalRecord;
  },
};

