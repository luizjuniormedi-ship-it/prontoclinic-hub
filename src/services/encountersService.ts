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

  // ── Escalas ──
  async scores(): Promise<Array<{ code: string; name: string; category: string }>> {
    const { data, error } = await supabase.from("clinical_scores").select("code, name, category").order("name");
    if (error) throw new Error(error.message);
    return (data || []) as unknown as Array<{ code: string; name: string; category: string }>;
  },
  async calcImc(peso: number, alturaCm: number): Promise<{ imc: number; classificacao: string } | null> {
    const { data, error } = await supabase.rpc("calc_imc", { p_peso: peso, p_altura_cm: alturaCm });
    if (error) throw new Error(error.message);
    const raw = data as unknown;
    if (Array.isArray(raw) && raw.length > 0) {
      const x = raw[0];
      if (typeof x === "object" && x !== null) return x as { imc: number; classificacao: string };
      const s = String(x).replace(/^\(|\)$/g, "").split(",");
      return { imc: parseFloat(s[0]), classificacao: (s[1] || "").replace(/^"|"$/g, "") };
    }
    return null;
  },
  async saveScoreResult(_result: { patient_id: number; encounter_id?: string; score_code: string; inputs: Record<string, unknown>; result: number; classification: string }): Promise<void> {
    blockUnsafeMutation();
  },

  // ── Templates / Checklists ──
  async templates(specialty?: string): Promise<Array<{ id: number; specialty: string; template_type: string; name: string; content: string }>> {
    let q = supabase.from("clinical_templates").select("*").eq("lg_ativo", true);
    if (specialty) q = q.eq("specialty", specialty);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []) as unknown as Array<{ id: number; specialty: string; template_type: string; name: string; content: string }>;
  },

  // ── Tarefas clínicas ──
  async tasks(filters?: { status?: string; module?: string }): Promise<Array<{ id: number; description: string; target_module: string; priority: string; status: string; patient_id: number }>> {
    let q = supabase.from("clinical_tasks").select("*").order("created_at", { ascending: false }).limit(100);
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.module) q = q.eq("target_module", filters.module);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []) as unknown as Array<{ id: number; description: string; target_module: string; priority: string; status: string; patient_id: number }>;
  },
  async createTask(_task: { patient_id: number; encounter_id?: string; target_module: string; description: string; priority?: string }): Promise<void> {
    blockUnsafeMutation();
  },
  async completeTask(_id: number): Promise<void> {
    blockUnsafeMutation();
  },

  // ── Timeline clínica longitudinal ──
  async timeline(patientId: number): Promise<Array<{ event_type: string; event_id: string; event_date: string | null; title: string | null; detail: string | null; professional: string | null }>> {
    const { data, error } = await supabase.from("v_patient_timeline")
      .select("*").eq("patient_id", patientId).order("event_date", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return (data || []) as unknown as Array<{ event_type: string; event_id: string; event_date: string | null; title: string | null; detail: string | null; professional: string | null }>;
  },

  // ── Prescrições (para receita digital) ──
  async prescriptions(patientId: number): Promise<Array<{ id: number; ds_prescricao: string | null; dt_prescricao: string | null }>> {
    const { data, error } = await supabase.from("prescricoes_medicas").select("id, ds_prescricao, dt_prescricao")
      .eq("patient_id", patientId).order("dt_prescricao", { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    return (data || []) as unknown as Array<{ id: number; ds_prescricao: string | null; dt_prescricao: string | null }>;
  },

  // ── Log de acesso (auditoria/emergência) ──
  async logAccess(_patientId: number, _acao: string, _opts?: { encounter_id?: string; emergency?: boolean; justificativa?: string; user_name?: string }): Promise<void> {
    blockUnsafeMutation();
  },
};

