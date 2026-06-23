/**
 * npsService — Módulo de NPS (Net Promoter Score) e Feedback do Paciente
 *
 * Migration relacionada: 20260101000022_nps.sql
 *
 * Decisões:
 *   - Resposta anônima (anon role) é permitida no banco (RLS) para suportar
 *     surveys via link público enviado por e-mail/WhatsApp. Aqui no service
 *     só usamos o cliente autenticado; a UI pública usa o mesmo cliente.
 *   - Categorização (Promotor/Neutro/Detrator) é feita no banco via
 *     GENERATED ALWAYS AS (CASO) STORED — aqui apenas lemos.
 *   - View v_nps_analise agrega por pesquisa. Usamos uma query similar
 *     aqui para o caso de empresas com RLS muito restritivo.
 *   - Comentários de detratores são destacados para ação rápida do gestor.
 */

import { z } from "zod";
import { supabase } from "@/lib/supabase";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const tpPublicoEnum = z.enum([
  "TODOS_PACIENTES",
  "APOS_CONSULTA",
  "APOS_INTERNACAO",
  "CUSTOMIZADO",
]);

export const tpOrigemEnum = z.enum(["EMAIL", "WHATSAPP", "SMS", "PRESENCIAL"]);

export const tpPromotorEnum = z.enum(["PROMOTOR", "NEUTRO", "DETRATOR"]);

// ── Schemas ───────────────────────────────────────────────────────────────────

export const perguntaSchema = z.object({
  id: z.string().min(1),
  texto: z.string().min(1).max(500),
  tipo: z.enum(["NPS", "ESCALA_5", "TEXTO", "MULTIPLA_ESCOLHA"]),
  obrigatoria: z.boolean().default(false),
  opcoes: z.array(z.string()).optional(),
});

export const pesquisaSchema = z.object({
  ds_titulo: z.string().min(2).max(200),
  ds_descricao: z.string().max(2000).optional().nullable(),
  dt_inicio: z.string().min(1, "Data de início obrigatória"),
  dt_fim: z.string().optional().nullable(),
  tp_publico: tpPublicoEnum.default("TODOS_PACIENTES"),
  cd_template_perguntas: z.array(perguntaSchema).min(1, "Adicione ao menos uma pergunta"),
  lg_ativo: z.boolean().default(true),
});

export const respostaSchema = z.object({
  cd_pesquisa: z.number().int().positive(),
  cd_paciente: z.number().int().positive(),
  cd_appointment: z.number().int().positive().optional().nullable(),
  nr_nota_nps: z.number().int().min(0).max(10, "Nota deve ser entre 0 e 10"),
  ds_comentario: z.string().max(2000).optional().nullable(),
  ds_origem: tpOrigemEnum.optional().nullable(),
  ds_respostas: z.record(z.string(), z.unknown()).optional().nullable(),
});

// ── Types ─────────────────────────────────────────────────────────────────────

export type Pergunta = z.infer<typeof perguntaSchema>;

export type Pesquisa = {
  id: number;
  company_id: string;
  ds_titulo: string;
  ds_descricao?: string | null;
  dt_inicio: string;
  dt_fim?: string | null;
  tp_publico?: z.infer<typeof tpPublicoEnum> | null;
  cd_template_perguntas?: Pergunta[] | null;
  lg_ativo: boolean;
  cd_usuario?: string | null;
  created_at: string;
};

export type Resposta = {
  id: number;
  cd_pesquisa: number;
  cd_paciente: number;
  cd_appointment?: number | null;
  dt_resposta: string;
  nr_nota_nps?: number | null;
  ds_comentario?: string | null;
  tp_promotor?: z.infer<typeof tpPromotorEnum> | null;
  ds_origem?: z.infer<typeof tpOrigemEnum> | null;
  ip_origem?: string | null;
  user_agent?: string | null;
  ds_respostas?: Record<string, unknown> | null;
  created_at: string;
};

export type NpsAnalise = {
  cd_pesquisa: number;
  ds_titulo: string;
  nr_respostas: number;
  nr_promotores: number;
  nr_neutros: number;
  nr_detrators: number;
  nr_percent_promotores: number;
  nr_percent_detrators: number;
  nr_nps_score: number;
  nr_nota_media: number;
};

// ── Services ──────────────────────────────────────────────────────────────────

export const pesquisasService = {
  async getAll(ativo = true): Promise<Pesquisa[]> {
    let q = supabase
      .from("nps_pesquisas")
      .select("*")
      .order("dt_inicio", { ascending: false });
    if (ativo) q = q.eq("lg_ativo", true);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao listar pesquisas: ${error.message}`);
    return (data ?? []) as Pesquisa[];
  },

  async getById(id: number): Promise<Pesquisa | null> {
    const { data, error } = await supabase
      .from("nps_pesquisas")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data as Pesquisa) ?? null;
  },

  async create(input: z.infer<typeof pesquisaSchema>): Promise<Pesquisa> {
    const parsed = pesquisaSchema.parse(input);
    const { data, error } = await supabase
      .from("nps_pesquisas")
      .insert({
        ds_titulo: parsed.ds_titulo,
        ds_descricao: parsed.ds_descricao ?? null,
        dt_inicio: parsed.dt_inicio,
        dt_fim: parsed.dt_fim ?? null,
        tp_publico: parsed.tp_publico,
        cd_template_perguntas: parsed.cd_template_perguntas,
        lg_ativo: parsed.lg_ativo,
      })
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar pesquisa: ${error.message}`);
    return data as Pesquisa;
  },

  async toggleAtiva(id: number, ativa: boolean): Promise<Pesquisa> {
    const { data, error } = await supabase
      .from("nps_pesquisas")
      .update({ lg_ativo: ativa })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as Pesquisa;
  },
};

export const respostasService = {
  /**
   * Registra uma resposta NPS. Pode ser chamado por usuário autenticado
   * (dashboard) ou anônimo (link público). A RLS permite ambos.
   */
  async create(input: z.infer<typeof respostaSchema>): Promise<Resposta> {
    const parsed = respostaSchema.parse(input);
    const { data, error } = await supabase
      .from("nps_respostas")
      .insert({
        cd_pesquisa: parsed.cd_pesquisa,
        cd_paciente: parsed.cd_paciente,
        cd_appointment: parsed.cd_appointment ?? null,
        nr_nota_nps: parsed.nr_nota_nps,
        ds_comentario: parsed.ds_comentario ?? null,
        ds_origem: parsed.ds_origem ?? null,
        ds_respostas: parsed.ds_respostas ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(`Erro ao enviar resposta: ${error.message}`);
    return data as Resposta;
  },

  async getByPesquisa(pesquisaId: number, limit = 100): Promise<Resposta[]> {
    const { data, error } = await supabase
      .from("nps_respostas")
      .select("*")
      .eq("cd_pesquisa", pesquisaId)
      .order("dt_resposta", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as Resposta[];
  },

  /**
   * Lista comentários de detratores (nota 0-6) para ação rápida do gestor.
   */
  async getComentariosDetratores(pesquisaId: number): Promise<Resposta[]> {
    const { data, error } = await supabase
      .from("nps_respostas")
      .select("*")
      .eq("cd_pesquisa", pesquisaId)
      .eq("tp_promotor", "DETRATOR")
      .not("ds_comentario", "is", null)
      .order("dt_resposta", { ascending: false });
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as Resposta[];
  },
};

export const npsReportsService = {
  /**
   * Calcula o NPS score para uma pesquisa.
   * Tenta usar a view v_nps_analise; em caso de erro, faz fallback client-side.
   */
  async getAnalise(pesquisaId: number): Promise<NpsAnalise | null> {
    // Tenta view primeiro
    const { data: viewData, error: viewErr } = await supabase
      .from("v_nps_analise")
      .select("*")
      .eq("cd_pesquisa", pesquisaId)
      .maybeSingle();
    if (!viewErr && viewData) {
      return viewData as NpsAnalise;
    }

    // Fallback: agregação client-side
    const respostas = await respostasService.getByPesquisa(pesquisaId, 10_000);
    if (respostas.length === 0) {
      const p = await pesquisasService.getById(pesquisaId);
      if (!p) return null;
      return {
        cd_pesquisa: p.id,
        ds_titulo: p.ds_titulo,
        nr_respostas: 0,
        nr_promotores: 0,
        nr_neutros: 0,
        nr_detrators: 0,
        nr_percent_promotores: 0,
        nr_percent_detrators: 0,
        nr_nps_score: 0,
        nr_nota_media: 0,
      };
    }
    const promotores = respostas.filter((r) => r.tp_promotor === "PROMOTOR").length;
    const neutros = respostas.filter((r) => r.tp_promotor === "NEUTRO").length;
    const detratores = respostas.filter((r) => r.tp_promotor === "DETRATOR").length;
    const total = respostas.length;
    const pctPromotores = (100 * promotores) / total;
    const pctDetratores = (100 * detratores) / total;
    const notaMedia =
      respostas.reduce((acc, r) => acc + Number(r.nr_nota_nps ?? 0), 0) / total;
    return {
      cd_pesquisa: pesquisaId,
      ds_titulo: respostas[0]?.cd_pesquisa ? (await pesquisasService.getById(pesquisaId))?.ds_titulo ?? "" : "",
      nr_respostas: total,
      nr_promotores: promotores,
      nr_neutros: neutros,
      nr_detrators: detratores,
      nr_percent_promotores: Math.round(pctPromotores * 100) / 100,
      nr_percent_detrators: Math.round(pctDetratores * 100) / 100,
      nr_nps_score: Math.round((pctPromotores - pctDetratores) * 100) / 100,
      nr_nota_media: Math.round(notaMedia * 10) / 10,
    };
  },

  /**
   * Distribuição de notas (0-10) para histograma.
   */
  async getDistribuicaoNotas(pesquisaId: number): Promise<Record<number, number>> {
    const respostas = await respostasService.getByPesquisa(pesquisaId, 10_000);
    const dist: Record<number, number> = {};
    for (let i = 0; i <= 10; i += 1) dist[i] = 0;
    for (const r of respostas) {
      const nota = Number(r.nr_nota_nps ?? 0);
      if (nota >= 0 && nota <= 10) {
        dist[nota] = (dist[nota] ?? 0) + 1;
      }
    }
    return dist;
  },
};

export const npsService = {
  pesquisas: pesquisasService,
  respostas: respostasService,
  reports: npsReportsService,
};
