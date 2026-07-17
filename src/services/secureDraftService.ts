import { supabase } from "@/lib/supabase";

type JsonObject = Record<string, unknown>;
type RpcError = { message: string } | null;

export interface SaveSecureDraftInput {
  sessionId: string;
  clientDeviceId: string;
  draftId?: string | null;
  unitId: number;
  contextType: "patient" | "appointment" | "encounter" | "medical_record" | "clinical_note";
  contextId: string;
  content: JsonObject;
  ttlMinutes?: number;
}

export interface GetSecureDraftInput {
  sessionId: string;
  clientDeviceId: string;
  draftId: string;
}

export interface SecureDraftRecord {
  id: string;
  unit_id?: number;
  context_type?: string;
  context_id?: string;
  content?: JsonObject;
  expires_at: string;
  updated_at?: string;
}

function throwIfError(error: RpcError): void {
  if (error) throw new Error(error.message);
}

/**
 * Rascunhos nunca são persistidos no browser por este serviço. O conteúdo segue
 * pela conexão autenticada ao RPC e é cifrado/decifrado no PostgreSQL com uma
 * chave mantida no Supabase Vault. A chave não é argumento nem retorno da API.
 */
export const secureDraftService = {
  async save(input: SaveSecureDraftInput): Promise<SecureDraftRecord> {
    const { data, error } = await supabase.rpc("save_secure_clinical_draft", {
      p_session_id: input.sessionId,
      p_client_device_id: input.clientDeviceId,
      p_draft_id: input.draftId ?? null,
      p_unit_id: input.unitId,
      p_context_type: input.contextType,
      p_context_id: input.contextId,
      p_content: input.content,
      p_ttl_minutes: input.ttlMinutes ?? 30,
    });
    throwIfError(error);
    if (!data || typeof data !== "object") throw new Error("Rascunho não persistido.");
    return data as unknown as SecureDraftRecord;
  },

  async get(input: GetSecureDraftInput): Promise<SecureDraftRecord> {
    const { data, error } = await supabase.rpc("get_secure_clinical_draft", {
      p_session_id: input.sessionId,
      p_client_device_id: input.clientDeviceId,
      p_draft_id: input.draftId,
    });
    throwIfError(error);
    if (!data || typeof data !== "object") throw new Error("Rascunho não encontrado ou expirado.");
    return data as unknown as SecureDraftRecord;
  },

  async list(sessionId: string, clientDeviceId: string): Promise<SecureDraftRecord[]> {
    const { data, error } = await supabase.rpc("list_secure_clinical_drafts", {
      p_session_id: sessionId,
      p_client_device_id: clientDeviceId,
    });
    throwIfError(error);
    return Array.isArray(data) ? data as SecureDraftRecord[] : [];
  },

  async remove(input: GetSecureDraftInput): Promise<void> {
    const { data, error } = await supabase.rpc("delete_secure_clinical_draft", {
      p_session_id: input.sessionId,
      p_client_device_id: input.clientDeviceId,
      p_draft_id: input.draftId,
    });
    throwIfError(error);
    if (data !== true) throw new Error("Rascunho não encontrado ou não removido.");
  },
};
