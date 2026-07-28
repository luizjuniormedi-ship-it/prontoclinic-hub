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
  async list(companyId: string): Promise<TissGuide[]> {
    const { data, error } = await supabase
      .from("tiss_guides")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as TissGuide[];
  },

  async create(input: {
    guideType: TissGuideType;
    appointmentId?: number;
    unitId?: number;
    billingAccountId?: string;
    sourceXmlId?: number;
    environment?: "HOMOLOGACAO" | "PRODUCAO";
  }): Promise<TissGuide> {
    const errors = validateTissGuideDraft({ guideType: input.guideType, tissVersion: "4.03.00", environment: input.environment });
    if (errors.length) throw new Error(errors.join("; "));
    const { data, error } = await supabase.rpc("create_tiss_guide_secure", {
      p_guide_type: input.guideType,
      p_appointment_id: input.appointmentId ?? null,
      p_unit_id: input.unitId ?? null,
      p_billing_account_id: input.billingAccountId ?? null,
      p_source_xml_id: input.sourceXmlId ?? null,
      p_environment: input.environment ?? "HOMOLOGACAO",
    });
    if (error) throw error;
    return data as TissGuide;
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

