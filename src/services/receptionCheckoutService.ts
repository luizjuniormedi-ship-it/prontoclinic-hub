import { supabase } from "@/lib/supabase";

export type ReceptionPayerType = "particular" | "convenio" | "misto" | "pacote" | "cortesia" | "empresa";
export type CollectionPolicy = "before_checkin" | "accounts_receivable" | "waived";
export type ReceptionPaymentMethod = "dinheiro" | "pix" | "debito" | "credito" | "boleto" | "outro";
export type ReceptionGuideType = "consulta" | "sp_sadt" | "internacao" | "honorario" | "outras_despesas";

export interface TissVersionOption {
  id: number;
  version: string;
  scope: string;
  effective_from: string;
  effective_until: string | null;
}

export interface ReceptionGuideSummary {
  id: number;
  number: string;
  type: ReceptionGuideType;
  status: "draft" | "generated" | "validated" | "signed" | "cancelled" | "replaced";
  version: string;
  requires_signature: boolean;
  patient_signed_at: string | null;
  validation_errors: string[];
}

export interface ReceptionReceivableSummary {
  id: number;
  status: string;
  amount: number;
  due_date: string | null;
}

export interface ReceptionCheckoutSummary {
  appointment_id: number;
  patient_id: number;
  company_id: string;
  unit_id: number | null;
  account_id: number | null;
  prepared: boolean;
  payer_type: ReceptionPayerType;
  collection_policy: CollectionPolicy;
  insurance_id: number | null;
  insurance_plan_id: number | null;
  service_id: number | null;
  service_name: string;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  copay_amount: number;
  patient_responsibility_amount: number;
  insurance_responsibility_amount: number;
  patient_paid_amount: number;
  patient_pending_amount: number;
  authorization_number: string | null;
  requires_tiss_guide: boolean;
  requires_tiss_signature: boolean;
  suggested_guide_type: ReceptionGuideType;
  guide: ReceptionGuideSummary | null;
  active_tiss_versions: TissVersionOption[];
  cash_session_open: boolean;
  receivable: ReceptionReceivableSummary | null;
}

export interface PrepareReceptionCheckoutInput {
  appointmentId: string;
  payerType: ReceptionPayerType;
  grossAmount: number;
  discountAmount: number;
  patientResponsibility: number;
  insuranceResponsibility: number;
  collectionPolicy: CollectionPolicy;
  dueDate?: string;
  notes?: string;
}

export interface RegisterReceptionPaymentInput {
  appointmentId: string;
  amount: number;
  paymentMethod: ReceptionPaymentMethod;
  idempotencyKey: string;
  externalReference?: string;
  installmentCount?: number;
  notes?: string;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    return ["true", "t", "1", "yes", "sim"].includes(value.trim().toLowerCase());
  }
  return false;
}

export function normalizeReceptionCheckoutSummary(value: unknown): ReceptionCheckoutSummary {
  const row = (value ?? {}) as Record<string, unknown>;
  const guide = row.guide && typeof row.guide === "object"
    ? row.guide as Record<string, unknown>
    : null;
  const receivable = row.receivable && typeof row.receivable === "object"
    ? row.receivable as Record<string, unknown>
    : null;
  const versions = Array.isArray(row.active_tiss_versions) ? row.active_tiss_versions : [];

  return {
    appointment_id: numberValue(row.appointment_id),
    patient_id: numberValue(row.patient_id),
    company_id: String(row.company_id ?? ""),
    unit_id: nullableNumber(row.unit_id),
    account_id: nullableNumber(row.account_id),
    prepared: booleanValue(row.prepared),
    payer_type: (row.payer_type || "particular") as ReceptionPayerType,
    collection_policy: (row.collection_policy || "before_checkin") as CollectionPolicy,
    insurance_id: nullableNumber(row.insurance_id),
    insurance_plan_id: nullableNumber(row.insurance_plan_id),
    service_id: nullableNumber(row.service_id),
    service_name: String(row.service_name || "Atendimento"),
    gross_amount: numberValue(row.gross_amount),
    discount_amount: numberValue(row.discount_amount),
    net_amount: numberValue(row.net_amount),
    copay_amount: numberValue(row.copay_amount),
    patient_responsibility_amount: numberValue(row.patient_responsibility_amount),
    insurance_responsibility_amount: numberValue(row.insurance_responsibility_amount),
    patient_paid_amount: numberValue(row.patient_paid_amount),
    patient_pending_amount: numberValue(row.patient_pending_amount),
    authorization_number: row.authorization_number ? String(row.authorization_number) : null,
    requires_tiss_guide: booleanValue(row.requires_tiss_guide),
    requires_tiss_signature: booleanValue(row.requires_tiss_signature),
    suggested_guide_type: (row.suggested_guide_type || "consulta") as ReceptionGuideType,
    guide: guide ? {
      id: numberValue(guide.id),
      number: String(guide.number || ""),
      type: (guide.type || "consulta") as ReceptionGuideType,
      status: (guide.status || "generated") as ReceptionGuideSummary["status"],
      version: String(guide.version || ""),
      requires_signature: booleanValue(guide.requires_signature),
      patient_signed_at: guide.patient_signed_at ? String(guide.patient_signed_at) : null,
      validation_errors: Array.isArray(guide.validation_errors)
        ? guide.validation_errors.map(String)
        : [],
    } : null,
    active_tiss_versions: versions.map((entry) => {
      const version = entry as Record<string, unknown>;
      return {
        id: numberValue(version.id),
        version: String(version.version || ""),
        scope: String(version.scope || "prestador_operadora"),
        effective_from: String(version.effective_from || ""),
        effective_until: version.effective_until ? String(version.effective_until) : null,
      };
    }),
    cash_session_open: booleanValue(row.cash_session_open),
    receivable: receivable ? {
      id: numberValue(receivable.id),
      status: String(receivable.status || "open"),
      amount: numberValue(receivable.amount),
      due_date: receivable.due_date ? String(receivable.due_date) : null,
    } : null,
  };
}

export function isReceptionGuideValid(summary: ReceptionCheckoutSummary): boolean {
  const guide = summary.guide;
  return Boolean(
    guide
    && ["validated", "signed"].includes(guide.status)
    && guide.validation_errors.length === 0,
  );
}

async function rpcSummary(functionName: string, parameters: Record<string, unknown>): Promise<ReceptionCheckoutSummary> {
  const { data, error } = await supabase.rpc(functionName, parameters);
  if (error) throw new Error(error.message);
  return normalizeReceptionCheckoutSummary(data);
}

export const receptionCheckoutService = {
  async getSummary(appointmentId: string): Promise<ReceptionCheckoutSummary> {
    return rpcSummary("get_reception_checkout_summary", {
      p_appointment_id: Number(appointmentId),
    });
  },

  async prepare(input: PrepareReceptionCheckoutInput): Promise<ReceptionCheckoutSummary> {
    return rpcSummary("prepare_reception_checkout_secure", {
      p_appointment_id: Number(input.appointmentId),
      p_payer_type: input.payerType,
      p_gross_amount: input.grossAmount,
      p_discount_amount: input.discountAmount,
      p_patient_responsibility: input.patientResponsibility,
      p_insurance_responsibility: input.insuranceResponsibility,
      p_collection_policy: input.collectionPolicy,
      p_due_date: input.dueDate || null,
      p_notes: input.notes?.trim() || null,
    });
  },

  async openCashSession(openingBalance = 0, notes?: string): Promise<void> {
    const { error } = await supabase.rpc("open_reception_cash_session_secure", {
      p_opening_balance: openingBalance,
      p_notes: notes?.trim() || null,
    });
    if (error) throw new Error(error.message);
  },

  async registerPayment(input: RegisterReceptionPaymentInput): Promise<ReceptionCheckoutSummary> {
    return rpcSummary("register_reception_payment_secure", {
      p_appointment_id: Number(input.appointmentId),
      p_amount: input.amount,
      p_payment_method: input.paymentMethod,
      p_idempotency_key: input.idempotencyKey,
      p_external_reference: input.externalReference?.trim() || null,
      p_installment_count: input.installmentCount || 1,
      p_notes: input.notes?.trim() || null,
    });
  },

  async generateGuide(
    appointmentId: string,
    guideType: ReceptionGuideType,
    tissVersionId?: number,
    manualGuideNumber?: string,
  ): Promise<ReceptionCheckoutSummary> {
    return rpcSummary("generate_reception_tiss_guide_secure", {
      p_appointment_id: Number(appointmentId),
      p_guide_type: guideType,
      p_tiss_version_id: tissVersionId || null,
      p_manual_guide_number: manualGuideNumber?.trim() || null,
    });
  },

  async validateGuide(guideId: number): Promise<ReceptionCheckoutSummary> {
    return rpcSummary("validate_reception_tiss_guide_secure", { p_guide_id: guideId });
  },

  async signGuide(guideId: number, signatureMethod: string): Promise<ReceptionCheckoutSummary> {
    return rpcSummary("sign_reception_tiss_guide_secure", {
      p_guide_id: guideId,
      p_signature_method: signatureMethod,
    });
  },
};

