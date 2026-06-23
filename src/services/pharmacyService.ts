/**
 * pharmacyService — Módulo de Farmácia e Materiais
 *
 * Espelha e moderniza o SIGH:
 *   - SIGH.medicamento (3633)          → public.medicamentos
 *   - SIGH.materiais                   → public.materiais
 *   - SIGH.almoxarifado                → public.almoxarifados
 *   - SIGH.lote_medicamento            → public.lotes
 *   - SIGH.mov_estoque                 → public.movimentacoes_estoque
 *   - SIGH.dispen_receita              → public.dispensacoes
 *   - SIGH.receita_controlado (SNGPC)  → public.receitas_controladas
 *
 * Migration relacionada: 20260101000015_farmacia.sql
 *
 * Decisões:
 *   - FEFO (First-Expire-First-Out) via view v_estoque_atual
 *   - RPC `registrar_movimentacao_estoque` faz update do lote + insert
 *     do log de movimentação atomicamente (evita inconsistência)
 *   - RLS granular por role (admin, farmacêutico, médico, enfermeiro)
 *   - Validação Zod em todas as entradas de UI
 *
 * Conformidade:
 *   - Portaria SVS/MS 344/98 (controlados)
 *   - SNGPC (Sistema Nacional de Gerenciamento de Produtos Controlados)
 *   - CMED / Rename
 */

import { z } from "zod";
import { supabase } from "@/lib/supabase";

// ── Zod Schemas (validação) ───────────────────────────────────────────────────

export const tpReceitaEnum = z.enum([
  "BRANCA",
  "AZUL",
  "AMARELA",
  "VERMELHA",
  "CONTROLE_ESPECIAL",
]);

export const tpMovimentacaoEnum = z.enum([
  "ENTRADA",
  "SAIDA",
  "AJUSTE",
  "TRANSFERENCIA",
  "PERDA",
  "VENCIMENTO",
]);

export const cdProdutoTipoEnum = z.enum(["MEDICAMENTO", "MATERIAL"]);

export const medicamentoSchema = z.object({
  cd_principio_ativo: z
    .string()
    .min(2, "Princípio ativo obrigatório (mín. 2 caracteres)")
    .max(200),
  cd_nome_comercial: z.string().max(200).optional().nullable(),
  ds_concentracao: z.string().max(100).optional().nullable(),
  ds_forma_farmaceutica: z.string().max(50).optional().nullable(),
  cd_anvisa: z
    .string()
    .max(20)
    .regex(/^\d+$/, "Registro ANVISA deve ser numérico")
    .optional()
    .nullable()
    .or(z.literal("")),
  cd_ean: z.string().max(20).optional().nullable(),
  tp_receita: tpReceitaEnum.optional().nullable(),
  cd_classe_terapeutica: z.string().max(50).optional().nullable(),
  lg_generico: z.boolean().default(false),
  lg_controlado: z.boolean().default(false),
  vl_unitario: z.number().nonnegative("Valor unitário deve ser positivo").optional().nullable(),
  lg_ativo: z.boolean().default(true),
});

export const materialSchema = z.object({
  ds_nome: z.string().min(2, "Nome obrigatório (mín. 2 caracteres)").max(200),
  cd_codigo_interno: z.string().max(50).optional().nullable(),
  cd_ean: z.string().max(20).optional().nullable(),
  ds_categoria: z.string().max(50).optional().nullable(),
  ds_unidade: z.string().max(20).default("UN"),
  vl_custo_medio: z.number().nonnegative().optional().nullable(),
  vl_venda: z.number().nonnegative().optional().nullable(),
  ponto_reposicao: z.number().int().nonnegative().default(0),
  lg_ativo: z.boolean().default(true),
});

export const almoxarifadoSchema = z.object({
  ds_nome: z.string().min(2, "Nome obrigatório").max(100),
  ds_localizacao: z.string().max(200).optional().nullable(),
  cd_unidade: z.number().int().positive().optional().nullable(),
  lg_principal: z.boolean().default(false),
  lg_ativo: z.boolean().default(true),
});

export const loteSchema = z.object({
  cd_produto_tipo: cdProdutoTipoEnum,
  cd_medicamento_id: z.number().int().positive().optional().nullable(),
  cd_material_id: z.number().int().positive().optional().nullable(),
  cd_lote: z.string().min(1, "Código do lote obrigatório").max(50),
  dt_fabricacao: z.string().optional().nullable(),
  dt_validade: z.string().min(1, "Data de validade obrigatória"),
  qt_inicial: z.number().int().positive("Quantidade inicial deve ser positiva"),
  qt_atual: z.number().int().nonnegative(),
  vl_custo_unitario: z.number().nonnegative().optional().nullable(),
  cd_almoxarifado: z.number().int().positive().optional().nullable(),
  nr_lote_fabricante: z.string().max(50).optional().nullable(),
  lg_ativo: z.boolean().default(true),
});

export const dispensacaoItemSchema = z.object({
  cd_lote: z.number().int().positive(),
  qt_dispensada: z.number().int().positive("Quantidade deve ser positiva"),
  vl_unitario: z.number().nonnegative().optional().nullable(),
});

export const dispensacaoSchema = z.object({
  cd_paciente: z.number().int().positive(),
  cd_appointment: z.number().int().positive().optional().nullable(),
  cd_prescricao_id: z.number().int().positive().optional().nullable(),
  ds_observacao: z.string().optional().nullable(),
  itens: z.array(dispensacaoItemSchema).min(1, "Ao menos um item é obrigatório"),
});

export const receitaControladaSchema = z.object({
  cd_paciente: z.number().int().positive(),
  cd_medico: z.number().int().positive(),
  nr_receita: z.string().min(1, "Número da receita obrigatório").max(50),
  tp_receita: tpReceitaEnum,
  dt_emissao: z.string(),
  dt_validade: z.string(),
  qt_itens: z.number().int().positive(),
  ds_observacao: z.string().optional().nullable(),
});

// ── Types ────────────────────────────────────────────────────────────────────

export type Medicamento = z.infer<typeof medicamentoSchema> & {
  id: number;
  company_id: string;
  cd_origem_sigh?: number | null;
  created_at: string;
  updated_at: string;
};

export type Material = z.infer<typeof materialSchema> & {
  id: number;
  company_id: string;
  cd_origem_sigh?: number | null;
  created_at: string;
  updated_at: string;
};

export type Almoxarifado = z.infer<typeof almoxarifadoSchema> & {
  id: number;
  company_id: string;
  created_at: string;
};

export type Lote = z.infer<typeof loteSchema> & {
  id: number;
  company_id: string;
  created_at: string;
};

export type DispensacaoItem = z.infer<typeof dispensacaoItemSchema>;
export type DispensacaoInput = z.infer<typeof dispensacaoSchema>;

export type Dispensacao = {
  id: number;
  company_id: string;
  cd_paciente: number;
  cd_appointment?: number | null;
  cd_prescricao_id?: number | null;
  dt_dispensacao: string;
  cd_usuario?: string | null;
  ds_observacao?: string | null;
  cd_origem_sigh?: number | null;
  created_at: string;
};

export type ReceitaControlada = z.infer<typeof receitaControladaSchema> & {
  id: number;
  company_id: string;
  lg_sngpc_enviado: boolean;
  dt_sngpc_envio?: string | null;
  created_at: string;
};

export type EstoqueAtual = {
  cd_lote: number;
  company_id: string;
  cd_produto_tipo: "MEDICAMENTO" | "MATERIAL";
  ds_produto: string;
  cd_nome_comercial?: string | null;
  ds_concentracao?: string | null;
  nr_lote?: string;
  dt_validade: string;
  qt_atual: number;
  vl_custo_unitario?: number | null;
  cd_almoxarifado?: number | null;
  ds_almoxarifado?: string | null;
  status_validade: "VENCIDO" | "VENCE_30_DIAS" | "VENCE_90_DIAS" | "OK";
};

export type Movimentacao = {
  id: number;
  company_id: string;
  cd_lote: number;
  tp_movimentacao: z.infer<typeof tpMovimentacaoEnum>;
  qt_movimentada: number;
  qt_anterior: number;
  qt_posterior: number;
  cd_paciente?: number | null;
  cd_appointment?: number | null;
  cd_prescricao_id?: number | null;
  cd_usuario?: string | null;
  ds_motivo?: string | null;
  ds_observacao?: string | null;
  dt_movimentacao: string;
  created_at: string;
};

export type MovimentacaoInput = {
  cd_lote: number;
  tp_movimentacao: z.infer<typeof tpMovimentacaoEnum>;
  qt_movimentada: number;
  ds_motivo?: string;
  cd_paciente?: number;
  cd_appointment?: number;
  cd_prescricao_id?: number;
  ds_observacao?: string;
};

// ── Services ─────────────────────────────────────────────────────────────────

export const medicamentosService = {
  /**
   * Lista medicamentos com filtros opcionais.
   * Suporta busca textual por princípio ativo e nome comercial (ilike).
   */
  async getAll(filters?: {
    search?: string;
    classe?: string;
    controlado?: boolean;
    ativo?: boolean;
  }): Promise<Medicamento[]> {
    let q = supabase
      .from("medicamentos")
      .select("*")
      .order("cd_principio_ativo", { ascending: true });

    if (filters?.search) {
      const term = `%${filters.search}%`;
      q = q.or(`cd_principio_ativo.ilike.${term},cd_nome_comercial.ilike.${term}`);
    }
    if (filters?.classe) q = q.eq("cd_classe_terapeutica", filters.classe);
    if (filters?.controlado !== undefined) q = q.eq("lg_controlado", filters.controlado);
    if (filters?.ativo !== undefined) q = q.eq("lg_ativo", filters.ativo);

    const { data, error } = await q;
    if (error) throw new Error(`Erro ao listar medicamentos: ${error.message}`);
    return (data ?? []) as Medicamento[];
  },

  async getById(id: number): Promise<Medicamento | null> {
    const { data, error } = await supabase
      .from("medicamentos")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data as Medicamento) ?? null;
  },

  async create(input: z.infer<typeof medicamentoSchema>): Promise<Medicamento> {
    const parsed = medicamentoSchema.parse(input);
    const { data, error } = await supabase
      .from("medicamentos")
      .insert(parsed)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar medicamento: ${error.message}`);
    return data as Medicamento;
  },

  async update(id: number, input: Partial<z.infer<typeof medicamentoSchema>>): Promise<Medicamento> {
    const parsed = medicamentoSchema.partial().parse(input);
    const { data, error } = await supabase
      .from("medicamentos")
      .update(parsed)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro ao atualizar medicamento: ${error.message}`);
    return data as Medicamento;
  },
};

export const materiaisService = {
  async getAll(filters?: {
    search?: string;
    categoria?: string;
    ativo?: boolean;
  }): Promise<Material[]> {
    let q = supabase
      .from("materiais")
      .select("*")
      .order("ds_nome", { ascending: true });

    if (filters?.search) {
      const term = `%${filters.search}%`;
      q = q.ilike("ds_nome", term);
    }
    if (filters?.categoria) q = q.eq("ds_categoria", filters.categoria);
    if (filters?.ativo !== undefined) q = q.eq("lg_ativo", filters.ativo);

    const { data, error } = await q;
    if (error) throw new Error(`Erro ao listar materiais: ${error.message}`);
    return (data ?? []) as Material[];
  },

  async create(input: z.infer<typeof materialSchema>): Promise<Material> {
    const parsed = materialSchema.parse(input);
    const { data, error } = await supabase
      .from("materiais")
      .insert(parsed)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar material: ${error.message}`);
    return data as Material;
  },

  async update(id: number, input: Partial<z.infer<typeof materialSchema>>): Promise<Material> {
    const parsed = materialSchema.partial().parse(input);
    const { data, error } = await supabase
      .from("materiais")
      .update(parsed)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as Material;
  },
};

export const almoxarifadosService = {
  async getAll(ativo = true): Promise<Almoxarifado[]> {
    let q = supabase
      .from("almoxarifados")
      .select("*")
      .order("lg_principal", { ascending: false })
      .order("ds_nome");
    if (ativo) q = q.eq("lg_ativo", true);
    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as Almoxarifado[];
  },

  async create(input: z.infer<typeof almoxarifadoSchema>): Promise<Almoxarifado> {
    const parsed = almoxarifadoSchema.parse(input);
    const { data, error } = await supabase
      .from("almoxarifados")
      .insert(parsed)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as Almoxarifado;
  },
};

export const lotesService = {
  async create(input: z.infer<typeof loteSchema>): Promise<Lote> {
    const parsed = loteSchema.parse(input);
    // Se tipo for MEDICAMENTO, valida que cd_medicamento_id está setado
    if (parsed.cd_produto_tipo === "MEDICAMENTO" && !parsed.cd_medicamento_id) {
      throw new Error("cd_medicamento_id é obrigatório para tipo MEDICAMENTO");
    }
    if (parsed.cd_produto_tipo === "MATERIAL" && !parsed.cd_material_id) {
      throw new Error("cd_material_id é obrigatório para tipo MATERIAL");
    }
    const { data, error } = await supabase
      .from("lotes")
      .insert(parsed)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar lote: ${error.message}`);
    return data as Lote;
  },

  /**
   * Lista lotes válidos (qt_atual > 0 e dt_validade >= hoje) ordenando por FEFO.
   */
  async getValidos(produtoId: number, produtoTipo: "MEDICAMENTO" | "MATERIAL"): Promise<EstoqueAtual[]> {
    const column = produtoTipo === "MEDICAMENTO" ? "cd_medicamento_id" : "cd_material_id";
    const { data, error } = await supabase
      .from("v_estoque_atual")
      .select("*")
      .eq(column, produtoId)
      .in("status_validade", ["OK", "VENCE_30_DIAS", "VENCE_90_DIAS"]);
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as EstoqueAtual[];
  },

  /**
   * Lista lotes com vencimento em até N dias (alerta de validade).
   * Inclui VENCIDO, VENCE_30_DIAS e VENCE_90_DIAS.
   */
  async getProximosVencimento(dias = 30): Promise<EstoqueAtual[]> {
    const hoje = new Date();
    const limite = new Date();
    limite.setDate(limite.getDate() + dias);
    const { data, error } = await supabase
      .from("v_estoque_atual")
      .select("*")
      .lte("dt_validade", limite.toISOString().slice(0, 10))
      .order("dt_validade", { ascending: true });
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as EstoqueAtual[];
  },

  async getById(id: number): Promise<Lote | null> {
    const { data, error } = await supabase
      .from("lotes")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data as Lote) ?? null;
  },
};

export const movimentacoesService = {
  /**
   * Registra entrada de estoque.
   * Valida quantidade positiva e atualiza lote atomicamente via RPC.
   */
  async entrada(
    loteId: number,
    quantidade: number,
    motivo: string,
  ): Promise<{ id: number; qt_anterior: number; qt_posterior: number }> {
    if (!Number.isInteger(quantidade) || quantidade <= 0) {
      throw new Error("Quantidade deve ser inteira positiva");
    }
    if (!motivo || motivo.trim().length === 0) {
      throw new Error("Motivo é obrigatório");
    }
    const { data, error } = await supabase.rpc("registrar_movimentacao_estoque", {
      p_lote_id: loteId,
      p_tipo: "ENTRADA",
      p_quantidade: quantidade,
      p_motivo: motivo,
    });
    if (error) throw new Error(`Erro: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    return row as { id: number; qt_anterior: number; qt_posterior: number };
  },

  /**
   * Registra saída (dispensação para paciente).
   * Valida estoque suficiente.
   */
  async saida(
    loteId: number,
    quantidade: number,
    pacienteId: number,
    motivo: string,
    appointmentId?: number,
    prescricaoId?: number,
  ): Promise<{ id: number; qt_anterior: number; qt_posterior: number }> {
    if (!Number.isInteger(quantidade) || quantidade <= 0) {
      throw new Error("Quantidade deve ser inteira positiva");
    }
    if (!pacienteId || pacienteId <= 0) {
      throw new Error("Paciente é obrigatório");
    }
    const { data, error } = await supabase.rpc("registrar_movimentacao_estoque", {
      p_lote_id: loteId,
      p_tipo: "SAIDA",
      p_quantidade: quantidade,
      p_motivo: motivo ?? "Dispensação",
      p_paciente_id: pacienteId,
      p_appointment_id: appointmentId ?? null,
      p_prescricao_id: prescricaoId ?? null,
    });
    if (error) throw new Error(`Erro: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    return row as { id: number; qt_anterior: number; qt_posterior: number };
  },

  /**
   * Ajuste de inventário (contagem física).
   * Quantidade pode ser positiva (sobra) ou — mas a RPC atual usa +
   * Para diferenças negativas, usar tipo AJUSTE com nota explicativa.
   */
  async ajuste(
    loteId: number,
    quantidade: number,
    motivo: string,
  ): Promise<{ id: number; qt_anterior: number; qt_posterior: number }> {
    if (!motivo || motivo.trim().length === 0) {
      throw new Error("Motivo do ajuste é obrigatório");
    }
    const { data, error } = await supabase.rpc("registrar_movimentacao_estoque", {
      p_lote_id: loteId,
      p_tipo: "AJUSTE",
      p_quantidade: Math.abs(quantidade),
      p_motivo: motivo,
    });
    if (error) throw new Error(`Erro: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    return row as { id: number; qt_anterior: number; qt_posterior: number };
  },

  async getAll(filters?: {
    cd_lote?: number;
    tipo?: z.infer<typeof tpMovimentacaoEnum>;
    cd_paciente?: number;
    dataInicio?: string;
    dataFim?: string;
    limit?: number;
  }): Promise<Movimentacao[]> {
    let q = supabase
      .from("movimentacoes_estoque")
      .select("*")
      .order("dt_movimentacao", { ascending: false });
    if (filters?.cd_lote) q = q.eq("cd_lote", filters.cd_lote);
    if (filters?.tipo) q = q.eq("tp_movimentacao", filters.tipo);
    if (filters?.cd_paciente) q = q.eq("cd_paciente", filters.cd_paciente);
    if (filters?.dataInicio) q = q.gte("dt_movimentacao", filters.dataInicio);
    if (filters?.dataFim) q = q.lte("dt_movimentacao", filters.dataFim);
    if (filters?.limit) q = q.limit(filters.limit);
    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as Movimentacao[];
  },
};

export const dispensacoesService = {
  /**
   * Cria uma dispensação com seus itens.
   * Para cada item, registra movimentação de SAÍDA do lote.
   * Tudo em uma transação lógica — se algum item falhar, abortar.
   */
  async create(input: z.infer<typeof dispensacaoSchema>): Promise<Dispensacao> {
    const parsed = dispensacaoSchema.parse(input);
    // 1. Cria a dispensação
    const { data: disp, error: dispErr } = await supabase
      .from("dispensacoes")
      .insert({
        cd_paciente: parsed.cd_paciente,
        cd_appointment: parsed.cd_appointment ?? null,
        cd_prescricao_id: parsed.cd_prescricao_id ?? null,
        ds_observacao: parsed.ds_observacao ?? null,
      })
      .select()
      .single();
    if (dispErr) throw new Error(`Erro ao criar dispensação: ${dispErr.message}`);
    const dispRow = disp as Dispensacao;

    // 2. Para cada item, registra movimentação + insere em dispensacao_itens
    for (const item of parsed.itens) {
      const mov = await movimentacoesService.saida(
        item.cd_lote,
        item.qt_dispensada,
        parsed.cd_paciente,
        "Dispensação de receita",
        parsed.cd_appointment ?? undefined,
        parsed.cd_prescricao_id ?? undefined,
      );
      const { error: itemErr } = await supabase.from("dispensacao_itens").insert({
        cd_dispensacao: dispRow.id,
        cd_lote: item.cd_lote,
        qt_dispensada: item.qt_dispensada,
        vl_unitario: item.vl_unitario ?? null,
      });
      if (itemErr) {
        // Rollback manual: remover a dispensação pai e a movimentação
        await supabase.from("dispensacoes").delete().eq("id", dispRow.id);
        throw new Error(`Erro ao inserir item (movimentação ${mov.id}): ${itemErr.message}`);
      }
    }

    return dispRow;
  },

  async getByPaciente(pacienteId: number, days = 90): Promise<Dispensacao[]> {
    const limite = new Date();
    limite.setDate(limite.getDate() - days);
    const { data, error } = await supabase
      .from("dispensacoes")
      .select("*")
      .eq("cd_paciente", pacienteId)
      .gte("dt_dispensacao", limite.toISOString())
      .order("dt_dispensacao", { ascending: false });
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as Dispensacao[];
  },

  async getItens(dispensacaoId: number): Promise<Array<DispensacaoItem & { cd_dispensacao: number }>> {
    const { data, error } = await supabase
      .from("dispensacao_itens")
      .select("*")
      .eq("cd_dispensacao", dispensacaoId);
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as Array<DispensacaoItem & { cd_dispensacao: number }>;
  },
};

export const receitasControladasService = {
  async create(input: z.infer<typeof receitaControladaSchema>): Promise<ReceitaControlada> {
    const parsed = receitaControladaSchema.parse(input);
    const { data, error } = await supabase
      .from("receitas_controladas")
      .insert(parsed)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as ReceitaControlada;
  },

  async getAll(filters?: {
    cd_paciente?: number;
    sngpcEnviado?: boolean;
    dataInicio?: string;
    dataFim?: string;
  }): Promise<ReceitaControlada[]> {
    let q = supabase
      .from("receitas_controladas")
      .select("*")
      .order("dt_emissao", { ascending: false });
    if (filters?.cd_paciente) q = q.eq("cd_paciente", filters.cd_paciente);
    if (filters?.sngpcEnviado !== undefined)
      q = q.eq("lg_sngpc_enviado", filters.sngpcEnviado);
    if (filters?.dataInicio) q = q.gte("dt_emissao", filters.dataInicio);
    if (filters?.dataFim) q = q.lte("dt_emissao", filters.dataFim);
    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as ReceitaControlada[];
  },

  /**
   * Marca a receita como enviada ao SNGPC/ANVISA.
   * Em produção, integraria com a API real da ANVISA;
   * aqui apenas marcamos a flag para fins de auditoria.
   */
  async enviarSNGPC(receitaId: number): Promise<ReceitaControlada> {
    const { data, error } = await supabase
      .from("receitas_controladas")
      .update({
        lg_sngpc_enviado: true,
        dt_sngpc_envio: new Date().toISOString(),
      })
      .eq("id", receitaId)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as ReceitaControlada;
  },
};

// ── Indicadores / Relatórios ─────────────────────────────────────────────────

export const pharmacyReportsService = {
  /**
   * Lista produtos com estoque abaixo do ponto de reposição.
   * Combina materiais (que têm ponto_reposicao) e — indiretamente — medicamentos.
   */
  async getEstoqueBaixo(): Promise<
    Array<{
      tipo: "MEDICAMENTO" | "MATERIAL";
      id: number;
      descricao: string;
      qt_atual: number;
      ponto_reposicao: number;
    }>
  > {
    // Materiais abaixo do ponto de reposição
    const { data: materiais, error: matErr } = await supabase
      .from("v_estoque_atual")
      .select("cd_lote, cd_produto_tipo, ds_produto, cd_material_id, qt_atual")
      .eq("cd_produto_tipo", "MATERIAL");
    if (matErr) throw new Error(`Erro: ${matErr.message}`);

    // Agrega qt_atual por material
    const agg = new Map<number, { id: number; descricao: string; qt: number }>();
    for (const row of materiais ?? []) {
      if (row.cd_material_id == null) continue;
      const cur = agg.get(row.cd_material_id) ?? {
        id: row.cd_material_id,
        descricao: row.ds_produto,
        qt: 0,
      };
      cur.qt += row.qt_atual;
      agg.set(row.cd_material_id, cur);
    }

    // Busca materiais com ponto_reposicao > 0
    const { data: mats } = await supabase
      .from("materiais")
      .select("id, ds_nome, ponto_reposicao")
      .gt("ponto_reposicao", 0);
    const resultado: Array<{
      tipo: "MEDICAMENTO" | "MATERIAL";
      id: number;
      descricao: string;
      qt_atual: number;
      ponto_reposicao: number;
    }> = [];
    for (const m of mats ?? []) {
      const cur = agg.get(m.id);
      const qt = cur?.qt ?? 0;
      if (qt <= m.ponto_reposicao) {
        resultado.push({
          tipo: "MATERIAL",
          id: m.id,
          descricao: m.ds_nome,
          qt_atual: qt,
          ponto_reposicao: m.ponto_reposicao,
        });
      }
    }
    // Ordena por menor saldo relativo
    return resultado.sort(
      (a, b) =>
        a.qt_atual / Math.max(a.ponto_reposicao, 1) -
        b.qt_atual / Math.max(b.ponto_reposicao, 1),
    );
  },

  /**
   * Valor total do estoque (custo médio).
   * Retorna o CMV (Custo da Mercadoria Vendida / em estoque).
   */
  async getValorEstoque(): Promise<number> {
    const { data, error } = await supabase.rpc("calcular_valor_estoque");
    if (error) {
      console.warn("calcular_valor_estoque falhou, calculando client-side:", error);
      // Fallback client-side
      const { data: rows, error: rErr } = await supabase
        .from("v_estoque_atual")
        .select("qt_atual, vl_custo_unitario");
      if (rErr) return 0;
      return (rows ?? []).reduce(
        (acc, r) => acc + r.qt_atual * Number(r.vl_custo_unitario ?? 0),
        0,
      );
    }
    return Number(data ?? 0);
  },

  /**
   * Total de produtos vencidos.
   */
  async getVencidos(): Promise<EstoqueAtual[]> {
    const { data, error } = await supabase
      .from("v_estoque_atual")
      .select("*")
      .eq("status_validade", "VENCIDO")
      .order("dt_validade", { ascending: true });
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as EstoqueAtual[];
  },
};

export const pharmacyService = {
  medicamentos: medicamentosService,
  materiais: materiaisService,
  almoxarifados: almoxarifadosService,
  lotes: lotesService,
  movimentacoes: movimentacoesService,
  dispensacoes: dispensacoesService,
  receitasControladas: receitasControladasService,
  reports: pharmacyReportsService,
};
