/**
 * internacaoService — Módulo de Internação Hospitalar
 *
 * Espelha e moderniza o SIGH:
 *   SIGH.leito              → public.leitos
 *   SIGH.pacixleit          → public.pacixleit
 *   SIGH.prescricao         → public.prescricoes_internado
 *   SIGH.evolucao_internado → public.evolucoes_internado
 *
 * Migration relacionada: 20260101000023_internacao.sql
 *
 * Decisões:
 *   - SOAP estruturado em evolucoes_internado (Subj/Obj/Aval/Plano)
 *   - Sinais vitais em JSONB para flexibilidade
 *   - RLS por company_id + role (médico/enfermeiro podem prescrever/evoluir)
 *   - View v_leitos_ocupacao para mapa de leitos
 *
 * Conformidade:
 *   - Resolução CFM 2.314/2022 (prontuário)
 *   - Portaria GM/MS 1.820/2009 (registro de internação)
 */

import { z } from "zod";
import { supabase } from "@/lib/supabase";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const tpLeitoEnum = z.enum([
  "ENFERMARIA",
  "APARTAMENTO",
  "UTI_ADULTO",
  "UTI_PEDIATRICA",
  "UTI_NEONATAL",
  "ISOLAMENTO",
  "OBSERVACAO",
]);

export const tpAltaEnum = z.enum([
  "MELHORADO",
  "CURADO",
  "OBITO",
  "TRANSFERIDO",
  "A_PEDIDO",
  "ADMINISTRATIVA",
]);

export const tpAcomodacaoEnum = z.enum(["ENFERMARIA", "APARTAMENTO"]);

export const leitoSchema = z.object({
  nr_leito: z.string().min(1, "Número do leito obrigatório").max(20),
  ds_localizacao: z.string().max(100).optional().nullable(),
  tp_leito: tpLeitoEnum,
  tp_acomodacao: tpAcomodacaoEnum.optional().nullable(),
  cd_unidade: z.number().int().positive().optional().nullable(),
  vl_diaria: z.number().nonnegative().optional().nullable(),
  lg_ativo: z.boolean().default(true),
});

export const internacaoSchema = z.object({
  cd_paciente: z.number().int().positive(),
  cd_leito: z.number().int().positive(),
  dt_internacao: z.string().optional().nullable(),
  cd_medico_responsavel: z.number().int().positive().optional().nullable(),
  cd_appointment_origem: z.number().int().positive().optional().nullable(),
  ds_observacoes: z.string().optional().nullable(),
});

export const altaSchema = z.object({
  tp_alta: tpAltaEnum,
  ds_motivo_alta: z.string().optional().nullable(),
});

export const prescricaoSchema = z.object({
  cd_internacao: z.number().int().positive(),
  cd_medico: z.number().int().positive(),
  nr_prescricao: z.number().int().positive().optional().nullable(),
  ds_prescricao: z.string().min(1, "Texto da prescrição obrigatório"),
  tp_dieta: z.string().max(50).optional().nullable(),
  ds_cuidados: z.string().optional().nullable(),
  ds_observacoes: z.string().optional().nullable(),
  dt_validade: z.string().optional().nullable(),
  lg_ativa: z.boolean().default(true),
});

export const evolucaoSchema = z.object({
  cd_internacao: z.number().int().positive(),
  cd_medico: z.number().int().positive(),
  ds_subjetivo: z.string().optional().nullable(),
  ds_objetivo: z.string().optional().nullable(),
  ds_avaliacao: z.string().optional().nullable(),
  ds_plano: z.string().optional().nullable(),
  sinas_vitais: z
    .object({
      pa: z.string().optional(),
      fc: z.number().optional(),
      fr: z.number().optional(),
      t: z.number().optional(),
      spo2: z.number().optional(),
      glicemia: z.number().optional(),
      peso: z.number().optional(),
      altura: z.number().optional(),
    })
    .optional()
    .nullable(),
});

export const sinasVitaisSchema = z.object({
  pa: z.string().optional(),
  fc: z.number().int().nonnegative().optional(),
  fr: z.number().int().nonnegative().optional(),
  t: z.number().nonnegative().optional(),
  spo2: z.number().min(0).max(100).optional(),
  glicemia: z.number().nonnegative().optional(),
  peso: z.number().nonnegative().optional(),
  altura: z.number().nonnegative().optional(),
});

// ── Types ───────────────────────────────────────────────────────────────────

export type Leito = z.infer<typeof leitoSchema> & {
  id: number;
  company_id: string;
  cd_origem_sigh?: number | null;
  created_at: string;
};

export type Internacao = z.infer<typeof internacaoSchema> & {
  id: number;
  company_id: string;
  dt_internacao: string;
  dt_alta: string | null;
  tp_alta: z.infer<typeof tpAltaEnum> | null;
  ds_motivo_alta: string | null;
  cd_origem_sigh?: number | null;
  created_at: string;
};

export type LeitoOcupacao = {
  id: number;
  company_id: string;
  nr_leito: string;
  ds_localizacao: string | null;
  tp_leito: z.infer<typeof tpLeitoEnum>;
  tp_acomodacao: z.infer<typeof tpAcomodacaoEnum> | null;
  cd_unidade: number | null;
  vl_diaria: number | null;
  lg_ativo: boolean;
  cd_pacixleit: number | null;
  cd_paciente: number | null;
  dt_internacao: string | null;
  cd_medico_responsavel: number | null;
  tp_status: "LIVRE" | "OCUPADO";
};

export type Prescricao = z.infer<typeof prescricaoSchema> & {
  id: number;
  company_id: string;
  dt_prescricao: string;
  cd_origem_sigh?: number | null;
  created_at: string;
};

export type Evolucao = z.infer<typeof evolucaoSchema> & {
  id: number;
  company_id: string;
  dt_evolucao: string;
  cd_origem_sigh?: number | null;
  created_at: string;
};

export type SinaisVitais = z.infer<typeof sinasVitaisSchema>;

// ── Services ────────────────────────────────────────────────────────────────

export const leitosService = {
  async getAll(filters?: { tp_leito?: z.infer<typeof tpLeitoEnum>; ativo?: boolean }): Promise<Leito[]> {
    let q = supabase.from("leitos").select("*").order("nr_leito");
    if (filters?.tp_leito) q = q.eq("tp_leito", filters.tp_leito);
    if (filters?.ativo !== undefined) q = q.eq("lg_ativo", filters.ativo);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao listar leitos: ${error.message}`);
    return (data ?? []) as Leito[];
  },

  async getMapaOcupacao(): Promise<LeitoOcupacao[]> {
    const { data, error } = await supabase
      .from("v_leitos_ocupacao")
      .select("*")
      .order("nr_leito");
    if (error) throw new Error(`Erro ao buscar mapa: ${error.message}`);
    return (data ?? []) as LeitoOcupacao[];
  },

  async getById(id: number): Promise<Leito | null> {
    const { data, error } = await supabase
      .from("leitos")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data as Leito) ?? null;
  },

  async create(input: z.infer<typeof leitoSchema>): Promise<Leito> {
    const parsed = leitoSchema.parse(input);
    const { data, error } = await supabase
      .from("leitos")
      .insert(parsed)
      .select()
      .single();
    if (error) {
      if (error.message?.includes("unique") || error.code === "23505") {
        throw new Error("Já existe um leito com este número nesta unidade.");
      }
      throw new Error(`Erro ao criar leito: ${error.message}`);
    }
    return data as Leito;
  },

  async update(id: number, input: Partial<z.infer<typeof leitoSchema>>): Promise<Leito> {
    const parsed = leitoSchema.partial().parse(input);
    const { data, error } = await supabase
      .from("leitos")
      .update(parsed)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as Leito;
  },
};

export const internacoesService = {
  async getAll(filters?: { cd_paciente?: number; emAberto?: boolean }): Promise<Internacao[]> {
    let q = supabase.from("pacixleit").select("*").order("dt_internacao", { ascending: false });
    if (filters?.cd_paciente) q = q.eq("cd_paciente", filters.cd_paciente);
    if (filters?.emAberto === true) q = q.is("dt_alta", null);
    if (filters?.emAberto === false) q = q.not("dt_alta", "is", null);
    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as Internacao[];
  },

  async getById(id: number): Promise<Internacao | null> {
    const { data, error } = await supabase
      .from("pacixleit")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data as Internacao) ?? null;
  },

  async getAtiva(leitoId: number): Promise<Internacao | null> {
    const { data, error } = await supabase
      .from("pacixleit")
      .select("*")
      .eq("cd_leito", leitoId)
      .is("dt_alta", null)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data as Internacao) ?? null;
  },

  /**
   * Cria uma nova internação. Valida que o leito está livre.
   */
  async create(input: z.infer<typeof internacaoSchema>): Promise<Internacao> {
    const parsed = internacaoSchema.parse(input);
    // Verifica se o leito está livre
    const ativa = await this.getAtiva(parsed.cd_leito);
    if (ativa) {
      throw new Error("Este leito já está ocupado. Escolha outro.");
    }
    const { data, error } = await supabase
      .from("pacixleit")
      .insert({
        cd_paciente: parsed.cd_paciente,
        cd_leito: parsed.cd_leito,
        dt_internacao: parsed.dt_internacao ?? new Date().toISOString(),
        cd_medico_responsavel: parsed.cd_medico_responsavel ?? null,
        cd_appointment_origem: parsed.cd_appointment_origem ?? null,
        ds_observacoes: parsed.ds_observacoes ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(`Erro ao internar: ${error.message}`);
    return data as Internacao;
  },

  /**
   * Registra alta do paciente. Define dt_alta e tp_alta.
   */
  async darAlta(id: number, input: z.infer<typeof altaSchema>): Promise<Internacao> {
    const parsed = altaSchema.parse(input);
    const { data, error } = await supabase
      .from("pacixleit")
      .update({
        dt_alta: new Date().toISOString(),
        tp_alta: parsed.tp_alta,
        ds_motivo_alta: parsed.ds_motivo_alta ?? null,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as Internacao;
  },

  /**
   * Histórico de internações de um paciente.
   */
  async historicoPaciente(pacienteId: number): Promise<Internacao[]> {
    return this.getAll({ cd_paciente: pacienteId });
  },
};

export const prescricoesService = {
  async getByInternacao(cdInternacao: number): Promise<Prescricao[]> {
    const { data, error } = await supabase
      .from("prescricoes_internado")
      .select("*")
      .eq("cd_internacao", cdInternacao)
      .order("dt_prescricao", { ascending: false });
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as Prescricao[];
  },

  async getAtiva(cdInternacao: number): Promise<Prescricao | null> {
    const { data, error } = await supabase
      .from("prescricoes_internado")
      .select("*")
      .eq("cd_internacao", cdInternacao)
      .eq("lg_ativa", true)
      .order("dt_prescricao", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data as Prescricao) ?? null;
  },

  async create(input: z.infer<typeof prescricaoSchema>): Promise<Prescricao> {
    const parsed = prescricaoSchema.parse(input);
    const { data, error } = await supabase
      .from("prescricoes_internado")
      .insert(parsed)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar prescrição: ${error.message}`);
    return data as Prescricao;
  },

  async cancelar(id: number): Promise<Prescricao> {
    const { data, error } = await supabase
      .from("prescricoes_internado")
      .update({ lg_ativa: false })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as Prescricao;
  },
};

export const evolucoesService = {
  async getByInternacao(cdInternacao: number): Promise<Evolucao[]> {
    const { data, error } = await supabase
      .from("evolucoes_internado")
      .select("*")
      .eq("cd_internacao", cdInternacao)
      .order("dt_evolucao", { ascending: false });
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as Evolucao[];
  },

  async create(input: z.infer<typeof evolucaoSchema>): Promise<Evolucao> {
    const parsed = evolucaoSchema.parse(input);
    const { data, error } = await supabase
      .from("evolucoes_internado")
      .insert({
        ...parsed,
        sinas_vitais: parsed.sinas_vitais ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar evolução: ${error.message}`);
    return data as Evolucao;
  },

  async ultima(cdInternacao: number): Promise<Evolucao | null> {
    const { data, error } = await supabase
      .from("evolucoes_internado")
      .select("*")
      .eq("cd_internacao", cdInternacao)
      .order("dt_evolucao", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data as Evolucao) ?? null;
  },
};

export const internacaoService = {
  leitos: leitosService,
  internacoes: internacoesService,
  prescricoes: prescricoesService,
  evolucoes: evolucoesService,
};
