/** Leitura canônica do Prontuário Eletrônico / PEP. */
import { supabase } from "@/lib/supabase";

export type EncounterStatus = "draft" | "signed" | "legacy_locked";

export interface Encounter {
  id: string;
  company_id: string | null;
  patient_id: number | null;
  professional_id: number | null;
  appointment_id: number | null;
  encounter_type: string | null;
  status: EncounterStatus;
  priority: string;
  chief_complaint: string | null;
  summary: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  patient_name: string | null;
}

export const ENCOUNTER_MUTATION_BLOCK_REASON =
  "Alterações clínicas e assinatura estão indisponíveis até a publicação das RPCs canônicas de atendimento.";

function blockUnsafeMutation(): never {
  throw new Error(ENCOUNTER_MUTATION_BLOCK_REASON);
}

export const ENC_STATUS_LABELS: Record<EncounterStatus, string> = {
  draft: "Rascunho",
  signed: "Assinado",
  legacy_locked: "Legado bloqueado",
};

export const encountersService = {
  async list(filters?: { status?: string; patient_id?: number }): Promise<Encounter[]> {
    let q = supabase.from("v_encounters_read_model").select("*");
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.patient_id !== undefined) q = q.eq("patient_id", filters.patient_id);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(`Erro ao buscar atendimentos: ${error.message}`);
    return (data || []) as unknown as Encounter[];
  },

  async get(id: string): Promise<Encounter | null> {
    const { data, error } = await supabase.from("v_encounters_read_model").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`Erro ao buscar atendimento: ${error.message}`);
    return (data as unknown as Encounter) || null;
  },

  async create(_input: Partial<Encounter>): Promise<Encounter> {
    return blockUnsafeMutation();
  },

  async update(_id: string, _updates: Partial<Encounter>): Promise<void> {
    blockUnsafeMutation();
  },

  async sign(_id: string): Promise<void> {
    blockUnsafeMutation();
  },

  // ── Log de acesso (auditoria/emergência) ──
  async logAccess(_patientId: number, _acao: string, _opts?: { encounter_id?: string; emergency?: boolean; justificativa?: string; user_name?: string }): Promise<void> {
    blockUnsafeMutation();
  },
};

