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
  appointment_id: string;
  billing_type?: string;
  gross_amount: number;
  guide_number?: string;
}

const mapBilling = (row: any): DbBilling => ({
  id: String(row.id),
  company_id: row.company_id,
  unit_id: null,
  patient_id: row.patient_id == null ? null : String(row.patient_id),
  professional_id: null,
  appointment_id: row.appointment_id == null ? null : String(row.appointment_id),
  billing_type: row.tiss_status || null,
  gross_amount: Number(row.amount) || 0,
  discount: 0,
  net_amount: Number(row.amount) || 0,
  status: row.status,
  notes: row.guide_number ? `Guia: ${row.guide_number}` : null,
  created_at: row.created_at,
});

export const billingsService = {
  async getAll(): Promise<DbBilling[]> {
    const { data, error } = await supabase
      .from('billings')
      .select(
        'id, company_id, patient_id, appointment_id, amount, status, guide_number, tiss_status, dt_vencimento, dt_pagamento, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(2000);

    if (error) throw new Error(`Erro ao buscar faturamentos: ${error.message}`);

    return (data || []).map(mapBilling);
  },

  async create(input: BillingInput): Promise<DbBilling> {
    const { data, error } = await supabase.rpc('create_billing_secure', {
      p_appointment_id: Number(input.appointment_id),
      p_amount: input.gross_amount,
      p_tiss_status: input.billing_type || null,
      p_guide_number: input.guide_number || null,
    });
    if (error) throw new Error(`Erro ao criar faturamento: ${error.message}`);
    return mapBilling(data);
  },

  async updateStatus(id: string, status: string, reason?: string): Promise<DbBilling> {
    const { data, error } = await supabase.rpc('update_billing_status_secure', {
      p_billing_id: Number(id),
      p_status: status,
      p_reason: reason || null,
    });
    if (error) throw new Error(`Erro ao atualizar faturamento: ${error.message}`);
    return mapBilling(data);
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
