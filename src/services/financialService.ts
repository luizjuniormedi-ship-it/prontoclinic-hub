import { supabase } from "@/lib/supabase";

type CanonicalBillingStatus =
  | "aberta"
  | "em_montagem"
  | "aguardando_documentos"
  | "aguardando_autorizacao"
  | "aguardando_laudo"
  | "aguardando_assinatura"
  | "aguardando_conferencia"
  | "em_auditoria"
  | "com_pendencia"
  | "pronta_envio"
  | "enviada"
  | "em_analise"
  | "paga"
  | "parcialmente_paga"
  | "glosada"
  | "em_recurso"
  | "recurso_aceito"
  | "recurso_negado"
  | "baixada"
  | "cancelada"
  | "reaberta"
  | "particular_paga"
  | "particular_pendente"
  | "inadimplente";

type CanonicalTransactionStatus =
  | "pending"
  | "open"
  | "partial"
  | "authorized"
  | "captured"
  | "confirmed"
  | "paid"
  | "overdue"
  | "cancelled"
  | "refunded"
  | "reconciled"
  | "failed";

interface CanonicalBillingRow {
  id: string | number;
  company_id: string | null;
  unit_id: number | null;
  patient_id: string | number | null;
  professional_id: string | number | null;
  appointment_id: string | number | null;
  billing_type: string;
  total_gross_amount: number;
  total_discount_amount: number;
  total_net_amount: number;
  status: CanonicalBillingStatus;
  notes: string | null;
  opened_at: string;
  created_at: string;
}

interface CanonicalTransactionRow {
  id: string | number;
  company_id: string | null;
  unit_id: number | null;
  patient_id: string | number | null;
  billing_account_id: string | number | null;
  billing_id: string | number | null;
  professional_id: string | number | null;
  appointment_id: string | number | null;
  transaction_type: string;
  amount: number;
  discount: number;
  payment_method: string | null;
  status: CanonicalTransactionStatus;
  due_date: string | null;
  payment_date: string | null;
  notes: string | null;
  created_at: string;
}

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
  canonical_status: CanonicalBillingStatus;
  notes: string | null;
  created_at: string;
}

export interface BillingInput {
  company_id?: string;
  unit_id?: number;
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

export interface DbFinancialTransaction {
  id: string;
  company_id: string | null;
  unit_id: number | null;
  patient_id: string | null;
  billing_id: string | null;
  professional_id: string | null;
  appointment_id: string | null;
  transaction_type: string;
  amount: number;
  discount: number;
  payment_method: string | null;
  status: string;
  canonical_status: CanonicalTransactionStatus;
  due_date: string | null;
  payment_date: string | null;
  notes: string | null;
  created_at: string;
  patient_name?: string | null;
}

const BILLING_SELECT = [
  "id",
  "company_id",
  "unit_id",
  "patient_id",
  "professional_id",
  "appointment_id",
  "billing_type",
  "total_gross_amount",
  "total_discount_amount",
  "total_net_amount",
  "status",
  "notes",
  "opened_at",
  "created_at",
].join(", ");

const TRANSACTION_SELECT = [
  "id",
  "company_id",
  "unit_id",
  "patient_id",
  "billing_account_id",
  "billing_id",
  "professional_id",
  "appointment_id",
  "transaction_type",
  "amount",
  "discount",
  "payment_method",
  "status",
  "due_date",
  "payment_date",
  "notes",
  "created_at",
].join(", ");

function billingStatusForLegacy(status: CanonicalBillingStatus): string {
  if (["paga", "parcialmente_paga", "particular_paga", "baixada"].includes(status)) {
    return "faturado";
  }
  if (["enviada", "em_analise", "pronta_envio"].includes(status)) {
    return "faturado_enviado";
  }
  if (["glosada", "em_recurso", "recurso_aceito", "recurso_negado"].includes(status)) {
    return "glosa";
  }
  if (status === "cancelada") return "cancelado";
  return "em_aberto";
}

function canonicalBillingStatus(status: string): CanonicalBillingStatus {
  const compatibility: Record<string, CanonicalBillingStatus> = {
    em_aberto: "aberta",
    faturado: "paga",
    faturado_enviado: "enviada",
    cancelado: "cancelada",
    glosa: "glosada",
  };
  return compatibility[status] || status as CanonicalBillingStatus;
}

function transactionStatusForUi(status: CanonicalTransactionStatus): string {
  if (["captured", "confirmed", "paid", "reconciled"].includes(status)) return "pago";
  if (["cancelled", "refunded", "failed"].includes(status)) return "cancelado";
  return "pendente";
}

function mapBilling(row: CanonicalBillingRow): DbBilling {
  return {
    id: String(row.id),
    company_id: row.company_id,
    unit_id: row.unit_id,
    patient_id: row.patient_id == null ? null : String(row.patient_id),
    professional_id: row.professional_id == null ? null : String(row.professional_id),
    appointment_id: row.appointment_id == null ? null : String(row.appointment_id),
    billing_type: row.billing_type,
    gross_amount: Number(row.total_gross_amount) || 0,
    discount: Number(row.total_discount_amount) || 0,
    net_amount: Number(row.total_net_amount) || 0,
    status: billingStatusForLegacy(row.status),
    canonical_status: row.status,
    notes: row.notes,
    created_at: row.opened_at || row.created_at,
  };
}

function mapTransaction(row: CanonicalTransactionRow): DbFinancialTransaction {
  return {
    id: String(row.id),
    company_id: row.company_id,
    unit_id: row.unit_id,
    patient_id: row.patient_id == null ? null : String(row.patient_id),
    billing_id: row.billing_account_id == null
      ? row.billing_id == null ? null : String(row.billing_id)
      : String(row.billing_account_id),
    professional_id: row.professional_id == null ? null : String(row.professional_id),
    appointment_id: row.appointment_id == null ? null : String(row.appointment_id),
    transaction_type: row.transaction_type,
    amount: Number(row.amount) || 0,
    discount: Number(row.discount) || 0,
    payment_method: row.payment_method,
    status: transactionStatusForUi(row.status),
    canonical_status: row.status,
    due_date: row.due_date,
    payment_date: row.payment_date,
    notes: row.notes,
    created_at: row.created_at,
  };
}

async function billingByAppointment(appointmentId: string): Promise<DbBilling | null> {
  const { data, error } = await supabase
    .from("billing_accounts")
    .select(BILLING_SELECT)
    .eq("appointment_id", appointmentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`Erro ao buscar conta do atendimento: ${error.message}`);
  return data ? mapBilling(data as unknown as CanonicalBillingRow) : null;
}

export const billingsService = {
  async getAll(): Promise<DbBilling[]> {
    const { data, error } = await supabase
      .from("billing_accounts")
      .select(BILLING_SELECT)
      .is("deleted_at", null)
      .order("opened_at", { ascending: false })
      .limit(2000);

    if (error) throw new Error(`Erro ao buscar faturamentos: ${error.message}`);
    return ((data || []) as unknown as CanonicalBillingRow[]).map(mapBilling);
  },

  /**
   * Compatibility entry point used by AttendancePage.
   *
   * Canonical accounts are attached to an appointment. Existing accounts are
   * returned without mutation; missing ones are prepared through the secure,
   * idempotent checkout RPC. Arbitrary standalone rows are deliberately
   * rejected because `billing_accounts` has no safe direct-insert contract.
   */
  async create(input: BillingInput): Promise<DbBilling> {
    if (!input.appointment_id) {
      throw new Error(
        "A conta deve ser criada a partir de um atendimento no fluxo de Recepção/Faturamento.",
      );
    }

    const existing = await billingByAppointment(input.appointment_id);
    if (existing) return existing;

    const gross = Number(input.gross_amount);
    const discount = Number(input.discount || 0);
    const net = Number(input.net_amount);
    if (!Number.isFinite(gross) || !Number.isFinite(discount) || !Number.isFinite(net)) {
      throw new Error("Valores da conta são inválidos.");
    }
    if (gross < 0 || discount < 0 || net < 0 || discount > gross) {
      throw new Error("Valores da conta são inconsistentes.");
    }

    const payerType = input.billing_type === "convenio" ? "convenio" : "particular";
    const patientResponsibility = payerType === "convenio" ? 0 : net;
    const insuranceResponsibility = payerType === "convenio" ? net : 0;

    const { error } = await supabase.rpc("prepare_reception_checkout_secure", {
      p_appointment_id: Number(input.appointment_id),
      p_payer_type: payerType,
      p_gross_amount: gross,
      p_discount_amount: discount,
      p_patient_responsibility: patientResponsibility,
      p_insurance_responsibility: insuranceResponsibility,
      p_collection_policy: patientResponsibility > 0 ? "accounts_receivable" : "waived",
      p_due_date: null,
      p_notes: input.notes || null,
    });

    if (error) throw new Error(`Erro ao preparar faturamento: ${error.message}`);

    const prepared = await billingByAppointment(input.appointment_id);
    if (!prepared) throw new Error("A conta canônica não foi retornada após o preparo.");
    return prepared;
  },

  async updateStatus(id: string, status: string): Promise<DbBilling> {
    const { data, error } = await supabase
      .from("billing_accounts")
      .update({ status: canonicalBillingStatus(status) })
      .eq("id", id)
      .select(BILLING_SELECT)
      .single();

    if (error) throw new Error(`Erro ao atualizar faturamento: ${error.message}`);
    return mapBilling(data as unknown as CanonicalBillingRow);
  },
};

function canonicalPaymentMethod(paymentMethod: string): string {
  const methods: Record<string, string> = {
    dinheiro: "dinheiro",
    pix: "pix",
    cartao_debito: "debito",
    cartao_credito: "credito",
    transferencia: "outro",
    boleto: "boleto",
  };
  const canonical = methods[paymentMethod];
  if (!canonical) throw new Error("Forma de pagamento não suportada pelo checkout canônico.");
  return canonical;
}

export const financialService = {
  async getAll(): Promise<DbFinancialTransaction[]> {
    const { data, error } = await supabase
      .from("financial_transactions")
      .select(TRANSACTION_SELECT)
      .eq("transaction_type", "receivable")
      .order("created_at", { ascending: false })
      .limit(2000);

    if (error) throw new Error(`Erro ao buscar transações: ${error.message}`);
    return ((data || []) as unknown as CanonicalTransactionRow[]).map(mapTransaction);
  },

  async markPaid(
    transaction: DbFinancialTransaction,
    paymentMethod: string,
    externalReference?: string,
  ): Promise<DbFinancialTransaction> {
    if (!transaction.appointment_id) {
      throw new Error("O recebível não está vinculado a um atendimento.");
    }

    const canonicalMethod = canonicalPaymentMethod(paymentMethod);
    const reference = externalReference?.trim() || null;
    if (canonicalMethod !== "dinheiro" && !reference) {
      throw new Error("Informe o comprovante, NSU ou referência externa do pagamento.");
    }

    const { error } = await supabase.rpc("register_reception_payment_secure", {
      p_appointment_id: Number(transaction.appointment_id),
      p_amount: Number(transaction.amount),
      p_payment_method: canonicalMethod,
      p_idempotency_key: `financial:${transaction.id}:full-payment`,
      p_external_reference: reference,
      p_installment_count: 1,
      p_notes: "Pagamento registrado no módulo Financeiro",
    });

    if (error) throw new Error(`Erro ao registrar pagamento: ${error.message}`);

    const { data, error: refreshError } = await supabase
      .from("financial_transactions")
      .select(TRANSACTION_SELECT)
      .eq("id", transaction.id)
      .maybeSingle();

    if (refreshError) {
      throw new Error(`Pagamento registrado, mas a atualização falhou: ${refreshError.message}`);
    }
    if (!data) throw new Error("Recebível não encontrado após o pagamento.");
    return mapTransaction(data as unknown as CanonicalTransactionRow);
  },
};
