import { supabase } from "@/lib/supabase";

export type AuthorizationStatus = "pendente" | "solicitada" | "em_analise" | "autorizada" | "parcialmente_autorizada" | "negada" | "vencida" | "cancelada" | "reenviada" | "liberada_excecao" | "nao_necessaria";

export const AUTHORIZATION_STATUSES = [
  "pendente",
  "solicitada",
  "em_analise",
  "autorizada",
  "parcialmente_autorizada",
  "negada",
  "vencida",
  "cancelada",
  "reenviada",
  "liberada_excecao",
  "nao_necessaria",
] as const satisfies readonly AuthorizationStatus[];

export interface InsuranceAuthorization {
  id: string;
  company_id: string;
  unit_id: number | null;
  patient_id: number | null;
  appointment_id: number | null;
  insurance_id: number | null;
  insurance_plan_id: number | null;
  procedure_id?: number | null;
  procedure_code?: string | null;
  procedure_desc: string | null;
  request_reference?: string | null;
  diagnosis_code?: string | null;
  status: AuthorizationStatus;
  protocol_number: string | null;
  authorization_number: string | null;
  valid_from?: string | null;
  valid_until: string | null;
  quantity_requested: number;
  quantity_authorized: number;
  quantity_used: number;
  request_order?: Record<string, unknown>;
  cid_codes?: string[];
  justification: string | null;
  attachments?: unknown[];
  denial_reason?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthorizationHistoryEntry {
  id: string;
  authorization_id: string;
  old_status?: AuthorizationStatus | null;
  new_status?: AuthorizationStatus | null;
  from_status?: AuthorizationStatus | null;
  to_status?: AuthorizationStatus | null;
  event_type?: string;
  quantity_authorized?: number;
  quantity_used?: number;
  reason?: string | null;
  actor_id?: string | null;
  actor_user_id?: string | null;
  created_at: string;
}

type AuthorizationInput = Partial<InsuranceAuthorization> & {
  company_id?: string;
  unit_id?: number | null;
  patientId?: number | null;
  appointmentId?: number | null;
  insuranceId?: number | null;
  insurancePlanId?: number | null;
  procedureId?: number | null;
  procedureCode?: string | null;
  procedureDescription?: string | null;
  requestReference?: string | null;
  requestedProfessionalId?: number | null;
  diagnosisCode?: string | null;
  justification?: string | null;
  quantityRequested?: number;
  validFrom?: string | null;
  validUntil?: string | null;
};

const select = "id,company_id,unit_id,patient_id,appointment_id,insurance_id,insurance_plan_id,procedure_id,procedure_code,procedure_desc,request_reference,requested_professional_id,diagnosis_code,status,protocol_number,authorization_number,valid_from,valid_until,quantity_requested,quantity_authorized,quantity_used,justification,denial_reason,notes,created_at,updated_at";

function rpcData<T>(data: T | T[] | null): T {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value) throw new Error("Resposta vazia do backend");
  return value;
}

export const insuranceAuthorizationService = {
  async list(filters?: { appointmentId?: number; patientId?: number; status?: AuthorizationStatus; search?: string }): Promise<InsuranceAuthorization[]> {
    let query = supabase.from("insurance_authorizations").select(select).order("created_at", { ascending: false }).limit(200);
    if (filters?.appointmentId) query = query.eq("appointment_id", filters.appointmentId);
    if (filters?.patientId) query = query.eq("patient_id", filters.patientId);
    if (filters?.status) query = query.eq("status", filters.status);
    if (filters?.search?.trim()) {
      const term = filters.search.trim().replace(/[(),]/g, " ");
      query = query.or(`request_reference.ilike.%${term}%,protocol_number.ilike.%${term}%,authorization_number.ilike.%${term}%,procedure_code.ilike.%${term}%`);
    }
    const { data, error } = await query;
    if (error) throw new Error(`Erro ao listar autorizações: ${error.message}`);
    return (data || []) as InsuranceAuthorization[];
  },

  async create(input: AuthorizationInput): Promise<InsuranceAuthorization> {
    const { data, error } = await supabase.rpc("create_insurance_authorization_secure", {
      p_patient_id: input.patientId ?? input.patient_id ?? null,
      p_appointment_id: input.appointmentId ?? input.appointment_id ?? null,
      p_insurance_id: input.insuranceId ?? input.insurance_id ?? null,
      p_insurance_plan_id: input.insurancePlanId ?? input.insurance_plan_id ?? null,
      p_procedure_id: input.procedureId ?? input.procedure_id ?? null,
      p_procedure_code: input.procedureCode ?? input.procedure_code ?? null,
      p_procedure_desc: input.procedureDescription ?? input.procedure_desc ?? null,
      p_request_reference: input.requestReference ?? input.request_reference ?? null,
      p_requested_professional_id: input.requestedProfessionalId ?? null,
      p_diagnosis_code: input.diagnosisCode ?? input.diagnosis_code ?? null,
      p_justification: input.justification ?? null,
      p_quantity_requested: input.quantityRequested ?? input.quantity_requested ?? 1,
      p_valid_from: input.validFrom ?? input.valid_from ?? null,
      p_valid_until: input.validUntil ?? input.valid_until ?? null,
    });
    if (error) throw new Error(`Erro ao criar autorização: ${error.message}`);
    return rpcData(data) as InsuranceAuthorization;
  },

  async transition(input: { authorizationId: string; status: AuthorizationStatus; protocolNumber?: string | null; authorizationNumber?: string | null; passwordNumber?: string | null; validUntil?: string | null; quantityAuthorized?: number; quantityUsed?: number; reason?: string | null }): Promise<InsuranceAuthorization> {
    const { data, error } = await supabase.rpc("transition_insurance_authorization_secure", {
      p_authorization_id: input.authorizationId,
      p_status: input.status,
      p_protocol_number: input.protocolNumber ?? null,
      p_authorization_number: input.authorizationNumber ?? null,
      p_password_number: input.passwordNumber ?? null,
      p_valid_until: input.validUntil ?? null,
      p_quantity_authorized: input.quantityAuthorized ?? null,
      p_quantity_used: input.quantityUsed ?? null,
      p_reason: input.reason ?? null,
    });
    if (error) throw new Error(`Erro ao atualizar autorização: ${error.message}`);
    return rpcData(data) as InsuranceAuthorization;
  },

  async update(id: string, input: AuthorizationInput): Promise<InsuranceAuthorization> {
    return this.transition({
      authorizationId: id,
      status: input.status ?? "pendente",
      protocolNumber: input.protocol_number,
      authorizationNumber: input.authorization_number,
      validUntil: input.validUntil ?? input.valid_until,
      quantityAuthorized: input.quantity_authorized,
      quantityUsed: input.quantity_used,
      reason: input.denial_reason ?? input.notes,
    });
  },

  async createFollowup(input: { authorizationId: string; type: "renovacao" | "prorrogacao"; justification: string; validFrom?: string | null; validUntil?: string | null; quantityRequested?: number | null }): Promise<InsuranceAuthorization> {
    const { data, error } = await supabase.rpc("create_insurance_authorization_followup_secure", {
      p_authorization_id: input.authorizationId,
      p_followup_type: input.type,
      p_justification: input.justification,
      p_valid_from: input.validFrom ?? null,
      p_valid_until: input.validUntil ?? null,
      p_quantity_requested: input.quantityRequested ?? null,
    });
    if (error) throw new Error(`Erro ao criar seguimento da autorização: ${error.message}`);
    return rpcData(data) as InsuranceAuthorization;
  },

  async addAttachment(input: { authorizationId: string; storagePath: string; fileName: string; mimeType?: string; fileSize?: number | null; checksum?: string | null }): Promise<unknown> {
    const { data, error } = await supabase.rpc("add_insurance_authorization_attachment_secure", {
      p_authorization_id: input.authorizationId,
      p_storage_path: input.storagePath,
      p_file_name: input.fileName,
      p_mime_type: input.mimeType ?? "application/octet-stream",
      p_file_size: input.fileSize ?? null,
      p_checksum: input.checksum ?? null,
    });
    if (error) throw new Error(`Erro ao registrar anexo: ${error.message}`);
    return rpcData(data);
  },

  async consume(id: string, quantity: number): Promise<number> {
    const { data, error } = await supabase.rpc("consume_insurance_authorization", { p_authorization_id: id, p_quantity: quantity });
    if (error) throw new Error(`Erro ao consumir autorização: ${error.message}`);
    if (data === null || data === undefined) throw new Error("Quantidade indisponível ou autorização expirada");
    return Number(data);
  },

  async history(id: string): Promise<AuthorizationHistoryEntry[]> {
    const { data, error } = await supabase.from("insurance_authorization_events")
      .select("id,authorization_id,event_type,from_status,to_status,quantity_authorized,quantity_used,reason,actor_user_id,created_at")
      .eq("authorization_id", id).order("created_at", { ascending: false });
    if (error) throw new Error(`Erro ao carregar histórico de autorização: ${error.message}`);
    return (data || []) as AuthorizationHistoryEntry[];
  },

  async listHistory(id: string): Promise<AuthorizationHistoryEntry[]> {
    return this.history(id);
  },

  async listAttachments(id: string): Promise<Array<{ id: string; authorization_id: string; storage_path: string; file_name: string; mime_type: string; file_size: number | null; created_at: string }>> {
    const { data, error } = await supabase.from("insurance_authorization_attachments")
      .select("id,authorization_id,storage_path,file_name,mime_type,file_size,created_at")
      .eq("authorization_id", id).is("deleted_at", null).order("created_at", { ascending: false });
    if (error) throw new Error(`Erro ao carregar anexos da autorização: ${error.message}`);
    return data || [];
  },
};
