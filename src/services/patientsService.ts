import { supabase } from '@/lib/supabase';
import { Patient } from '@/types';

// Map database row to Patient type
function mapRowToPatient(row: any): Patient {
  return {
    id: row.id,
    name: row.name,
    cpf: row.cpf || '',
    birthDate: row.birth_date || '',
    phone: row.phone || '',
    email: row.email || '',
    gender: row.gender || 'O',
    address: row.address || undefined,
    healthInsurance: row.health_insurance || undefined,
    healthInsuranceNumber: row.health_insurance_number || undefined,
    bloodType: row.blood_type || undefined,
    allergies: row.allergies || undefined,
    emergencyContact: row.emergency_contact || undefined,
    emergencyPhone: row.emergency_phone || undefined,
    guardian: row.guardian || undefined,
    adminNotes: row.admin_notes || undefined,
    clinicalNotes: row.clinical_notes || undefined,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

// Map Patient to database row for insert/update
function mapPatientToRow(patient: Partial<Patient>) {
  const row: Record<string, any> = {};
  if (patient.name !== undefined) row.name = patient.name;
  if (patient.cpf !== undefined) row.cpf = patient.cpf;
  if (patient.birthDate !== undefined) row.birth_date = patient.birthDate;
  if (patient.phone !== undefined) row.phone = patient.phone;
  if (patient.email !== undefined) row.email = patient.email;
  if (patient.gender !== undefined) row.gender = patient.gender;
  if (patient.address !== undefined) row.address = patient.address;
  if (patient.healthInsurance !== undefined) row.health_insurance = patient.healthInsurance;
  if (patient.healthInsuranceNumber !== undefined) row.health_insurance_number = patient.healthInsuranceNumber;
  if (patient.bloodType !== undefined) row.blood_type = patient.bloodType;
  if (patient.allergies !== undefined) row.allergies = patient.allergies;
  if (patient.emergencyContact !== undefined) row.emergency_contact = patient.emergencyContact;
  if (patient.emergencyPhone !== undefined) row.emergency_phone = patient.emergencyPhone;
  if (patient.guardian !== undefined) row.guardian = patient.guardian;
  if (patient.adminNotes !== undefined) row.admin_notes = patient.adminNotes;
  if (patient.clinicalNotes !== undefined) row.clinical_notes = patient.clinicalNotes;
  return row;
}

export const patientsService = {
  async getAll(): Promise<Patient[]> {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .order('name');

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
      .or(`name.ilike.%${query}%,cpf.ilike.%${query}%,phone.ilike.%${query}%`)
      .order('name');

    if (error) throw new Error(`Erro ao buscar pacientes: ${error.message}`);
    return (data || []).map(mapRowToPatient);
  },
};
