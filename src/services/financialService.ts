import { supabase } from '@/lib/supabase';

function requiredBigIntParam(value: string, label: string): string {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${label} inválido`);
  }
  const parsed = BigInt(value);
  if (parsed > 9223372036854775807n) {
    throw new Error(`${label} inválido`);
  }
  return value;
}

function normalizeFinancialTransaction(row: Record<string, unknown>): DbFinancialTransaction {
  return {
    id: String(row.id),
    company_id: row.company_id == null ? null : String(row.company_id),
    unit_id: row.unit_id == null ? null : Number(row.unit_id),
    patient_id: row.patient_id == null ? null : String(row.patient_id),
    billing_id: row.billing_id == null ? null : String(row.billing_id),
    professional_id: row.professional_id == null ? null : String(row.professional_id),
    appointment_id: row.appointment_id == null ? null : String(row.appointment_id),
    amount: Number(row.amount) || 0,
    discount: Number(row.discount) || 0,
    payment_method: row.payment_method == null ? null : String(row.payment_method),
    status: String(row.status ?? ""),
    due_date: row.due_date == null ? null : String(row.due_date),
    payment_date: row.payment_date == null ? null : String(row.payment_date),
    notes: row.notes == null ? null : String(row.notes),
    created_at: String(row.created_at ?? ""),
    patient_name: row.patient_name == null ? null : String(row.patient_name),
  };
}

function normalizeBilling(row: Record<string, unknown>): DbBilling {
  return {
    id: String(row.id),
    company_id: row.company_id == null ? null : String(row.company_id),
    unit_id: row.unit_id == null ? null : Number(row.unit_id),
    patient_id: row.patient_id == null ? null : String(row.patient_id),
    professional_id: row.professional_id == null ? null : String(row.professional_id),
    appointment_id: row.appointment_id == null ? null : String(row.appointment_id),
    billing_type: row.billing_type == null ? 'particular' : String(row.billing_type),
    gross_amount: Number(row.amount ?? row.gross_amount) || 0,
    discount: Number(row.discount) || 0,
    net_amount: Number(row.total ?? row.net_amount) || 0,
    status: String(row.status ?? ""),
    notes: row.notes == null ? null : String(row.notes),
    created_at: String(row.created_at ?? ""),
  };
}

// ── Billings ──

export interface DbBilling {
  id: string;
  company_id: string | null;
  unit_id: number | null;
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
  patient_id: string;
  professional_id?: string;
  billing_type?: string;
  gross_amount: number;
  discount?: number;
  net_amount: number;
  notes?: string;
  idempotency_key: string;
}

export const billingsService = {
  async getAll(): Promise<DbBilling[]> {
    const { data, error } = await supabase
      .from('billings')
      .select('id, company_id, unit_id, patient_id, professional_id, appointment_id, billing_type, amount, discount, total, status, notes, created_at')
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error) throw new Error(`Erro ao buscar faturamentos: ${error.message}`);
    return (data || []).map(normalizeBilling);
  },

  async create(input: BillingInput): Promise<DbBilling> {
    const { data, error } = await supabase.rpc('create_manual_billing_secure', {
      p_patient_id: requiredBigIntParam(input.patient_id, 'Paciente'),
      p_professional_id: input.professional_id
        ? requiredBigIntParam(input.professional_id, 'Profissional')
        : null,
      p_billing_type: input.billing_type || 'particular',
      p_gross_amount: input.gross_amount,
      p_discount: input.discount || 0,
      p_net_amount: input.net_amount,
      p_notes: input.notes || null,
      p_idempotency_key: input.idempotency_key,
    });
    if (error) throw new Error(`Erro ao criar faturamento: ${error.message}`);
    if (!data) throw new Error('Erro ao criar faturamento: resposta vazia');
    return normalizeBilling(data);
  },

};

// ── Financial Transactions ──

export interface DbFinancialTransaction {
  id: string;
  company_id: string | null;
  unit_id: number | null;
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
  patient_id: string;
  amount: number;
  payment_method?: string;
  due_date?: string;
  notes?: string;
  idempotency_key: string;
}

export const financialService = {
  async getAll(): Promise<DbFinancialTransaction[]> {
    const { data, error } = await supabase
      .from('financial_transactions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error) throw new Error(`Erro ao buscar transações: ${error.message}`);
    return (data || []).map(normalizeFinancialTransaction);
  },

  async create(input: FinancialTransactionInput): Promise<DbFinancialTransaction> {
    const { data, error } = await supabase.rpc('create_financial_receivable_secure', {
      p_patient_id: requiredBigIntParam(input.patient_id, 'Paciente'),
      p_amount: input.amount,
      p_due_date: input.due_date || null,
      p_payment_method: input.payment_method || null,
      p_notes: input.notes || null,
      p_idempotency_key: input.idempotency_key,
    });
    if (error) throw new Error(`Erro ao criar transação: ${error.message}`);
    if (!data) throw new Error('Erro ao criar transação: resposta vazia');
    return normalizeFinancialTransaction(data);
  },

  async markPaid(id: string, paymentMethod: string): Promise<DbFinancialTransaction> {
    const { data, error } = await supabase.rpc('settle_financial_transaction_secure', {
      p_transaction_id: requiredBigIntParam(id, 'ID da cobrança'),
      p_payment_method: paymentMethod,
    });
    if (error) throw new Error(`Erro ao registrar pagamento: ${error.message}`);
    if (!data) throw new Error('Erro ao registrar pagamento: resposta vazia');
    return normalizeFinancialTransaction(data);
  },
};
