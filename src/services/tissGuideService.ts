import { supabase } from "@/lib/supabase";

export const TISS_GUIDE_TYPES = [
  "CONSULTA",
  "SP/SADT",
  "INTERNACAO",
  "RESUMO_INTERNACAO",
  "HONORARIO",
  "OUTRAS_DESPESAS",
  "RECURSO_GLOSA",
] as const;
export type TissGuideType = (typeof TISS_GUIDE_TYPES)[number];

export const TISS_GUIDE_STATUSES = ["DRAFT", "VALIDATED", "SIGNED", "CANCELLED", "SUBSTITUTED"] as const;
export type TissGuideStatus = (typeof TISS_GUIDE_STATUSES)[number];

export interface TissGuide {
  id: string;
  company_id: string;
  unit_id: number | null;
  appointment_id: number | null;
  billing_account_id: string | null;
  source_xml_id: number | null;
  substitution_of_id: string | null;
  guide_number: number;
  guide_type: TissGuideType;
  status: TissGuideStatus;
  tiss_version: string;
  environment: "HOMOLOGACAO" | "PRODUCAO";
  validation_errors: string[];
  signed_by: string | null;
  signed_at: string | null;
  signature_sha256: string | null;
  signature_reference: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  substitution_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TissAccountMaterialization {
  billing_account_id: string;
  appointment_id: number;
  unit_id: number;
  guide_id: string;
  guide_number: number;
  xml_id: number;
  environment: "HOMOLOGACAO" | "PRODUCAO";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Materializacao TISS retornou ${field} invalido`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Materializacao TISS retornou ${field} invalido`);
  }
  return parsed;
}

function decodeAccountMaterialization(
  value: unknown,
  expectedBillingAccountId: string,
  expectedAppointmentId: number,
): TissAccountMaterialization {
  if (!isRecord(value)) {
    throw new Error("Materializacao TISS retornou resposta invalida");
  }

  const billingAccountId = requiredString(value.billing_account_id, "billing_account_id");
  const appointmentId = positiveInteger(value.appointment_id, "appointment_id");
  const environment = value.environment;
  if (billingAccountId !== expectedBillingAccountId || appointmentId !== expectedAppointmentId) {
    throw new Error("Materializacao TISS retornou conta ou agendamento divergente");
  }
  if (environment !== "HOMOLOGACAO" && environment !== "PRODUCAO") {
    throw new Error("Materializacao TISS retornou environment invalido");
  }

  return {
    billing_account_id: billingAccountId,
    appointment_id: appointmentId,
    unit_id: positiveInteger(value.unit_id, "unit_id"),
    guide_id: requiredString(value.guide_id, "guide_id"),
    guide_number: positiveInteger(value.guide_number, "guide_number"),
    xml_id: positiveInteger(value.xml_id, "xml_id"),
    environment,
  };
}

const transitions: Record<TissGuideStatus, readonly TissGuideStatus[]> = {
  DRAFT: ["VALIDATED", "CANCELLED"],
  VALIDATED: ["SIGNED", "CANCELLED"],
  SIGNED: ["CANCELLED", "SUBSTITUTED"],
  CANCELLED: [],
  SUBSTITUTED: [],
};

export function canTransitionTissGuide(from: TissGuideStatus, to: TissGuideStatus): boolean {
  return transitions[from].includes(to);
}

export function validateTissGuideDraft(input: {
  guideType: string;
  tissVersion?: string;
  environment?: string;
  validationErrors?: string[];
}): string[] {
  const errors: string[] = [];
  if (!TISS_GUIDE_TYPES.includes(input.guideType as TissGuideType)) errors.push("Tipo de guia TISS invalido");
  if (!input.tissVersion?.trim()) errors.push("Versao TISS obrigatoria");
  if (input.environment && !["HOMOLOGACAO", "PRODUCAO"].includes(input.environment)) errors.push("Ambiente TISS invalido");
  if (input.validationErrors?.length) errors.push(...input.validationErrors);
  return errors;
}

export function assertSignedGuideImmutable(before: Pick<TissGuide, "status">, after: Pick<TissGuide, "status">): void {
  if (["SIGNED", "CANCELLED", "SUBSTITUTED"].includes(before.status) && before.status !== after.status) {
    throw new Error("Guia TISS encerrada nao pode ser alterada diretamente");
  }
}

export const tissGuideService = {
  async materializeAccount(input: {
    billingAccountId: string;
    expectedAppointmentId: number;
    expectedAccountVersion: number;
    guideType?: "SP/SADT";
    environment?: "HOMOLOGACAO" | "PRODUCAO";
  }): Promise<TissAccountMaterialization> {
    if (!input.billingAccountId.trim()) throw new Error("Conta de faturamento obrigatoria");
    if (!Number.isSafeInteger(input.expectedAppointmentId) || input.expectedAppointmentId <= 0) {
      throw new Error("Agendamento da conta invalido");
    }
    if (!Number.isSafeInteger(input.expectedAccountVersion) || input.expectedAccountVersion <= 0) {
      throw new Error("Versao da conta invalida");
    }
    const { data, error } = await supabase.rpc("m16_materialize_account_tiss_secure", {
      p_operation_id: crypto.randomUUID(),
      p_billing_account_id: input.billingAccountId,
      p_expected_account_version: input.expectedAccountVersion,
      p_guide_type: input.guideType ?? "SP/SADT",
      p_environment: input.environment ?? "HOMOLOGACAO",
    });
    if (error) throw new Error(error.message);
    return decodeAccountMaterialization(data, input.billingAccountId, input.expectedAppointmentId);
  },

  async list(companyId: string): Promise<TissGuide[]> {
    if (!companyId) throw new Error("Empresa obrigatória para consultar guias TISS");
    const { data, error } = await supabase.rpc("m16_list_guides_secure", {
      p_status: null,
      p_limit: 500,
    });
    if (error) throw error;
    return ((data ?? []) as Array<Partial<TissGuide>>).map((guide) => ({
      ...guide,
      company_id: companyId,
      validation_errors: [],
      signed_by: null,
      signature_sha256: null,
      signature_reference: null,
      cancelled_by: null,
      cancellation_reason: null,
      substitution_reason: null,
      created_by: null,
    })) as TissGuide[];
  },

  async validate(id: string, errors: string[] = []): Promise<TissGuide> {
    const { data, error } = await supabase.rpc("validate_tiss_guide_secure", { p_guide_id: id, p_errors: errors });
    if (error) throw error;
    return data as TissGuide;
  },

  async sign(id: string, signatureSha256: string, reference?: string): Promise<TissGuide> {
    if (signatureSha256.trim().length < 32) throw new Error("Hash de assinatura obrigatorio");
    const { data, error } = await supabase.rpc("sign_tiss_guide_secure", {
      p_guide_id: id,
      p_signature_sha256: signatureSha256,
      p_signature_reference: reference ?? null,
    });
    if (error) throw error;
    return data as TissGuide;
  },

  async cancel(id: string, reason: string): Promise<TissGuide> {
    if (!reason.trim()) throw new Error("Motivo do cancelamento obrigatorio");
    const { data, error } = await supabase.rpc("cancel_tiss_guide_secure", { p_guide_id: id, p_reason: reason });
    if (error) throw error;
    return data as TissGuide;
  },

  async substitute(id: string, reason: string): Promise<TissGuide> {
    if (!reason.trim()) throw new Error("Motivo da substituicao obrigatorio");
    const { data, error } = await supabase.rpc("substitute_tiss_guide_secure", { p_guide_id: id, p_reason: reason });
    if (error) throw error;
    return data as TissGuide;
  },

  async linkXml(guideId: string, xmlId: number): Promise<boolean> {
    const { data, error } = await supabase.rpc("link_tiss_xml_guide_secure", { p_guide_id: guideId, p_xml_id: xmlId });
    if (error) throw error;
    return Boolean(data);
  },
};

