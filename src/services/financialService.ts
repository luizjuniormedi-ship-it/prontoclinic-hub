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
  received_amount: number;
  balance_amount: number;
  discount: number;
  payment_method: string | null;
  status: string;
  due_date: string | null;
  payment_date: string | null;
  notes: string | null;
  created_at: string;
  patient_name?: string | null;
}

export const financialService = {
  async getAll(): Promise<DbFinancialTransaction[]> {
    const { data, error } = await supabase.rpc('list_billing_financial_summary_secure');
    if (error) throw new Error(`Erro ao buscar transações: ${error.message}`);
    return (data || []).map((row: any) => ({
      id: String(row.billing_id), company_id: row.company_id, unit_id: null,
      patient_id: row.patient_id == null ? null : String(row.patient_id),
      billing_id: String(row.billing_id), professional_id: null,
      appointment_id: row.appointment_id == null ? null : String(row.appointment_id),
      amount: Number(row.billed_amount) || 0,
      received_amount: Number(row.received_amount) || 0,
      balance_amount: Number(row.balance_amount) || 0,
      discount: 0, payment_method: row.last_payment_method,
      status: row.financial_status, due_date: row.due_date,
      payment_date: row.last_payment_at, notes: null,
      created_at: row.created_at,
    }));
  },

  async recordPayment(id: string, amount: number, paymentMethod: string, idempotencyKey: string): Promise<void> {
    const { error } = await supabase.rpc('record_billing_receipt_secure', {
      p_billing_id: Number(id), p_amount: amount,
      p_payment_method: paymentMethod, p_idempotency_key: idempotencyKey,
    });
    if (error) throw new Error(`Erro ao registrar pagamento: ${error.message}`);
  },
};
