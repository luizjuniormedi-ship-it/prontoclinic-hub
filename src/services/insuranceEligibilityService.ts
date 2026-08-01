import { supabase } from "@/lib/supabase";

export type EligibilityStatus =
  | "elegivel" | "nao_elegivel" | "pendente" | "em_analise"
  | "portal_indisponivel" | "nao_obrigatoria" | "liberado_excecao"
  | "bloqueado" | "expirado" | "cancelado";

export const ELIGIBILITY_STATUSES = [
  "pendente",
  "em_analise",
  "elegivel",
  "nao_elegivel",
  "portal_indisponivel",
  "nao_obrigatoria",
  "liberado_excecao",
  "bloqueado",
  "expirado",
  "cancelado",
] as const satisfies readonly EligibilityStatus[];

export interface InsuranceEligibilityCheck {
  id: string;
  company_id: string;
  unit_id: number | null;
  patient_id: number | null;
  appointment_id: number | null;
  insurance_id: number | null;
  insurance_plan_id: number | null;
  card_number: string | null;
  request_channel: string | null;
  status: EligibilityStatus;
  protocol_number: string | null;
  source: string | null;
  result_code?: string | null;
  result_detail: string | null;
  proof_reference: string | null;
  valid_from: string | null;
  valid_until: string | null;
  block_reason?: string | null;
  blocked_reason?: string | null;
  exception_reason: string | null;
  checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EligibilityHistoryEntry {
  id: string;
  eligibility_id?: string;
  eligibility_check_id?: string;
  event_type?: string;
  old_status?: EligibilityStatus | null;
  new_status?: EligibilityStatus | null;
  from_status?: EligibilityStatus | null;
  to_status?: EligibilityStatus | null;
  protocol_number?: string | null;
  result_detail?: string | null;
  actor_id?: string | null;
  actor_user_id?: string | null;
  payload?: Record<string, unknown>;
  created_at: string;
}

type EligibilityInput = Partial<InsuranceEligibilityCheck> & {
  company_id?: string;
  patientId?: number | null;
  appointmentId?: number | null;
  insuranceId?: number | null;
  insurancePlanId?: number | null;
  unitId?: number | null;
  cardNumber?: string | null;
  requestChannel?: string | null;
  protocolNumber?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  resultCode?: string | null;
  resultDetail?: string | null;
  proofReference?: string | null;
  proofSha256?: string | null;
  proofContentType?: string | null;
  externalRequestId?: string | null;
  exceptionReason?: string | null;
  blockReason?: string | null;
};

const select = "id,company_id,unit_id,patient_id,appointment_id,insurance_id,insurance_plan_id,card_number,request_channel,status,protocol_number,source,result_code,result_detail,proof_reference,valid_from,valid_until,block_reason,exception_reason,checked_at,created_at,updated_at";

function rpcData<T>(data: T | T[] | null): T {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value) throw new Error("Resposta vazia do backend");
  return value;
}

export const insuranceEligibilityService = {
  async list(filters?: { appointmentId?: number; patientId?: number; status?: EligibilityStatus }): Promise<InsuranceEligibilityCheck[]> {
    let query = supabase.from("insurance_eligibility_checks").select(select).order("requested_at", { ascending: false }).limit(200);
    if (filters?.appointmentId) query = query.eq("appointment_id", filters.appointmentId);
    if (filters?.patientId) query = query.eq("patient_id", filters.patientId);
    if (filters?.status) query = query.eq("status", filters.status);
    const { data, error } = await query;
    if (error) throw new Error(`Erro ao listar elegibilidades: ${error.message}`);
    return (data || []) as InsuranceEligibilityCheck[];
  },

  async create(input: EligibilityInput): Promise<InsuranceEligibilityCheck> {
    const { data, error } = await supabase.rpc("create_insurance_eligibility_check_secure", {
      p_patient_id: input.patientId ?? input.patient_id ?? null,
      p_appointment_id: input.appointmentId ?? input.appointment_id ?? null,
      p_insurance_id: input.insuranceId ?? input.insurance_id ?? null,
      p_insurance_plan_id: input.insurancePlanId ?? input.insurance_plan_id ?? null,
      p_unit_id: input.unitId ?? input.unit_id ?? null,
      p_card_number: input.cardNumber ?? input.card_number ?? null,
      p_request_channel: input.requestChannel ?? input.request_channel ?? input.source ?? "manual",
      p_protocol_number: input.protocolNumber ?? input.protocol_number ?? null,
      p_valid_from: input.validFrom ?? input.valid_from ?? null,
      p_valid_until: input.validUntil ?? input.valid_until ?? null,
      p_status: input.status ?? "pendente",
      p_result_code: input.resultCode ?? input.result_code ?? null,
      p_result_detail: input.resultDetail ?? input.result_detail ?? null,
      p_proof_reference: input.proofReference ?? input.proof_reference ?? null,
      p_proof_sha256: input.proofSha256 ?? null,
      p_proof_content_type: input.proofContentType ?? null,
      p_external_request_id: input.externalRequestId ?? null,
      p_exception_reason: input.exceptionReason ?? input.exception_reason ?? null,
      p_block_reason: input.blockReason ?? input.block_reason ?? null,
    });
    if (error) throw new Error(`Erro ao criar consulta de elegibilidade: ${error.message}`);
    return rpcData(data) as InsuranceEligibilityCheck;
  },

  async update(id: string, input: EligibilityInput): Promise<InsuranceEligibilityCheck> {
    const { data, error } = await supabase.rpc("update_insurance_eligibility_check_secure", {
      p_eligibility_id: id,
      p_status: input.status ?? null,
      p_request_channel: input.requestChannel ?? input.request_channel ?? null,
      p_protocol_number: input.protocolNumber ?? input.protocol_number ?? null,
      p_valid_from: input.validFrom ?? input.valid_from ?? null,
      p_valid_until: input.validUntil ?? input.valid_until ?? null,
      p_result_code: input.resultCode ?? input.result_code ?? null,
      p_result_detail: input.resultDetail ?? input.result_detail ?? null,
      p_proof_reference: input.proofReference ?? input.proof_reference ?? null,
      p_proof_sha256: input.proofSha256 ?? null,
      p_proof_content_type: input.proofContentType ?? null,
      p_exception_reason: input.exceptionReason ?? input.exception_reason ?? null,
      p_block_reason: input.blockReason ?? input.block_reason ?? null,
    });
    if (error) throw new Error(`Erro ao atualizar elegibilidade: ${error.message}`);
    return rpcData(data) as InsuranceEligibilityCheck;
  },

  async listEvents(id: string): Promise<EligibilityHistoryEntry[]> {
    const { data, error } = await supabase.from("insurance_eligibility_events")
      .select("id,eligibility_check_id,event_type,from_status,to_status,payload,actor_user_id,created_at")
      .eq("eligibility_check_id", id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Erro ao carregar histórico de elegibilidade: ${error.message}`);
    return (data || []) as EligibilityHistoryEntry[];
  },

  async history(id: string): Promise<EligibilityHistoryEntry[]> {
    return this.listEvents(id);
  },
};
