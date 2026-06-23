/**
 * transportService — Módulo de Remoção e Transporte Sanitário
 *
 * Migration relacionada: 20260101000021_transporte.sql
 *
 * Decisões:
 *   - Veículos classificados por tipo (AMBULANCIA_SIMPLES, UTI, etc)
 *   - Equipe polimórfica via tp_funcao (MOTORISTA, TECNICO, MEDICO)
 *   - Status: PENDENTE → AGENDADA → EM_ANDAMENTO → CONCLUIDA
 *   - Urgência com semafórica (BAIXA/MEDIA/ALTA/EMERGENCIA)
 *   - CNH: data de validade é informação crítica de compliance;
 *     helper `getCNHVencendo` lista profissionais com CNH vencendo em 30 dias.
 */

import { z } from "zod";
import { supabase } from "@/lib/supabase";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const tpTipoVeiculoEnum = z.enum([
  "AMBULANCIA_SIMPLES",
  "AMBULANCIA_UTI",
  "TRANSPORTE_SIMPLES",
  "TRANSPORTE_ADAPTADO",
]);

export const tpFuncaoEquipeEnum = z.enum([
  "MOTORISTA",
  "TECNICO_ENFERMAGEM",
  "MEDICO",
  "AUXILIAR",
]);

export const tpTipoRemocaoEnum = z.enum([
  "REMOCAO_SIMPLES",
  "REMOCAO_UTI",
  "TRANSFERENCIA_HOSPITALAR",
  "ALTA_HOSPITALAR",
]);

export const tpUrgenciaEnum = z.enum(["BAIXA", "MEDIA", "ALTA", "EMERGENCIA"]);

export const tpStatusRemocaoEnum = z.enum([
  "PENDENTE",
  "AGENDADA",
  "EM_ANDAMENTO",
  "CONCLUIDA",
  "CANCELADA",
]);

// ── Schemas ───────────────────────────────────────────────────────────────────

export const veiculoSchema = z.object({
  nr_placa: z
    .string()
    .min(7, "Placa inválida")
    .max(10)
    .regex(/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$|^[A-Z]{3}-?[0-9]{4}$/i, "Formato de placa inválido"),
  ds_modelo: z.string().max(100).optional().nullable(),
  nr_ano: z.number().int().min(1900).max(new Date().getFullYear() + 1).optional().nullable(),
  ds_tipo: tpTipoVeiculoEnum.optional().nullable(),
  cd_renavam: z.string().max(20).optional().nullable(),
  nr_capacidade: z.number().int().nonnegative().optional().nullable(),
  lg_ativo: z.boolean().default(true),
});

export const equipeSchema = z.object({
  nm_nome: z.string().min(2, "Nome obrigatório").max(200),
  cd_cpf: z
    .string()
    .regex(/^\d{11}$/, "CPF deve ter 11 dígitos")
    .optional()
    .nullable()
    .or(z.literal("")),
  tp_funcao: tpFuncaoEquipeEnum,
  nr_cnh: z.string().max(20).optional().nullable(),
  cd_categoria_cnh: z
    .string()
    .length(2, "Categoria CNH deve ter 2 letras")
    .optional()
    .nullable()
    .or(z.literal("")),
  dt_validade_cnh: z.string().optional().nullable(),
  lg_ativo: z.boolean().default(true),
});

export const remocaoSchema = z.object({
  cd_paciente: z.number().int().positive().optional().nullable(),
  tp_tipo: tpTipoRemocaoEnum,
  tp_urgencia: tpUrgenciaEnum,
  ds_origem: z.string().min(2, "Origem obrigatória").max(500),
  ds_destino: z.string().min(2, "Destino obrigatório").max(500),
  ds_justificativa: z.string().max(2000).optional().nullable(),
  cd_veiculo: z.number().int().positive().optional().nullable(),
  cd_equipe_motorista: z.number().int().positive().optional().nullable(),
  cd_equipe_tecnico: z.number().int().positive().optional().nullable(),
  cd_equipe_medico: z.number().int().positive().optional().nullable(),
  dt_programada: z.string().optional().nullable(),
  ds_observacoes_executivo: z.string().max(2000).optional().nullable(),
  tp_status: tpStatusRemocaoEnum.default("PENDENTE"),
});

// ── Types ─────────────────────────────────────────────────────────────────────

export type Veiculo = z.infer<typeof veiculoSchema> & {
  id: number;
  company_id: string;
  created_at: string;
};

export type Equipe = z.infer<typeof equipeSchema> & {
  id: number;
  company_id: string;
  created_at: string;
};

export type Remocao = z.infer<typeof remocaoSchema> & {
  id: number;
  company_id: string;
  dt_solicitacao: string;
  dt_inicio?: string | null;
  dt_fim?: string | null;
  vl_km_inicial?: number | null;
  vl_km_final?: number | null;
  cd_usuario_solicitante?: string | null;
  cd_origem_sigh?: number | null;
  created_at: string;
};

// ── Services ──────────────────────────────────────────────────────────────────

export const veiculosService = {
  async getAll(ativo = true): Promise<Veiculo[]> {
    let q = supabase
      .from("veiculos")
      .select("*")
      .order("nr_placa", { ascending: true });
    if (ativo) q = q.eq("lg_ativo", true);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao listar veículos: ${error.message}`);
    return (data ?? []) as Veiculo[];
  },

  async getById(id: number): Promise<Veiculo | null> {
    const { data, error } = await supabase
      .from("veiculos")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data as Veiculo) ?? null;
  },

  async create(input: z.infer<typeof veiculoSchema>): Promise<Veiculo> {
    const parsed = veiculoSchema.parse(input);
    const { data, error } = await supabase
      .from("veiculos")
      .insert(parsed)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar veículo: ${error.message}`);
    return data as Veiculo;
  },

  async update(id: number, input: Partial<z.infer<typeof veiculoSchema>>): Promise<Veiculo> {
    const parsed = veiculoSchema.partial().parse(input);
    const { data, error } = await supabase
      .from("veiculos")
      .update(parsed)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as Veiculo;
  },
};

export const equipeService = {
  async getAll(ativo = true): Promise<Equipe[]> {
    let q = supabase
      .from("equipe_transporte")
      .select("*")
      .order("nm_nome", { ascending: true });
    if (ativo) q = q.eq("lg_ativo", true);
    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as Equipe[];
  },

  async getByFuncao(funcao: z.infer<typeof tpFuncaoEquipeEnum>): Promise<Equipe[]> {
    const { data, error } = await supabase
      .from("equipe_transporte")
      .select("*")
      .eq("tp_funcao", funcao)
      .eq("lg_ativo", true)
      .order("nm_nome");
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as Equipe[];
  },

  async create(input: z.infer<typeof equipeSchema>): Promise<Equipe> {
    const parsed = equipeSchema.parse(input);
    const { data, error } = await supabase
      .from("equipe_transporte")
      .insert(parsed)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar membro da equipe: ${error.message}`);
    return data as Equipe;
  },

  /**
   * Lista profissionais com CNH vencendo nos próximos N dias.
   * Crítico para compliance operacional.
   */
  async getCNHVencendo(dias = 30): Promise<Equipe[]> {
    const hoje = new Date();
    const limite = new Date();
    limite.setDate(limite.getDate() + dias);
    const { data, error } = await supabase
      .from("equipe_transporte")
      .select("*")
      .eq("tp_funcao", "MOTORISTA")
      .lte("dt_validade_cnh", limite.toISOString().slice(0, 10))
      .gte("dt_validade_cnh", hoje.toISOString().slice(0, 10));
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as Equipe[];
  },
};

export const remocoesService = {
  async getAll(filters?: {
    status?: z.infer<typeof tpStatusRemocaoEnum>;
    tipo?: z.infer<typeof tpTipoRemocaoEnum>;
    dataInicio?: string;
    dataFim?: string;
  }): Promise<Remocao[]> {
    let q = supabase
      .from("remocoes")
      .select("*")
      .order("dt_solicitacao", { ascending: false });
    if (filters?.status) q = q.eq("tp_status", filters.status);
    if (filters?.tipo) q = q.eq("tp_tipo", filters.tipo);
    if (filters?.dataInicio) q = q.gte("dt_solicitacao", filters.dataInicio);
    if (filters?.dataFim) q = q.lte("dt_solicitacao", filters.dataFim);
    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as Remocao[];
  },

  async getById(id: number): Promise<Remocao | null> {
    const { data, error } = await supabase
      .from("remocoes")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data as Remocao) ?? null;
  },

  async create(input: z.infer<typeof remocaoSchema>): Promise<Remocao> {
    const parsed = remocaoSchema.parse(input);
    const { data, error } = await supabase
      .from("remocoes")
      .insert({
        ...parsed,
        cd_paciente: parsed.cd_paciente ?? null,
        ds_justificativa: parsed.ds_justificativa ?? null,
        cd_veiculo: parsed.cd_veiculo ?? null,
        cd_equipe_motorista: parsed.cd_equipe_motorista ?? null,
        cd_equipe_tecnico: parsed.cd_equipe_tecnico ?? null,
        cd_equipe_medico: parsed.cd_equipe_medico ?? null,
        dt_programada: parsed.dt_programada ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar remoção: ${error.message}`);
    return data as Remocao;
  },

  async update(id: number, input: Partial<z.infer<typeof remocaoSchema>>): Promise<Remocao> {
    const parsed = remocaoSchema.partial().parse(input);
    const { data, error } = await supabase
      .from("remocoes")
      .update(parsed)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as Remocao;
  },

  async updateStatus(id: number, status: z.infer<typeof tpStatusRemocaoEnum>): Promise<Remocao> {
    return this.update(id, { tp_status: status });
  },

  /**
   * Registra início do transporte (informa quilometragem inicial).
   */
  async iniciar(id: number, kmInicial: number): Promise<Remocao> {
    if (kmInicial < 0) throw new Error("Quilometragem inicial deve ser positiva");
    const { data, error } = await supabase
      .from("remocoes")
      .update({
        tp_status: "EM_ANDAMENTO",
        dt_inicio: new Date().toISOString(),
        vl_km_inicial: kmInicial,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as Remocao;
  },

  /**
   * Registra fim do transporte (informa quilometragem final).
   */
  async finalizar(id: number, kmFinal: number): Promise<Remocao> {
    if (kmFinal < 0) throw new Error("Quilometragem final deve ser positiva");
    const { data, error } = await supabase
      .from("remocoes")
      .update({
        tp_status: "CONCLUIDA",
        dt_fim: new Date().toISOString(),
        vl_km_final: kmFinal,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as Remocao;
  },

  async cancelar(id: number, motivo: string): Promise<Remocao> {
    if (!motivo || motivo.trim().length === 0) {
      throw new Error("Motivo do cancelamento é obrigatório");
    }
    const { data, error } = await supabase
      .from("remocoes")
      .update({
        tp_status: "CANCELADA",
        ds_observacoes_executivo: motivo,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as Remocao;
  },
};

// ── Relatórios ────────────────────────────────────────────────────────────────

export const transportReportsService = {
  /**
   * Remoções por status, agregadas.
   */
  async getRemocoesPorStatus(): Promise<Record<z.infer<typeof tpStatusRemocaoEnum>, number>> {
    const { data, error } = await supabase.from("remocoes").select("tp_status");
    if (error) throw new Error(`Erro: ${error.message}`);
    const acc: Record<string, number> = {};
    for (const row of data ?? []) {
      acc[row.tp_status] = (acc[row.tp_status] ?? 0) + 1;
    }
    return acc as Record<z.infer<typeof tpStatusRemocaoEnum>, number>;
  },

  /**
   * Quilometragem total percorrida no período (apenas remoções concluídas).
   */
  async getKmTotal(dataInicio: string, dataFim: string): Promise<number> {
    const { data, error } = await supabase
      .from("remocoes")
      .select("vl_km_inicial, vl_km_final")
      .eq("tp_status", "CONCLUIDA")
      .gte("dt_inicio", dataInicio)
      .lte("dt_inicio", dataFim);
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []).reduce((acc, row) => {
      const km = Number(row.vl_km_final ?? 0) - Number(row.vl_km_inicial ?? 0);
      return acc + Math.max(km, 0);
    }, 0);
  },
};

export const transportService = {
  veiculos: veiculosService,
  equipe: equipeService,
  remocoes: remocoesService,
  reports: transportReportsService,
};
