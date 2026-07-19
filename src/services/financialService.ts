import { supabase } from '@/lib/supabase';

// ── Billings ──

export interface DbBilling {
  id: string;
  company_id: string | null;
  unit_id: string | null;
  patient_id: string | null;
  professional_id: string | null;
  appointment_id: string | null;
  billing_type: string | null;
  gross_amount: number;
  discount: number;
  net_amount: number;
  status: string;
  notes: string | null;
  created_at: string;
}

export interface BillingInput {
  company_id?: string;
  unit_id?: string;
  patient_id: string;
  professional_id?: string;
  appointment_id?: string;
  billing_type?: string;
  gross_amount: number;
  discount?: number;
  net_amount: number;
  status?: string;
  notes?: string;
}

const billingCreationInFlight = new Map<string, Promise<DbBilling>>();

export const billingsService = {
  async findByAppointmentId(appointmentId: string, companyId?: string): Promise<DbBilling | null> {
    let query = supabase
      .from('billings')
      // Keep the read contract compatible with the deployed baseline. Optional
      // enrichment columns are mapped defensively when a newer schema exists.
      .select('id, company_id, patient_id, appointment_id, amount, status, created_at')
      .eq('appointment_id', appointmentId)
      .limit(1);
    if (companyId) query = query.eq('company_id', companyId);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`Erro ao buscar faturamento do atendimento: ${error.message}`);
    if (!data) return null;
    return mapBillingRow(data);
  },

  async getAll(): Promise<DbBilling[]> {
    const { data, error } = await supabase
      .from('billings')
      // The VPS baseline currently exposes only the core billing columns;
      // avoid optional and not-yet-replayed columns in the production read.
      .select('id, company_id, patient_id, amount, status, created_at')
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error) throw new Error(`Erro ao buscar faturamentos: ${error.message}`);
    return (data || []).map(mapBillingRow);
  },

  async create(input: BillingInput): Promise<DbBilling> {
    const row: Record<string, any> = {
      company_id: input.company_id,
      patient_id: input.patient_id,
      professional_id: input.professional_id || null,
      appointment_id: input.appointment_id || null,
      amount: input.gross_amount,
      discount: input.discount || 0,
      total: input.net_amount,
      status: input.status || 'em_aberto',
      notes: input.notes || null,
    };

    const { data, error } = await supabase
      .from('billings')
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar faturamento: ${error.message}`);
    return {
      ...input,
      id: String(data.id),
      company_id: data.company_id,
      unit_id: null,
      patient_id: data.patient_id == null ? null : String(data.patient_id),
      professional_id: data.professional_id == null ? null : String(data.professional_id),
      appointment_id: data.appointment_id == null ? input.appointment_id || null : String(data.appointment_id),
      billing_type: input.billing_type || 'particular',
      gross_amount: Number(data.amount) || 0,
      discount: Number(data.discount) || 0,
      net_amount: Number(data.total) || 0,
      status: data.status,
      notes: data.notes,
      created_at: data.created_at,
    } as DbBilling;
  },

  async createForAppointment(input: BillingInput & { appointment_id: string }): Promise<DbBilling> {
    const key = `${input.company_id || ""}:${input.appointment_id}`;
    const current = billingCreationInFlight.get(key);
    if (current) return current;

    const creation = (async () => {
      const existing = await billingsService.findByAppointmentId(input.appointment_id, input.company_id);
      if (existing) return existing;
      return billingsService.create(input);
    })();
    billingCreationInFlight.set(key, creation);
    try {
      return await creation;
    } finally {
      if (billingCreationInFlight.get(key) === creation) billingCreationInFlight.delete(key);
    }
  },

  async updateStatus(id: string, status: string): Promise<DbBilling> {
    const { data, error } = await supabase
      .from('billings')
      .update({ status })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(`Erro ao atualizar faturamento: ${error.message}`);
    return data;
  },
};

function mapBillingRow(row: any): DbBilling {
  return {
    id: String(row.id),
    company_id: row.company_id,
    unit_id: row.unit_id ?? null,
    patient_id: row.patient_id == null ? null : String(row.patient_id),
    professional_id: row.professional_id == null ? null : String(row.professional_id),
    appointment_id: row.appointment_id == null ? null : String(row.appointment_id),
    billing_type: row.billing_type || (row.insurance_company_id ? 'convenio' : 'particular'),
    gross_amount: Number(row.amount ?? row.gross_amount) || 0,
    discount: Number(row.discount) || 0,
    net_amount: Number(row.total ?? row.net_amount) || 0,
    status: row.status,
    notes: row.notes || row.description,
    created_at: row.created_at,
  };
}

// ── Financial Transactions ──

export interface DbFinancialTransaction {
  id: string;
  company_id: string | null;
  unit_id: string | null;
  patient_id: string | null;
  billing_id: string | null;
  professional_id: string | null;
  appointment_id: string | null;
  amount: number;
  discount: number;
  payment_method: string | null;
  status: string;
  due_date: string | null;
  payment_date: string | null;
  notes: string | null;
  created_at: string;
  patient_name?: string | null;
}

export interface FinancialTransactionInput {
  company_id?: string;
  unit_id?: string;
  patient_id: string;
  billing_id?: string;
  professional_id?: string;
  appointment_id?: string;
  amount: number;
  discount?: number;
  payment_method?: string;
  status?: string;
  due_date?: string;
  payment_date?: string;
  notes?: string;
}

export const financialService = {
  async getAll(): Promise<DbFinancialTransaction[]> {
    const { data, error } = await supabase
      .from('financial_transactions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error) throw new Error(`Erro ao buscar transações: ${error.message}`);
    return data || [];
  },

  async create(input: FinancialTransactionInput): Promise<DbFinancialTransaction> {
    const row: Record<string, any> = { ...input };
    if (!row.status) row.status = 'pendente';
    if (row.discount === undefined) row.discount = 0;

    const { data, error } = await supabase
      .from('financial_transactions')
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar transação: ${error.message}`);
    return data;
  },

  async markPaid(id: string, paymentMethod: string): Promise<DbFinancialTransaction> {
    const { data, error } = await supabase
      .from('financial_transactions')
      .update({
        status: 'pago',
        payment_method: paymentMethod,
        payment_date: new Date().toISOString().split('T')[0],
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(`Erro ao registrar pagamento: ${error.message}`);
    return data;
  },

  async updateStatus(id: string, status: string): Promise<DbFinancialTransaction> {
    const { data, error } = await supabase
      .from('financial_transactions')
      .update({ status })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(`Erro ao atualizar transação: ${error.message}`);
    return data;
  },
};
