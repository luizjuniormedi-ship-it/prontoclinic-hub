/**
 * paService — Pronto Atendimento
 *
 * Migration relacionada: 20260101000025_pa.sql
 *
 * Decisões:
 *   - Fila ordenada por Manchester (VERMELHO primeiro) + tempo de espera
 *   - NEWS2 score armazenado para detecção precoce de deterioração
 *   - Workflow de status (AGUARDANDO → TRIAGEM → ATENDIMENTO → ALTA)
 *   - View v_pa_fila para painel em tempo real
 *
 * Conformidade:
 *   - Portaria GM/MS 2.048/2002 (urgência/emergência)
 *   - HumanizaSUS (acolhimento com classificação de risco)
 */

import { z } from "zod";
import { supabase } from "@/lib/supabase";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const corRiscoEnum = z.enum([
  "VERMELHO",
  "LARANJA",
  "AMARELO",
  "VERDE",
  "AZUL",
]);

export const tpStatusPaEnum = z.enum([
  "AGUARDANDO",
  "EM_TRIAGEM",
  "EM_ATENDIMENTO",
  "EM_OBSERVACAO",
  "ALTA",
  "EVADIDO",
]);

export const tpDestinoEnum = z.enum([
  "ALTA_MELHORADO",
  "ALTA_PEDIDO",
  "INTERNACAO",
  "TRANSFERENCIA",
  "OBITO",
  "EVASAO",
]);

export const paAtendimentoSchema = z.object({
  cd_paciente: z.number().int().positive(),
  dt_chegada: z.string().optional().nullable(),
  dt_triagem: z.string().optional().nullable(),
  dt_atendimento_medico: z.string().optional().nullable(),
  cd_classificacao_id: z.number().int().positive().optional().nullable(),
  cd_cor_risco: corRiscoEnum.optional().nullable(),
  vl_news2_score: z.number().int().min(0).max(20).optional().nullable(),
  ds_queixa_principal: z.string().optional().nullable(),
  ds_observacoes: z.string().optional().nullable(),
  cd_medico_atendimento: z.number().int().positive().optional().nullable(),
  cd_triagem_id: z.number().int().positive().optional().nullable(),
  tp_status: tpStatusPaEnum.default("AGUARDANDO"),
});

export const triagemSchema = z.object({
  id: z.number().int().positive(),
  dt_triagem: z.string().optional().nullable(),
  cd_cor_risco: corRiscoEnum,
  vl_news2_score: z.number().int().min(0).max(20).optional().nullable(),
  ds_queixa_principal: z.string().optional().nullable(),
});

export const atendimentoMedicoSchema = z.object({
  cd_medico_atendimento: z.number().int().positive(),
  ds_observacoes: z.string().optional().nullable(),
});

export const altaPaSchema = z.object({
  tp_destino: tpDestinoEnum,
  ds_observacoes: z.string().optional().nullable(),
  cd_leito_internacao: z.number().int().positive().optional().nullable(),
});

// ── Types ───────────────────────────────────────────────────────────────────

export type PaAtendimento = z.infer<typeof paAtendimentoSchema> & {
  id: number;
  company_id: string;
  dt_chegada: string;
  dt_alta: string | null;
  tp_destino: z.infer<typeof tpDestinoEnum> | null;
  cd_leito_internacao: number | null;
  cd_origem_sigh?: number | null;
  created_at: string;
};

export type PaFilaItem = {
  id: number;
  company_id: string;
  cd_paciente: number;
  dt_chegada: string;
  dt_triagem: string | null;
  dt_atendimento_medico: string | null;
  tp_status: z.infer<typeof tpStatusPaEnum>;
  cd_cor_risco: z.infer<typeof corRiscoEnum> | null;
  vl_news2_score: number | null;
  cd_classificacao_id: number | null;
  cd_medico_atendimento: number | null;
  ds_queixa_principal: string | null;
  nr_prioridade: number;
  nr_minutos_espera: number;
};

export type CorRisco = z.infer<typeof corRiscoEnum>;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Calcula o tempo médio de espera (em minutos) por cor de risco.
 */
export const TEMPO_MAX_ESPERA_MIN: Record<CorRisco, number> = {
  VERMELHO: 0,    // emergência: atendimento imediato
  LARANJA: 10,    // muito urgente
  AMARELO: 60,    // urgente
  VERDE: 120,     // pouco urgente
  AZUL: 240,      // não urgente
};

export function tempoLimiteExcedido(cor: CorRisco | null, minutosEspera: number): boolean {
  if (!cor) return false;
  return minutosEspera > TEMPO_MAX_ESPERA_MIN[cor];
}

// ── Services ────────────────────────────────────────────────────────────────

export const paService = {
  async getAll(filters?: {
    cd_paciente?: number;
    tp_status?: z.infer<typeof tpStatusPaEnum>;
    dataInicio?: string;
    dataFim?: string;
  }): Promise<PaAtendimento[]> {
    let q = supabase
      .from("pa_atendimentos")
      .select("*")
      .order("dt_chegada", { ascending: false });
    if (filters?.cd_paciente) q = q.eq("cd_paciente", filters.cd_paciente);
    if (filters?.tp_status) q = q.eq("tp_status", filters.tp_status);
    if (filters?.dataInicio) q = q.gte("dt_chegada", filters.dataInicio);
    if (filters?.dataFim) q = q.lte("dt_chegada", filters.dataFim);
    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as PaAtendimento[];
  },

  async getFila(): Promise<PaFilaItem[]> {
    const { data, error } = await supabase
      .from("v_pa_fila")
      .select("*")
      .order("nr_prioridade", { ascending: true })
      .order("dt_chegada", { ascending: true });
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as PaFilaItem[];
  },

  async getById(id: number): Promise<PaAtendimento | null> {
    const { data, error } = await supabase
      .from("pa_atendimentos")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data as PaAtendimento) ?? null;
  },

  async create(input: z.infer<typeof paAtendimentoSchema>): Promise<PaAtendimento> {
    const parsed = paAtendimentoSchema.parse(input);
    const { data, error } = await supabase
      .from("pa_atendimentos")
      .insert({
        ...parsed,
        dt_chegada: parsed.dt_chegada ?? new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(`Erro ao registrar atendimento: ${error.message}`);
    return data as PaAtendimento;
  },

  /**
   * Registra a triagem (classificação de risco).
   */
  async registrarTriagem(
    id: number,
    input: z.infer<typeof triagemSchema>,
  ): Promise<PaAtendimento> {
    const parsed = triagemSchema.parse(input);
    const { data, error } = await supabase
      .from("pa_atendimentos")
      .update({
        dt_triagem: parsed.dt_triagem ?? new Date().toISOString(),
        cd_cor_risco: parsed.cd_cor_risco,
        vl_news2_score: parsed.vl_news2_score ?? null,
        ds_queixa_principal: parsed.ds_queixa_principal ?? null,
        cd_classificacao_id: parsed.id,
        tp_status: "EM_ATENDIMENTO",
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as PaAtendimento;
  },

  async iniciarAtendimento(
    id: number,
    input: z.infer<typeof atendimentoMedicoSchema>,
  ): Promise<PaAtendimento> {
    const parsed = atendimentoMedicoSchema.parse(input);
    const { data, error } = await supabase
      .from("pa_atendimentos")
      .update({
        dt_atendimento_medico: new Date().toISOString(),
        cd_medico_atendimento: parsed.cd_medico_atendimento,
        ds_observacoes: parsed.ds_observacoes ?? null,
        tp_status: "EM_ATENDIMENTO",
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as PaAtendimento;
  },

  async darAlta(id: number, input: z.infer<typeof altaPaSchema>): Promise<PaAtendimento> {
    const parsed = altaPaSchema.parse(input);
    const { data, error } = await supabase
      .from("pa_atendimentos")
      .update({
        dt_alta: new Date().toISOString(),
        tp_destino: parsed.tp_destino,
        ds_observacoes: parsed.ds_observacoes ?? null,
        cd_leito_internacao: parsed.cd_leito_internacao ?? null,
        tp_status: parsed.tp_destino === "EVASAO" ? "EVADIDO" : "ALTA",
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as PaAtendimento;
  },

  /**
   * Estatísticas: contagem por status.
   */
  async getEstatisticas(): Promise<{
    aguardando: number;
    emTriagem: number;
    emAtendimento: number;
    emObservacao: number;
    alta: number;
    evadido: number;
  }> {
    const { data, error } = await supabase
      .from("pa_atendimentos")
      .select("tp_status");
    if (error) throw new Error(`Erro: ${error.message}`);
    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      counts[row.tp_status] = (counts[row.tp_status] ?? 0) + 1;
    }
    return {
      aguardando: counts.AGUARDANDO ?? 0,
      emTriagem: counts.EM_TRIAGEM ?? 0,
      emAtendimento: counts.EM_ATENDIMENTO ?? 0,
      emObservacao: counts.EM_OBSERVACAO ?? 0,
      alta: counts.ALTA ?? 0,
      evadido: counts.EVADIDO ?? 0,
    };
  },
};
