import { supabase } from '@/lib/supabase';

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
  lg_ativo?: boolean | null;
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
  code?: string | null;
  name: string;
  specialty_id: string | null;
  default_duration_minutes: number | null;
  price: number | null;
  lg_ativo?: boolean | null;
  vl_particular?: number | null;
  lg_autorizacao?: number | null;
  ds_preparo?: string | null;
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
  insurance_company_id?: number | null;
  insurance_plan_id?: number | null;
  appointment_type_id: string | null;
  appointment_date: string;
  start_time: string;
  end_time: string | null;
  status: string;
  is_return: boolean | null;
  notes: string | null;
  service_name: string | null;
  created_at: string;
  updated_at: string;
}

function normalizeLookupId(value: unknown, entity: string): string {
  if (value === null || value === undefined) {
    throw new Error(`${entity} retornou um identificador ausente.`);
  }

  const normalized = String(value).trim();
  if (!normalized) {
    throw new Error(`${entity} retornou um identificador vazio.`);
  }
  return normalized;
}

function normalizeNullableLookupId(value: unknown, entity: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return normalizeLookupId(value, entity);
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeProfessional(row: DbProfessional): DbProfessional {
  return {
    ...row,
    id: normalizeLookupId(row.id, 'Profissional'),
    company_id: normalizeNullableLookupId(row.company_id, 'Empresa do profissional'),
    default_duration_minutes: normalizeNullableNumber(row.default_duration_minutes),
  };
}

function normalizeSpecialty(row: DbSpecialty): DbSpecialty {
  return {
    ...row,
    id: normalizeLookupId(row.id, 'Especialidade'),
  };
}

function normalizeAppointmentType(row: DbAppointmentType): DbAppointmentType {
  return {
    ...row,
    id: normalizeLookupId(row.id, 'Tipo de atendimento'),
    default_duration_minutes: normalizeNullableNumber(row.default_duration_minutes),
  };
}

function normalizeServiceCatalog(row: DbServiceCatalog): DbServiceCatalog {
  return {
    ...row,
    id: normalizeLookupId(row.id, 'Serviço'),
    specialty_id: normalizeNullableLookupId(row.specialty_id, 'Especialidade do serviço'),
    default_duration_minutes: normalizeNullableNumber(row.default_duration_minutes),
    price: normalizeNullableNumber(row.price),
    vl_particular: normalizeNullableNumber(row.vl_particular),
    lg_autorizacao: normalizeNullableNumber(row.lg_autorizacao),
  };
}

// ── Lookup services ──

export const professionalsLookup = {
  async getAll(): Promise<DbProfessional[]> {
    const { data, error } = await supabase
      .from('professionals')
      .select('*')
      .order('full_name');
    if (error) throw new Error(`Erro ao buscar profissionais: ${error.message}`);
    return ((data || []) as DbProfessional[]).map(normalizeProfessional);
  },
};

export const specialtiesLookup = {
  async getAll(): Promise<DbSpecialty[]> {
    const { data, error } = await supabase
      .from('specialties')
      .select('*')
      .order('name');
    if (error) throw new Error(`Erro ao buscar especialidades: ${error.message}`);
    return ((data || []) as DbSpecialty[]).map(normalizeSpecialty);
  },
};

export const appointmentTypesLookup = {
  async getAll(): Promise<DbAppointmentType[]> {
    const { data, error } = await supabase
      .from('appointment_types')
      .select('*')
      .order('name');
    if (error) throw new Error(`Erro ao buscar tipos de atendimento: ${error.message}`);
    return ((data || []) as DbAppointmentType[]).map(normalizeAppointmentType);
  },
};

export const servicesCatalogLookup = {
  async getAll(): Promise<DbServiceCatalog[]> {
    const { data, error } = await supabase
      .from('services_catalog')
      .select('*')
      .order('name');
    if (error) throw new Error(`Erro ao buscar serviços: ${error.message}`);
    return ((data || []) as DbServiceCatalog[]).map(normalizeServiceCatalog);
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
  is_walkin?: boolean;
  notes?: string;
  insurance_id?: string;
  card_number?: string;
  authorization_number?: string;
}

export interface SchedulingRequirements {
  insurance_id: number | null;
  insurance_name: string | null;
  card_number: string | null;
  professional_credentialed: boolean;
  requires_authorization: boolean;
  requires_eligibility: boolean;
  preparation: string | null;
  service_name: string | null;
  private_price: number | null;
  errors: string[];
}

export interface AppointmentRescheduleInput {
  appointment_date: string;
  start_time: string;
  end_time?: string;
  reason: string;
}

function toBigIntParam(value: string | undefined, field: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(field + ' inválido.');
  }
  return parsed;
}

function requiredBigIntParam(value: string | undefined, field: string): number {
  const parsed = toBigIntParam(value, field);
  if (parsed === null) {
    throw new Error(field + ' é obrigatório.');
  }
  return parsed;
}

export const appointmentsService = {
  async getByDateRange(startDate: string, endDate: string): Promise<DbAppointment[]> {
    const pageSize = 500;
    const maxPages = 40;
    const rows: DbAppointment[] = [];

    for (let page = 0; page < maxPages; page += 1) {
      const from = page * pageSize;
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .gte('appointment_date', startDate)
        .lte('appointment_date', endDate)
        .order('appointment_date')
        .order('start_time')
        .order('id')
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`Erro ao buscar agendamentos: ${error.message}`);

      const pageRows = (data || []) as DbAppointment[];
      rows.push(...pageRows);
      if (pageRows.length < pageSize) return rows;
    }

    throw new Error(
      'A agenda excedeu 20.000 registros no período. Reduza o intervalo ou os filtros.',
    );
  },

  async getByDate(date: string): Promise<DbAppointment[]> {
    return this.getByDateRange(date, date);
  },

  async create(input: AppointmentCreateInput): Promise<DbAppointment> {
    const { data, error } = await supabase.rpc('create_appointment_with_requirements_secure', {
      p_patient_id: requiredBigIntParam(input.patient_id, 'Paciente'),
      p_professional_id: requiredBigIntParam(input.professional_id, 'Profissional'),
      p_appointment_date: input.appointment_date,
      p_start_time: input.start_time,
      p_end_time: input.end_time || null,
      p_company_id: input.company_id || null,
      p_unit_id: toBigIntParam(input.unit_id, 'Unidade'),
      p_specialty_id: toBigIntParam(input.specialty_id, 'Especialidade'),
      p_service_id: toBigIntParam(input.service_id, 'Serviço'),
      p_appointment_type_id: toBigIntParam(input.appointment_type_id, 'Tipo de atendimento'),
      p_status: input.status || 'scheduled',
      p_is_return: !!input.is_return,
      p_is_walkin: !!input.is_walkin,
      p_notes: input.notes || null,
      p_insurance_id: toBigIntParam(input.insurance_id, 'Convênio'),
      p_card_number: input.card_number || null,
      p_authorization_number: input.authorization_number || null,
    });
    if (error) throw new Error('Erro ao criar agendamento: ' + error.message);
    return data as DbAppointment;
  },

  async getRequirements(input: {
    patientId: string;
    professionalId: string;
    serviceId?: string;
    insuranceId?: string;
    cardNumber?: string;
  }): Promise<SchedulingRequirements> {
    const { data, error } = await supabase.rpc('get_scheduling_requirements', {
      p_patient_id: requiredBigIntParam(input.patientId, 'Paciente'),
      p_professional_id: requiredBigIntParam(input.professionalId, 'Profissional'),
      p_service_id: toBigIntParam(input.serviceId, 'Serviço'),
      p_insurance_id: toBigIntParam(input.insuranceId, 'Convênio'),
      p_card_number: input.cardNumber || null,
    });
    if (error) throw new Error('Erro ao validar requisitos: ' + error.message);
    return data as SchedulingRequirements;
  },

  async updateStatus(id: string, newStatus: string, notes?: string): Promise<DbAppointment> {
    const { data, error } = await supabase.rpc('update_appointment_status_secure', {
      p_appointment_id: requiredBigIntParam(id, 'Agendamento'),
      p_new_status: newStatus,
      p_reason: notes || null,
    });
    if (error) throw new Error('Erro ao atualizar agendamento: ' + error.message);
    return data as DbAppointment;
  },

  async reschedule(id: string, input: AppointmentRescheduleInput): Promise<DbAppointment> {
    const { data, error } = await supabase.rpc('reschedule_appointment_secure', {
      p_appointment_id: requiredBigIntParam(id, 'Agendamento'),
      p_new_appointment_date: input.appointment_date,
      p_new_start_time: input.start_time,
      p_new_end_time: input.end_time || null,
      p_reason: input.reason,
    });
    if (error) throw new Error('Erro ao remarcar agendamento: ' + error.message);
    return data as DbAppointment;
  },

  async update(id: string, input: Partial<AppointmentCreateInput>): Promise<DbAppointment> {
    const row: Record<string, unknown> = { ...input, updated_at: new Date().toISOString() };

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
    await this.updateStatus(id, 'cancelled', 'Cancelamento lógico solicitado');
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
