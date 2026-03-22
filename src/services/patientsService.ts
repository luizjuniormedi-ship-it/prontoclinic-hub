import { supabase } from '@/lib/supabase';
import { Patient } from '@/types';

// Map database row to Patient type
function mapRowToPatient(row: any): Patient {
  return {
    id: row.id,
    companyId: row.company_id || undefined,
    name: row.full_name || '',
    cpf: row.cpf || '',
    birthDate: row.birth_date || '',
    phone: row.phone || '',
    email: row.email || '',
    gender: row.sex || 'O',
    healthInsurance: row.insurance_plan_id || undefined,
    healthInsuranceNumber: row.insurance_card_number || undefined,
    allergies: row.allergies || undefined,
    clinicalAlerts: row.clinical_alerts || undefined,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

// Map Patient to database row for insert/update
function mapPatientToRow(patient: Partial<Patient>) {
  const row: Record<string, any> = {};
  if (patient.companyId !== undefined) row.company_id = patient.companyId;
  if (patient.name !== undefined) row.full_name = patient.name;
  if (patient.cpf !== undefined) row.cpf = patient.cpf;
  if (patient.birthDate !== undefined) row.birth_date = patient.birthDate;
  if (patient.phone !== undefined) row.phone = patient.phone;
  if (patient.email !== undefined) row.email = patient.email;
  if (patient.gender !== undefined) row.sex = patient.gender;
  if (patient.healthInsurance !== undefined) row.insurance_plan_id = patient.healthInsurance;
  if (patient.healthInsuranceNumber !== undefined) row.insurance_card_number = patient.healthInsuranceNumber;
  if (patient.allergies !== undefined) row.allergies = patient.allergies;
  if (patient.clinicalAlerts !== undefined) row.clinical_alerts = patient.clinicalAlerts;
  return row;
}

export const patientsService = {
  async getAll(): Promise<Patient[]> {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .order('full_name');

    if (error) throw new Error(`Erro ao buscar pacientes: ${error.message}`);
    return (data || []).map(mapRowToPatient);
  },

  async getById(id: string): Promise<Patient | null> {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(`Erro ao buscar paciente: ${error.message}`);
    return data ? mapRowToPatient(data) : null;
  },

  async create(patient: Omit<Patient, 'id' | 'createdAt' | 'updatedAt'>): Promise<Patient> {
    const row = mapPatientToRow(patient);
    const { data, error } = await supabase
      .from('patients')
      .insert(row)
      .select()
      .single();

    if (error) throw new Error(`Erro ao cadastrar paciente: ${error.message}`);
    return mapRowToPatient(data);
  },

  async update(id: string, patient: Partial<Patient>): Promise<Patient> {
    const row = mapPatientToRow(patient);
    row.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('patients')
      .update(row)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Erro ao atualizar paciente: ${error.message}`);
    return mapRowToPatient(data);
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('patients')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Erro ao excluir paciente: ${error.message}`);
  },

  async search(query: string): Promise<Patient[]> {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .or(`full_name.ilike.%${query}%,cpf.ilike.%${query}%,phone.ilike.%${query}%`)
      .order('full_name');

    if (error) throw new Error(`Erro ao buscar pacientes: ${error.message}`);
    return (data || []).map(mapRowToPatient);
  },
};
