/**
 * cirurgiaService — Centro Cirúrgico
 *
 * Espelha e moderniza o SIGH:
 *   SIGH.sala_cirurgica    → public.salas_cirurgicas
 *   SIGH.cirurgia_paciente → public.cirurgiasxpac
 *   SIGH.cirurgia_material → public.cirurgia_materiais
 *
 * Migration relacionada: 20260101000024_cirurgia.sql
 *
 * Decisões:
 *   - Status workflow: AGENDADA → PRE_OPERATORIO → EM_ANDAMENTO → CONCLUIDA
 *   - cd_equipe_enfermagem como array de IDs (PostgreSQL INTEGER[])
 *   - Materiais e medicamentos consumidos por cirurgia
 *   - CIDs principal e secundário
 *
 * Conformidade:
 *   - RDC ANVISA 36/2013 (cirurgias seguras)
 *   - Resolução CFM 2.217/2018 (termo de consentimento)
 */

import { z } from "zod";
import { supabase } from "@/lib/supabase";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const tpSalaEnum = z.enum([
  "CIRURGIA_GERAL",
  "OBSTETRICIA",
  "ORTOPEDIA",
  "CARDIACA",
  "NEUROCIRURGIA",
  "AMBULATORIAL",
]);

export const tpAnestesiaEnum = z.enum(["LOCAL", "RAQUI", "GERAL", "SEDACAO", "NENHUMA"]);

export const tpCirurgiaEnum = z.enum(["ELETIVA", "URGENCIA", "EMERGENCIA"]);

export const tpStatusCirurgiaEnum = z.enum([
  "AGENDADA",
  "PRE_OPERATORIO",
  "EM_ANDAMENTO",
  "CONCLUIDA",
  "CANCELADA",
  "SUSPENSA",
]);

export const salaSchema = z.object({
  ds_nome: z.string().min(1, "Nome obrigatório").max(100),
  ds_localizacao: z.string().max(100).optional().nullable(),
  tp_sala: tpSalaEnum.optional().nullable(),
  lg_ativa: z.boolean().default(true),
});

export const cirurgiaSchema = z.object({
  cd_paciente: z.number().int().positive(),
  cd_appointment: z.number().int().positive().optional().nullable(),
  cd_sala: z.number().int().positive().optional().nullable(),
  dt_agendamento: z.string().min(1, "Data de agendamento é obrigatória"),
  dt_inicio: z.string().optional().nullable(),
  dt_fim: z.string().optional().nullable(),
  nr_duracao_prevista_min: z.number().int().positive().optional().nullable(),
  cd_cirurgiao_principal: z.number().int().positive().optional().nullable(),
  cd_anestesista: z.number().int().positive().optional().nullable(),
  cd_equipe_enfermagem: z.array(z.number().int().positive()).optional().nullable(),
  tp_anestesia: tpAnestesiaEnum.optional().nullable(),
  tp_cirurgia: tpCirurgiaEnum.default("ELETIVA"),
  cd_cid_principal: z.number().int().positive().optional().nullable(),
  cd_cid_secundario: z.number().int().positive().optional().nullable(),
  ds_tecnica: z.string().optional().nullable(),
  ds_observacoes_pre_operatorias: z.string().optional().nullable(),
  vl_materiais: z.number().nonnegative().optional().nullable(),
  tp_status: tpStatusCirurgiaEnum.default("AGENDADA"),
});

export const cirurgiaMaterialSchema = z.object({
  cd_cirurgia: z.number().int().positive(),
  cd_material: z.number().int().positive().optional().nullable(),
  cd_medicamento: z.number().int().positive().optional().nullable(),
  ds_item: z.string().max(200).optional().nullable(),
  qt_utilizada: z.number().positive().optional().nullable(),
  vl_unitario: z.number().nonnegative().optional().nullable(),
  vl_total: z.number().nonnegative().optional().nullable(),
});

export const conclusaoSchema = z.object({
  dt_inicio: z.string(),
  dt_fim: z.string(),
  ds_observacoes_pos_operatorias: z.string().optional().nullable(),
  ds_complicacoes: z.string().optional().nullable(),
});

// ── Types ───────────────────────────────────────────────────────────────────

export type SalaCirurgica = z.infer<typeof salaSchema> & {
  id: number;
  company_id: string;
  cd_origem_sigh?: number | null;
  created_at: string;
};

export type Cirurgia = z.infer<typeof cirurgiaSchema> & {
  id: number;
  company_id: string;
  ds_observacoes_pos_operatorias: string | null;
  ds_complicacoes: string | null;
  cd_origem_sigh?: number | null;
  created_at: string;
  updated_at: string;
};

export type CirurgiaMaterial = z.infer<typeof cirurgiaMaterialSchema> & {
  id: number;
  created_at: string;
};

// ── Services ────────────────────────────────────────────────────────────────

export const salasService = {
  async getAll(ativo = true): Promise<SalaCirurgica[]> {
    let q = supabase.from("salas_cirurgicas").select("*").order("ds_nome");
    if (ativo) q = q.eq("lg_ativa", true);
    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as SalaCirurgica[];
  },

  async create(input: z.infer<typeof salaSchema>): Promise<SalaCirurgica> {
    const parsed = salaSchema.parse(input);
    const { data, error } = await supabase
      .from("salas_cirurgicas")
      .insert(parsed)
      .select()
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new Error("Já existe uma sala com este nome nesta empresa.");
      }
      throw new Error(`Erro: ${error.message}`);
    }
    return data as SalaCirurgica;
  },
};

export const cirurgiasService = {
  async getAll(filters?: {
    cd_paciente?: number;
    cd_sala?: number;
    tp_status?: z.infer<typeof tpStatusCirurgiaEnum>;
    dataInicio?: string;
    dataFim?: string;
  }): Promise<Cirurgia[]> {
    let q = supabase.from("cirurgiasxpac").select("*").order("dt_agendamento", { ascending: false });
    if (filters?.cd_paciente) q = q.eq("cd_paciente", filters.cd_paciente);
    if (filters?.cd_sala) q = q.eq("cd_sala", filters.cd_sala);
    if (filters?.tp_status) q = q.eq("tp_status", filters.tp_status);
    if (filters?.dataInicio) q = q.gte("dt_agendamento", filters.dataInicio);
    if (filters?.dataFim) q = q.lte("dt_agendamento", filters.dataFim);
    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as Cirurgia[];
  },

  async getById(id: number): Promise<Cirurgia | null> {
    const { data, error } = await supabase
      .from("cirurgiasxpac")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data as Cirurgia) ?? null;
  },

  async getAgendaDiaria(data: string): Promise<Cirurgia[]> {
    const inicio = `${data}T00:00:00`;
    const fim = `${data}T23:59:59`;
    const { data: rows, error } = await supabase
      .from("cirurgiasxpac")
      .select("*")
      .gte("dt_agendamento", inicio)
      .lte("dt_agendamento", fim)
      .order("dt_agendamento");
    if (error) throw new Error(`Erro: ${error.message}`);
    return (rows ?? []) as Cirurgia[];
  },

  async create(input: z.infer<typeof cirurgiaSchema>): Promise<Cirurgia> {
    const parsed = cirurgiaSchema.parse(input);
    const { data, error } = await supabase
      .from("cirurgiasxpac")
      .insert(parsed)
      .select()
      .single();
    if (error) throw new Error(`Erro ao agendar cirurgia: ${error.message}`);
    return data as Cirurgia;
  },

  async update(id: number, input: Partial<z.infer<typeof cirurgiaSchema>>): Promise<Cirurgia> {
    const parsed = cirurgiaSchema.partial().parse(input);
    const { data, error } = await supabase
      .from("cirurgiasxpac")
      .update(parsed)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as Cirurgia;
  },

  async cancelar(id: number, motivo: string): Promise<Cirurgia> {
    return this.update(id, {
      tp_status: "CANCELADA",
      ds_observacoes_pos_operatorias: motivo,
    } as Partial<z.infer<typeof cirurgiaSchema>>);
  },

  async iniciar(id: number): Promise<Cirurgia> {
    return this.update(id, {
      tp_status: "EM_ANDAMENTO",
      dt_inicio: new Date().toISOString(),
    } as Partial<z.infer<typeof cirurgiaSchema>>);
  },

  async concluir(id: number, input: z.infer<typeof conclusaoSchema>): Promise<Cirurgia> {
    const parsed = conclusaoSchema.parse(input);
    return this.update(id, {
      tp_status: "CONCLUIDA",
      dt_inicio: parsed.dt_inicio,
      dt_fim: parsed.dt_fim,
      ds_observacoes_pos_operatorias: parsed.ds_observacoes_pos_operatorias ?? null,
      ds_complicacoes: parsed.ds_complicacoes ?? null,
    } as Partial<z.infer<typeof cirurgiaSchema>>);
  },

  async getMateriais(cdCirurgia: number): Promise<CirurgiaMaterial[]> {
    const { data, error } = await supabase
      .from("cirurgia_materiais")
      .select("*")
      .eq("cd_cirurgia", cdCirurgia)
      .order("created_at");
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as CirurgiaMaterial[];
  },

  async adicionarMaterial(input: z.infer<typeof cirurgiaMaterialSchema>): Promise<CirurgiaMaterial> {
    const parsed = cirurgiaMaterialSchema.parse(input);
    if (!parsed.cd_material && !parsed.cd_medicamento) {
      throw new Error("É obrigatório informar cd_material ou cd_medicamento.");
    }
    const { data, error } = await supabase
      .from("cirurgia_materiais")
      .insert(parsed)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as CirurgiaMaterial;
  },
};

export const cirurgiaService = {
  salas: salasService,
  cirurgias: cirurgiasService,
};
