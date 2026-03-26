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

export const billingsService = {
  async getAll(): Promise<DbBilling[]> {
    const { data, error } = await supabase
      .from('billings')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Erro ao buscar faturamentos: ${error.message}`);
    return data || [];
  },

  async create(input: BillingInput): Promise<DbBilling> {
    const row: Record<string, any> = { ...input };
    if (!row.status) row.status = 'em_aberto';
    if (row.discount === undefined) row.discount = 0;

    const { data, error } = await supabase
      .from('billings')
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar faturamento: ${error.message}`);
    return data;
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
      .order('created_at', { ascending: false });
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
