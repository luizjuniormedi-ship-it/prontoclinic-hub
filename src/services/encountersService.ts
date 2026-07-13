/**
 * encountersService — Prontuário Eletrônico / PEP (Fases 1 e 2)
 *
 * Consome o backend clínico: encounters, diagnósticos, lista de problemas,
 * alergias/medicações, segurança de prescrição, escalas e anamnese/exame estruturados.
 * Regras (bloqueio pós-assinatura, status_history, log de acesso) por trigger no Postgres.
 */
import { supabase } from "@/lib/supabase";

export type EncounterStatus =
  | "agendado" | "checkin_realizado" | "aguardando_triagem" | "em_triagem" | "triagem_concluida"
  | "aguardando_atendimento" | "em_atendimento" | "aguardando_exame" | "aguardando_retorno" | "em_observacao"
  | "em_procedimento" | "aguardando_prescricao" | "aguardando_assinatura" | "finalizado" | "assinado"
  | "reaberto" | "cancelado" | "faltou" | "alta_ambulatorial" | "encaminhado" | "internado";

export interface Encounter {
  id: string;
  patient_id: number | null;
  professional_id: number | null;
  appointment_id: number | null;
  encounter_type: string;
  status: EncounterStatus;
  priority: string;
  chief_complaint: string | null;
  summary: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  patient_name?: string;
}

export interface Diagnosis { id: number; encounter_id: string; cid_code: string; cid_description: string | null; diagnosis_type: string; status: string; }
export interface Problem { id: number; patient_id: number; cid_code: string | null; problem_description: string; status: string; severity: string | null; }
export interface Allergy { id: number; patient_id: number; allergen: string; reaction: string | null; severity: string; status: string; }
export interface Medication { id: number; patient_id: number; medication: string; dose: string | null; frequency: string | null; status: string; }
export interface SafetyAlert { alert_type: string; severity: string; descricao: string; }

export const ENCOUNTER_MUTATION_BLOCK_REASON =
  "Alterações clínicas e assinatura estão indisponíveis até a publicação das RPCs canônicas de atendimento.";

function blockUnsafeMutation(): never {
  throw new Error(ENCOUNTER_MUTATION_BLOCK_REASON);
}

export const ENC_STATUS_LABELS: Partial<Record<EncounterStatus, string>> = {
  aguardando_atendimento: "Aguardando atendimento", em_atendimento: "Em atendimento",
  aguardando_assinatura: "Aguardando assinatura", finalizado: "Finalizado", assinado: "Assinado",
  reaberto: "Reaberto", cancelado: "Cancelado", alta_ambulatorial: "Alta", encaminhado: "Encaminhado",
  internado: "Internado", em_observacao: "Em observação", em_triagem: "Em triagem",
};

export const encountersService = {
  async list(filters?: { status?: string; patient_id?: number }): Promise<Encounter[]> {
    let q = supabase.from("encounters").select("*").is("deleted_at", null)
      .order("created_at", { ascending: false }).limit(200);
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.patient_id) q = q.eq("patient_id", filters.patient_id);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data || []) as unknown as Encounter[];
    const pids = [...new Set(rows.map((r) => r.patient_id).filter(Boolean))];
    const nameById: Record<string, string> = {};
    if (pids.length > 0) {
      const { data: pats, error: patientsError } = await supabase.from("patients").select("id, full_name").in("id", pids as number[]);
      if (patientsError) throw new Error(`Erro ao identificar pacientes: ${patientsError.message}`);
      for (const p of (pats || []) as Array<{ id: number; full_name: string }>) nameById[String(p.id)] = p.full_name;
    }
    return rows.map((r) => ({ ...r, patient_name: r.patient_id ? nameById[String(r.patient_id)] : undefined }));
  },

  async get(id: string): Promise<Encounter | null> {
    const { data, error } = await supabase.from("encounters").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
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

  // ── Diagnósticos ──
  async diagnoses(encounterId: string): Promise<Diagnosis[]> {
    const { data, error } = await supabase.from("encounter_diagnoses").select("*").eq("encounter_id", encounterId);
    if (error) throw new Error(error.message);
    return (data || []) as unknown as Diagnosis[];
  },
  async addDiagnosis(_diagnosis: { encounter_id: string; patient_id: number; cid_code: string; cid_description?: string; diagnosis_type?: string; status?: string }): Promise<void> {
    blockUnsafeMutation();
  },

  // ── Problemas / Alergias / Medicações (por paciente) ──
  async problems(patientId: number): Promise<Problem[]> {
    const { data, error } = await supabase.from("patient_problem_list").select("*").eq("patient_id", patientId);
    if (error) throw new Error(error.message);
    return (data || []) as unknown as Problem[];
  },
  async allergies(patientId: number): Promise<Allergy[]> {
    const { data, error } = await supabase.from("patient_allergies").select("*").eq("patient_id", patientId).eq("status", "ativa");
    if (error) throw new Error(error.message);
    return (data || []) as unknown as Allergy[];
  },
  async medications(patientId: number): Promise<Medication[]> {
    const { data, error } = await supabase.from("patient_medications").select("*").eq("patient_id", patientId).eq("status", "em_uso");
    if (error) throw new Error(error.message);
    return (data || []) as unknown as Medication[];
  },
  async addAllergy(_patientId: number, _allergen: string, _severity = "moderada", _reaction?: string): Promise<void> {
    blockUnsafeMutation();
  },
  async addProblem(_patientId: number, _description: string, _cid?: string, _severity?: string): Promise<void> {
    blockUnsafeMutation();
  },

  // ── Segurança de prescrição (RPC) ──
  async checkPrescriptionSafety(patientId: number, medication: string): Promise<SafetyAlert[]> {
    const { data, error } = await supabase.rpc("check_prescription_safety", { p_patient_id: patientId, p_medication: medication });
    if (error) throw new Error(error.message);
    // RPC retorna array de tuplas ou objetos; normaliza para {alert_type,severity,descricao}
    const raw = data as unknown;
    if (Array.isArray(raw)) {
      return raw.map((x) => {
        if (typeof x === "object" && x !== null) return x as SafetyAlert;
        // tupla string "(alergia,grave,\"...\")"
        const s = String(x).replace(/^\(|\)$/g, "");
        const parts = s.split(",");
        return { alert_type: parts[0] || "", severity: parts[1] || "", descricao: parts.slice(2).join(",").replace(/^"|"$/g, "") };
      });
    }
    return [];
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
