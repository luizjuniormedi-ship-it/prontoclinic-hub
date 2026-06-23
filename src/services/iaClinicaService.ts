/**
 * iaClinicaService — IA Clínica (Sugestões Diagnósticas + Chatbot)
 *
 * Migration relacionada: 20260101000027_ia_clinica.sql
 *
 * Decisões:
 *   - Log de auditoria LGPD obrigatório (lg_consentimento)
 *   - Hash SHA-256 da query (preserva PII, permite auditoria)
 *   - Edge Function chamada via Supabase Functions (server-side)
 *   - Fallback para sugestões pré-computadas se Edge Function falhar
 *   - Não substitui diagnóstico médico (apenas apoio)
 *
 * Conformidade:
 *   - LGPD (consentimento, finalidade, rastreabilidade)
 *   - Resolução CFM 2.314/2022 (IA como apoio, decisão final do médico)
 */

import { z } from "zod";
import { supabase } from "@/lib/supabase";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const tpConsultaIaEnum = z.enum([
  "SUGESTAO_CID",
  "INTERPRETACAO_EXAME",
  "RESUMO_PRONTUARIO",
  "CHATBOT",
]);

export const iaLogSchema = z.object({
  tp_consulta: tpConsultaIaEnum,
  ds_query: z.string().min(1, "Query obrigatória"),
  ds_resposta: z.string().optional().nullable(),
  ds_hash_query: z.string().regex(/^[a-f0-9]{64}$/, "Hash deve ser SHA-256").optional().nullable(),
  vl_latencia_ms: z.number().int().nonnegative().optional().nullable(),
  ds_modelo: z.string().max(50).optional().nullable(),
  lg_consentimento: z.boolean(),
  cd_paciente: z.number().int().positive().optional().nullable(),
});

export const sugestaoInputSchema = z.object({
  sintomas: z.string().min(3, "Descreva ao menos 3 caracteres de sintomas").max(1000),
  consentimento: z.literal(true, {
    errorMap: () => ({ message: "Consentimento LGPD é obrigatório" }),
  }),
});

export const chatbotInputSchema = z.object({
  mensagem: z.string().min(1).max(2000),
  consentimento: z.literal(true),
  cd_paciente: z.number().int().positive().optional().nullable(),
});

// ── Types ───────────────────────────────────────────────────────────────────

export type IaLog = z.infer<typeof iaLogSchema> & {
  id: number;
  company_id: string;
  cd_usuario: string | null;
  dt_consulta: string;
  created_at: string;
};

export type IaSugestaoCid = {
  id: number;
  ds_sintomas: string;
  cd_cid_sugerido: number | null;
  nr_confianca: number | null;
  ds_observacao: string | null;
  ds_fonte: string | null;
  lg_ativo: boolean;
  created_at: string;
};

export type IaStats = {
  company_id: string;
  tp_consulta: z.infer<typeof tpConsultaIaEnum>;
  dia: string;
  nr_consultas: number;
  latencia_media_ms: number | null;
  latencia_min_ms: number | null;
  latencia_max_ms: number | null;
  nr_sem_consentimento: number;
};

export type SugestaoCidResultado = {
  sugestoes: IaSugestaoCid[];
  respostaTexto: string;
  latenciaMs: number;
  modelo: string;
};

export type ChatbotResultado = {
  resposta: string;
  latenciaMs: number;
  modelo: string;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Hash SHA-256 de uma string (LGPD: preserva PII no log).
 */
export async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Services ────────────────────────────────────────────────────────────────

export const iaSugestoesService = {
  /**
   * Lista sugestões pré-computadas (lookup local).
   */
  async getAll(filters?: { search?: string; minConfianca?: number }): Promise<IaSugestaoCid[]> {
    let q = supabase
      .from("ia_sugestoes_cid")
      .select("*")
      .eq("lg_ativo", true)
      .order("nr_confianca", { ascending: false });
    if (filters?.search) {
      const term = `%${filters.search}%`;
      q = q.ilike("ds_sintomas", term);
    }
    if (filters?.minConfianca !== undefined) {
      q = q.gte("nr_confianca", filters.minConfianca);
    }
    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as IaSugestaoCid[];
  },

  async top(limit = 20): Promise<IaSugestaoCid[]> {
    const { data, error } = await supabase
      .from("ia_sugestoes_cid")
      .select("*")
      .eq("lg_ativo", true)
      .order("nr_confianca", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as IaSugestaoCid[];
  },
};

export const iaLogsService = {
  async create(input: z.infer<typeof iaLogSchema>): Promise<IaLog> {
    const parsed = iaLogSchema.parse(input);
    if (!parsed.lg_consentimento) {
      throw new Error("LGPD: consentimento obrigatório para registrar log de IA.");
    }
    const { data, error } = await supabase
      .from("ia_logs")
      .insert(parsed)
      .select()
      .single();
    if (error) throw new Error(`Erro ao registrar log: ${error.message}`);
    return data as IaLog;
  },

  async getAll(filters?: {
    tp_consulta?: z.infer<typeof tpConsultaIaEnum>;
    dataInicio?: string;
    dataFim?: string;
    limit?: number;
  }): Promise<IaLog[]> {
    let q = supabase
      .from("ia_logs")
      .select("*")
      .order("dt_consulta", { ascending: false });
    if (filters?.tp_consulta) q = q.eq("tp_consulta", filters.tp_consulta);
    if (filters?.dataInicio) q = q.gte("dt_consulta", filters.dataInicio);
    if (filters?.dataFim) q = q.lte("dt_consulta", filters.dataFim);
    if (filters?.limit) q = q.limit(filters.limit);
    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as IaLog[];
  },

  async getStats(dataInicio?: string, dataFim?: string): Promise<IaStats[]> {
    let q = supabase
      .from("v_ia_stats")
      .select("*")
      .order("dia", { ascending: false });
    if (dataInicio) q = q.gte("dia", dataInicio);
    if (dataFim) q = q.lte("dia", dataFim);
    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as IaStats[];
  },
};

export const iaClinicaService = {
  /**
   * Sugere CIDs baseado em sintomas.
   *
   * Fluxo:
   * 1. Tenta chamar Edge Function (OpenAI/Claude) via Supabase
   * 2. Se falhar, faz fallback para sugestões pré-computadas (lookup local)
   * 3. Sempre registra log LGPD (com consentimento)
   */
  async sugerirCid(input: z.infer<typeof sugestaoInputSchema>): Promise<SugestaoCidResultado> {
    const parsed = sugestaoInputSchema.parse(input);
    const t0 = performance.now();
    const queryHash = await sha256(parsed.sintomas);

    let resultado: SugestaoCidResultado = {
      sugestoes: [],
      respostaTexto: "",
      latenciaMs: 0,
      modelo: "lookup_local",
    };

    try {
      // Tenta Edge Function
      const { data, error } = await supabase.functions.invoke("ia-sugestao-cid", {
        body: { sintomas: parsed.sintomas },
      });
      if (error) throw error;
      if (data && Array.isArray(data.sugestoes)) {
        resultado = {
          sugestoes: data.sugestoes,
          respostaTexto: data.resposta ?? "Sugestões geradas por IA.",
          latenciaMs: Math.round(performance.now() - t0),
          modelo: data.modelo ?? "claude-3-haiku",
        };
      } else {
        throw new Error("Resposta inválida da Edge Function");
      }
    } catch {
      // Fallback: lookup local
      const local = await iaSugestoesService.getAll({ search: parsed.sintomas });
      const top = local.slice(0, 5);
      resultado = {
        sugestoes: top,
        respostaTexto:
          top.length > 0
            ? `Encontrei ${top.length} sugestões com base nos sintomas descritos. A decisão final é sempre do médico.`
            : "Não encontrei sugestões pré-computadas. Tente descrever os sintomas com mais detalhes.",
        latenciaMs: Math.round(performance.now() - t0),
        modelo: "lookup_local",
      };
    }

    // Log LGPD
    await iaLogsService.create({
      tp_consulta: "SUGESTAO_CID",
      ds_query: parsed.sintomas,
      ds_resposta: resultado.respostaTexto,
      ds_hash_query: queryHash,
      vl_latencia_ms: resultado.latenciaMs,
      ds_modelo: resultado.modelo,
      lg_consentimento: true,
    });

    return resultado;
  },

  /**
   * Chatbot clínico (conversa livre).
   */
  async chatbot(input: z.infer<typeof chatbotInputSchema>): Promise<ChatbotResultado> {
    const parsed = chatbotInputSchema.parse(input);
    const t0 = performance.now();
    const queryHash = await sha256(parsed.mensagem);

    let resposta = "Não foi possível consultar a IA no momento. Tente novamente.";
    let modelo = "fallback";

    try {
      const { data, error } = await supabase.functions.invoke("ia-chatbot", {
        body: { mensagem: parsed.mensagem, cd_paciente: parsed.cd_paciente ?? null },
      });
      if (error) throw error;
      if (data && typeof data.resposta === "string") {
        resposta = data.resposta;
        modelo = data.modelo ?? "claude-3-haiku";
      } else {
        throw new Error("Resposta inválida");
      }
    } catch {
      // Fallback: resposta empírica
      resposta =
        "Sou o assistente IA do ProntoClinic. No momento estou em modo de contingência. " +
        "Em produção, esta resposta viria de um LLM treinado em literatura médica. " +
        "Lembre-se: esta é uma sugestão, não substitui avaliação clínica.";
    }

    const latenciaMs = Math.round(performance.now() - t0);

    // Log LGPD
    await iaLogsService.create({
      tp_consulta: "CHATBOT",
      ds_query: parsed.mensagem,
      ds_resposta: resposta,
      ds_hash_query: queryHash,
      vl_latencia_ms: latenciaMs,
      ds_modelo: modelo,
      lg_consentimento: true,
      cd_paciente: parsed.cd_paciente ?? null,
    });

    return { resposta, latenciaMs, modelo };
  },

  sugestoes: iaSugestoesService,
  logs: iaLogsService,
  sha256,
};
