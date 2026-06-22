import { supabase } from '@/lib/supabase';
import { Patient } from '@/types';

// Supabase row shape for patients table (only fields we touch here)
interface DbPatientRow {
  id: string;
  company_id?: string | null;
  full_name?: string | null;
  cpf?: string | null;
  birth_date?: string | null;
  phone?: string | null;
  email?: string | null;
  sex?: string | null;
  insurance_plan_id?: string | null;
  insurance_card_number?: string | null;
  allergies?: string | null;
  clinical_alerts?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

// Map database row to Patient type
function mapRowToPatient(row: DbPatientRow): Patient {
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

// Map Patient fields to database columns for insert/update
function mapPatientToRow(patient: Partial<Patient>) {
  const row: Record<string, string | undefined> = {};
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

// Validation helpers
export function validatePatient(patient: Partial<Patient>): string | null {
  if (!patient.name || patient.name.trim().length < 2) {
    return 'Nome completo é obrigatório (mínimo 2 caracteres).';
  }
  if (patient.name.trim().length > 200) {
    return 'Nome completo deve ter no máximo 200 caracteres.';
  }
  if (patient.cpf && !/^\d{11}$/.test(patient.cpf.replace(/\D/g, ''))) {
    return 'CPF deve conter 11 dígitos numéricos.';
  }
  if (patient.birthDate) {
    const d = new Date(patient.birthDate);
    if (isNaN(d.getTime()) || d > new Date()) {
      return 'Data de nascimento inválida.';
    }
  }
  if (patient.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patient.email)) {
    return 'E-mail inválido.';
  }
  return null;
}

// Strip non-digits from CPF/phone for storage
export function stripNonDigits(value: string): string {
  return value.replace(/\D/g, '');
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
    // Strip formatting from cpf and phone before saving
    if (row.cpf) row.cpf = stripNonDigits(row.cpf);
    if (row.phone) row.phone = stripNonDigits(row.phone);

    const { data, error } = await supabase
      .from('patients')
      .insert(row)
      .select()
      .single();

    if (error) {
      if (error.message?.includes('unique') || error.message?.includes('duplicate') || error.code === '23505') {
        throw new Error('Já existe um paciente com este CPF cadastrado.');
      }
      throw new Error(`Erro ao cadastrar paciente: ${error.message}`);
    }
    return mapRowToPatient(data);
  },

  async update(id: string, patient: Partial<Patient>): Promise<Patient> {
    const row = mapPatientToRow(patient);
    if (row.cpf) row.cpf = stripNonDigits(row.cpf);
    if (row.phone) row.phone = stripNonDigits(row.phone);
    row.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('patients')
      .update(row)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.message?.includes('unique') || error.message?.includes('duplicate') || error.code === '23505') {
        throw new Error('Já existe um paciente com este CPF cadastrado.');
      }
      throw new Error(`Erro ao atualizar paciente: ${error.message}`);
    }
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
    const sanitized = query.trim();
    if (!sanitized) return this.getAll();

    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .or(`full_name.ilike.%${sanitized}%,cpf.ilike.%${sanitized}%,phone.ilike.%${sanitized}%`)
      .order('full_name');

    if (error) throw new Error(`Erro ao buscar pacientes: ${error.message}`);
    return (data || []).map(mapRowToPatient);
  },

  async checkCpfExists(cpf: string, excludeId?: string): Promise<boolean> {
    const cleanCpf = stripNonDigits(cpf);
    let query = supabase
      .from('patients')
      .select('id')
      .eq('cpf', cleanCpf);

    if (excludeId) {
      query = query.neq('id', excludeId);
    }

    const { data, error } = await query;
    if (error) return false;
    return (data || []).length > 0;
  },
};
