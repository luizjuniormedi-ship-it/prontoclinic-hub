import { supabase } from '@/lib/supabase';
import { canTransitionAppointment } from './statusTransitions';

// ── Lookup types matching Supabase schema ──

export interface DbProfessional {
  id: string;
  company_id: string | null;
  full_name: string;
  category: string | null;
  council_type: string | null;
  council_number: string | null;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  default_duration_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export interface DbSpecialty {
  id: string;
  name: string;
  code: string | null;
  status: string | null;
  created_at: string;
}

export interface DbAppointmentType {
  id: string;
  name: string;
  category: string | null;
  default_duration_minutes: number | null;
  status: string | null;
  created_at: string;
}

export interface DbServiceCatalog {
  id: string;
  name: string;
  specialty_id: string | null;
  default_duration_minutes: number | null;
  price: number | null;
  created_at: string;
}

export interface DbAppointment {
  id: string;
  company_id: string | null;
  unit_id: string | null;
  patient_id: string | null;
  professional_id: string | null;
  specialty_id: string | null;
  service_id: string | null;
  appointment_type_id: string | null;
  appointment_date: string;
  start_time: string;
  end_time: string | null;
  status: string;
  is_return: boolean | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── Lookup services ──

export const professionalsLookup = {
  async getAll(): Promise<DbProfessional[]> {
    const { data, error } = await supabase
      .from('professionals')
      .select('*')
      .order('full_name');
    if (error) throw new Error(`Erro ao buscar profissionais: ${error.message}`);
    return data || [];
  },
};

export const specialtiesLookup = {
  async getAll(): Promise<DbSpecialty[]> {
    const { data, error } = await supabase
      .from('specialties')
      .select('*')
      .order('name');
    if (error) throw new Error(`Erro ao buscar especialidades: ${error.message}`);
    return data || [];
  },
};

export const appointmentTypesLookup = {
  async getAll(): Promise<DbAppointmentType[]> {
    const { data, error } = await supabase
      .from('appointment_types')
      .select('*')
      .order('name');
    if (error) throw new Error(`Erro ao buscar tipos de atendimento: ${error.message}`);
    return data || [];
  },
};

export const servicesCatalogLookup = {
  async getAll(): Promise<DbServiceCatalog[]> {
    const { data, error } = await supabase
      .from('services_catalog')
      .select('*')
      .order('name');
    if (error) throw new Error(`Erro ao buscar serviços: ${error.message}`);
    return data || [];
  },
};

// ── Appointments CRUD ──

export interface AppointmentCreateInput {
  company_id?: string;
  unit_id?: string;
  patient_id: string;
  professional_id: string;
  specialty_id?: string;
  service_id?: string;
  appointment_type_id?: string;
  appointment_date: string;
  start_time: string;
  end_time?: string;
  status?: string;
  is_return?: boolean;
  notes?: string;
}

export const appointmentsService = {
  async getByDateRange(startDate: string, endDate: string): Promise<DbAppointment[]> {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .gte('appointment_date', startDate)
      .lte('appointment_date', endDate)
      .order('appointment_date')
      .order('start_time');
    if (error) throw new Error(`Erro ao buscar agendamentos: ${error.message}`);
    return data || [];
  },

  async getByDate(date: string): Promise<DbAppointment[]> {
    return this.getByDateRange(date, date);
  },

  async create(input: AppointmentCreateInput): Promise<DbAppointment> {
    const row: Record<string, any> = { ...input };
    if (!row.status) row.status = 'scheduled';

    const { data, error } = await supabase
      .from('appointments')
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar agendamento: ${error.message}`);
    return data;
  },

  async updateStatus(id: string, status: string, notes?: string): Promise<DbAppointment> {
    const row: Record<string, any> = { status, updated_at: new Date().toISOString() };
    if (notes !== undefined) row.notes = notes;

    const { data, error } = await supabase
      .from('appointments')
      .update(row)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(`Erro ao atualizar agendamento: ${error.message}`);
    return data;
  },

  async update(id: string, input: Partial<AppointmentCreateInput>): Promise<DbAppointment> {
    const row: Record<string, any> = { ...input, updated_at: new Date().toISOString() };

    const { data, error } = await supabase
      .from('appointments')
      .update(row)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(`Erro ao atualizar agendamento: ${error.message}`);
    return data;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('appointments')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`Erro ao excluir agendamento: ${error.message}`);
  },

  async getPatientLastCompleted(patientId: string, specialtyId: string): Promise<DbAppointment | null> {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('patient_id', patientId)
      .eq('specialty_id', specialtyId)
      .eq('status', 'completed')
      .order('appointment_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data;
  },
};
