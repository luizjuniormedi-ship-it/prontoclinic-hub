/**
 * purchasesService — Módulo de Compras e Suprimentos
 *
 * Espelha e moderniza o SIGH:
 *   - SIGH.fornecedor (1637)       → public.fornecedores
 *   - SIGH.cotacao / cotacao_item  → public.cotacoes + public.cotacao_itens
 *   - SIGH.ordem_compra            → public.ordens_compra + public.ordem_compra_itens
 *
 * Migration relacionada: 20260101000020_compras.sql
 *
 * Decisões:
 *   - Validação Zod em todas as entradas (entrada é feita por humanos, e dados
 *     CNPJ/IE têm regras de tamanho/validação que devem ser aplicadas cedo)
 *   - Cotações armazenam snapshot do fornecedor e do produto, mas referenciam
 *     os IDs para que relatórios possam reagrupar.
 *   - Ordens de compra usam snapshot de descrição do produto (imutável após
 *     emissão) para evitar que renomeações no catálogo alterem histórico.
 *   - RLS já é tratada no banco — aqui só cuidamos de CRUD + regras de UI.
 */

import { z } from "zod";
import { supabase } from "@/lib/supabase";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const tpFornecedorEnum = z.enum([
  "MEDICAMENTOS",
  "MATERIAIS",
  "EQUIPAMENTOS",
  "SERVICOS",
  "OUTROS",
]);

export const tpStatusCotacaoEnum = z.enum([
  "EM_ANDAMENTO",
  "CONCLUIDA",
  "CANCELADA",
]);

export const tpStatusOCEnum = z.enum([
  "PENDENTE",
  "APROVADA",
  "ENVIADA",
  "RECEBIDA",
  "CANCELADA",
]);

export const tpPagamentoEnum = z.enum([
  "BOLETO",
  "PIX",
  "CARTAO",
  "TRANSFERENCIA",
  "DINHEIRO",
]);

export const tpProdutoEnum = z.enum(["MEDICAMENTO", "MATERIAL", "EQUIPAMENTO"]);

// ── Schemas ───────────────────────────────────────────────────────────────────

export const fornecedorSchema = z.object({
  nm_razao_social: z
    .string()
    .min(2, "Razão social obrigatória (mín. 2 caracteres)")
    .max(200),
  nm_fantasia: z.string().max(200).optional().nullable(),
  cd_cnpj: z
    .string()
    .regex(/^\d{14}$/, "CNPJ deve ter 14 dígitos")
    .optional()
    .nullable()
    .or(z.literal("")),
  cd_inscricao_estadual: z.string().max(20).optional().nullable(),
  ds_endereco: z.string().max(500).optional().nullable(),
  cd_cep: z.string().max(10).optional().nullable(),
  ds_cidade: z.string().max(100).optional().nullable(),
  ds_uf: z
    .string()
    .length(2, "UF deve ter 2 letras")
    .optional()
    .nullable()
    .or(z.literal("")),
  nr_telefone: z.string().max(20).optional().nullable(),
  nr_celular: z.string().max(20).optional().nullable(),
  ds_email: z.string().email("Email inválido").max(255).optional().nullable().or(z.literal("")),
  ds_contato: z.string().max(100).optional().nullable(),
  tp_fornecedor: tpFornecedorEnum.optional().nullable(),
  ds_observacoes: z.string().max(1000).optional().nullable(),
  vl_prazo_pagto_dias: z.number().int().nonnegative().default(30),
  lg_ativo: z.boolean().default(true),
});

export const cotacaoItemSchema = z.object({
  cd_fornecedor: z.number().int().positive("Fornecedor obrigatório"),
  cd_produto_tipo: tpProdutoEnum.optional().nullable(),
  cd_medicamento_id: z.number().int().positive().optional().nullable(),
  cd_material_id: z.number().int().positive().optional().nullable(),
  qt_pedida: z.number().int().positive("Quantidade deve ser positiva"),
  vl_unitario: z.number().nonnegative().optional().nullable(),
  vl_total: z.number().nonnegative().optional().nullable(),
  dt_entrega_prevista: z.string().optional().nullable(),
  ds_observacao: z.string().max(500).optional().nullable(),
  lg_escolhido: z.boolean().default(false),
});

export const cotacaoSchema = z.object({
  nr_cotacao: z.string().min(1, "Número obrigatório").max(50),
  dt_validade: z.string().optional().nullable(),
  ds_observacoes: z.string().max(1000).optional().nullable(),
  tp_status: tpStatusCotacaoEnum.default("EM_ANDAMENTO"),
  itens: z.array(cotacaoItemSchema).min(1, "Adicione ao menos um item"),
});

export const ordemCompraItemSchema = z.object({
  cd_produto_tipo: tpProdutoEnum.optional().nullable(),
  cd_medicamento_id: z.number().int().positive().optional().nullable(),
  cd_material_id: z.number().int().positive().optional().nullable(),
  ds_produto: z.string().min(2, "Descrição obrigatória").max(200),
  qt_solicitada: z.number().int().positive("Quantidade deve ser positiva"),
  qt_recebida: z.number().int().nonnegative().default(0),
  vl_unitario: z.number().nonnegative("Valor unitário deve ser positivo"),
  vl_total: z.number().nonnegative("Valor total deve ser positivo"),
});

export const ordemCompraSchema = z.object({
  nr_ordem: z.string().min(1, "Número da OC obrigatório").max(50),
  cd_fornecedor: z.number().int().positive("Fornecedor obrigatório"),
  dt_previsao_entrega: z.string().optional().nullable(),
  vl_total: z.number().nonnegative("Total deve ser positivo"),
  tp_status: tpStatusOCEnum.default("PENDENTE"),
  tp_pagamento: tpPagamentoEnum.optional().nullable(),
  cd_condicao_pagto: z.string().max(100).optional().nullable(),
  ds_observacoes: z.string().max(1000).optional().nullable(),
  itens: z.array(ordemCompraItemSchema).min(1, "Adicione ao menos um item"),
});

// ── Types ─────────────────────────────────────────────────────────────────────

export type Fornecedor = z.infer<typeof fornecedorSchema> & {
  id: number;
  company_id: string;
  cd_origem_sigh?: number | null;
  created_at: string;
  updated_at: string;
};

export type CotacaoItem = z.infer<typeof cotacaoItemSchema> & {
  id: number;
  cd_cotacao: number;
  created_at: string;
};

export type Cotacao = {
  id: number;
  company_id: string;
  nr_cotacao: string;
  dt_cotacao: string;
  dt_validade?: string | null;
  cd_usuario?: string | null;
  ds_observacoes?: string | null;
  tp_status: z.infer<typeof tpStatusCotacaoEnum>;
  cd_origem_sigh?: number | null;
  created_at: string;
};

export type OrdemCompraItem = z.infer<typeof ordemCompraItemSchema> & {
  id: number;
  cd_ordem_compra: number;
  created_at: string;
};

export type OrdemCompra = {
  id: number;
  company_id: string;
  nr_ordem: string;
  cd_fornecedor: number;
  dt_emissao: string;
  dt_previsao_entrega?: string | null;
  vl_total: number;
  tp_status: z.infer<typeof tpStatusOCEnum>;
  tp_pagamento?: z.infer<typeof tpPagamentoEnum> | null;
  cd_condicao_pagto?: string | null;
  cd_usuario_solicitante?: string | null;
  cd_usuario_aprovador?: string | null;
  ds_observacoes?: string | null;
  dt_recebimento?: string | null;
  nr_nota_fiscal?: string | null;
  cd_origem_sigh?: number | null;
  created_at: string;
  updated_at: string;
};

// ── Services ──────────────────────────────────────────────────────────────────

export const fornecedoresService = {
  async getAll(filters?: { search?: string; tipo?: z.infer<typeof tpFornecedorEnum>; ativo?: boolean }): Promise<Fornecedor[]> {
    let q = supabase
      .from("fornecedores")
      .select("*")
      .order("nm_razao_social", { ascending: true });

    if (filters?.search) {
      const term = `%${filters.search}%`;
      q = q.or(`nm_razao_social.ilike.${term},nm_fantasia.ilike.${term},cd_cnpj.ilike.${term}`);
    }
    if (filters?.tipo) q = q.eq("tp_fornecedor", filters.tipo);
    if (filters?.ativo !== undefined) q = q.eq("lg_ativo", filters.ativo);

    const { data, error } = await q;
    if (error) throw new Error(`Erro ao listar fornecedores: ${error.message}`);
    return (data ?? []) as Fornecedor[];
  },

  async getById(id: number): Promise<Fornecedor | null> {
    const { data, error } = await supabase
      .from("fornecedores")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro ao buscar fornecedor: ${error.message}`);
    return (data as Fornecedor) ?? null;
  },

  async create(input: z.infer<typeof fornecedorSchema>): Promise<Fornecedor> {
    const parsed = fornecedorSchema.parse(input);
    const { data, error } = await supabase
      .from("fornecedores")
      .insert(parsed)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar fornecedor: ${error.message}`);
    return data as Fornecedor;
  },

  async update(id: number, input: Partial<z.infer<typeof fornecedorSchema>>): Promise<Fornecedor> {
    const parsed = fornecedorSchema.partial().parse(input);
    const { data, error } = await supabase
      .from("fornecedores")
      .update(parsed)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro ao atualizar fornecedor: ${error.message}`);
    return data as Fornecedor;
  },

  async toggleAtivo(id: number, ativo: boolean): Promise<Fornecedor> {
    return this.update(id, { lg_ativo: ativo });
  },
};

export const cotacoesService = {
  async getAll(filters?: { status?: z.infer<typeof tpStatusCotacaoEnum> }): Promise<Cotacao[]> {
    let q = supabase
      .from("cotacoes")
      .select("*")
      .order("dt_cotacao", { ascending: false });
    if (filters?.status) q = q.eq("tp_status", filters.status);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao listar cotações: ${error.message}`);
    return (data ?? []) as Cotacao[];
  },

  async getItens(cotacaoId: number): Promise<CotacaoItem[]> {
    const { data, error } = await supabase
      .from("cotacao_itens")
      .select("*")
      .eq("cd_cotacao", cotacaoId);
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as CotacaoItem[];
  },

  /**
   * Cria cotação com seus itens em uma transação lógica.
   * Se a inserção de itens falhar, a cotação pai é removida (rollback manual).
   */
  async create(input: z.infer<typeof cotacaoSchema>): Promise<{ cotacao: Cotacao; itens: CotacaoItem[] }> {
    const parsed = cotacaoSchema.parse(input);
    const { itens, ...cotacaoData } = parsed;

    const { data: cot, error: cotErr } = await supabase
      .from("cotacoes")
      .insert({
        nr_cotacao: cotacaoData.nr_cotacao,
        dt_validade: cotacaoData.dt_validade ?? null,
        ds_observacoes: cotacaoData.ds_observacoes ?? null,
        tp_status: cotacaoData.tp_status,
      })
      .select()
      .single();
    if (cotErr) throw new Error(`Erro ao criar cotação: ${cotErr.message}`);
    const cotRow = cot as Cotacao;

    const itensComCotacao = itens.map((it) => ({
      cd_cotacao: cotRow.id,
      cd_fornecedor: it.cd_fornecedor,
      cd_produto_tipo: it.cd_produto_tipo ?? null,
      cd_medicamento_id: it.cd_medicamento_id ?? null,
      cd_material_id: it.cd_material_id ?? null,
      qt_pedida: it.qt_pedida,
      vl_unitario: it.vl_unitario ?? null,
      vl_total: it.vl_total ?? null,
      dt_entrega_prevista: it.dt_entrega_prevista ?? null,
      ds_observacao: it.ds_observacao ?? null,
      lg_escolhido: it.lg_escolhido,
    }));
    const { data: itensRows, error: itensErr } = await supabase
      .from("cotacao_itens")
      .insert(itensComCotacao)
      .select();
    if (itensErr) {
      await supabase.from("cotacoes").delete().eq("id", cotRow.id);
      throw new Error(`Erro ao inserir itens da cotação: ${itensErr.message}`);
    }

    return { cotacao: cotRow, itens: (itensRows ?? []) as CotacaoItem[] };
  },

  async updateStatus(id: number, status: z.infer<typeof tpStatusCotacaoEnum>): Promise<Cotacao> {
    const { data, error } = await supabase
      .from("cotacoes")
      .update({ tp_status: status })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro ao atualizar cotação: ${error.message}`);
    return data as Cotacao;
  },
};

export const ordensCompraService = {
  async getAll(filters?: {
    status?: z.infer<typeof tpStatusOCEnum>;
    cd_fornecedor?: number;
  }): Promise<OrdemCompra[]> {
    let q = supabase
      .from("ordens_compra")
      .select("*")
      .order("dt_emissao", { ascending: false });
    if (filters?.status) q = q.eq("tp_status", filters.status);
    if (filters?.cd_fornecedor) q = q.eq("cd_fornecedor", filters.cd_fornecedor);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao listar OCs: ${error.message}`);
    return (data ?? []) as OrdemCompra[];
  },

  async getById(id: number): Promise<OrdemCompra | null> {
    const { data, error } = await supabase
      .from("ordens_compra")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data as OrdemCompra) ?? null;
  },

  async getItens(ocId: number): Promise<OrdemCompraItem[]> {
    const { data, error } = await supabase
      .from("ordem_compra_itens")
      .select("*")
      .eq("cd_ordem_compra", ocId);
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as OrdemCompraItem[];
  },

  /**
   * Cria ordem de compra com seus itens. Mesma estratégia de rollback da cotação.
   */
  async create(input: z.infer<typeof ordemCompraSchema>): Promise<{ oc: OrdemCompra; itens: OrdemCompraItem[] }> {
    const parsed = ordemCompraSchema.parse(input);
    const { itens, ...ocData } = parsed;

    const { data: oc, error: ocErr } = await supabase
      .from("ordens_compra")
      .insert({
        nr_ordem: ocData.nr_ordem,
        cd_fornecedor: ocData.cd_fornecedor,
        dt_previsao_entrega: ocData.dt_previsao_entrega ?? null,
        vl_total: ocData.vl_total,
        tp_status: ocData.tp_status,
        tp_pagamento: ocData.tp_pagamento ?? null,
        cd_condicao_pagto: ocData.cd_condicao_pagto ?? null,
        ds_observacoes: ocData.ds_observacoes ?? null,
      })
      .select()
      .single();
    if (ocErr) throw new Error(`Erro ao criar OC: ${ocErr.message}`);
    const ocRow = oc as OrdemCompra;

    const itensComOC = itens.map((it) => ({
      cd_ordem_compra: ocRow.id,
      cd_produto_tipo: it.cd_produto_tipo ?? null,
      cd_medicamento_id: it.cd_medicamento_id ?? null,
      cd_material_id: it.cd_material_id ?? null,
      ds_produto: it.ds_produto,
      qt_solicitada: it.qt_solicitada,
      qt_recebida: it.qt_recebida,
      vl_unitario: it.vl_unitario,
      vl_total: it.vl_total,
    }));
    const { data: itensRows, error: itensErr } = await supabase
      .from("ordem_compra_itens")
      .insert(itensComOC)
      .select();
    if (itensErr) {
      await supabase.from("ordens_compra").delete().eq("id", ocRow.id);
      throw new Error(`Erro ao inserir itens da OC: ${itensErr.message}`);
    }

    return { oc: ocRow, itens: (itensRows ?? []) as OrdemCompraItem[] };
  },

  async updateStatus(id: number, status: z.infer<typeof tpStatusOCEnum>): Promise<OrdemCompra> {
    const { data, error } = await supabase
      .from("ordens_compra")
      .update({ tp_status: status })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro ao atualizar status da OC: ${error.message}`);
    return data as OrdemCompra;
  },

  async aprovar(id: number, aprovadorId: string): Promise<OrdemCompra> {
    const { data, error } = await supabase
      .from("ordens_compra")
      .update({ tp_status: "APROVADA", cd_usuario_aprovador: aprovadorId })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro ao aprovar OC: ${error.message}`);
    return data as OrdemCompra;
  },

  /**
   * Registra o recebimento da OC — atualiza status, NF e data de recebimento.
   */
  async receber(id: number, notaFiscal: string): Promise<OrdemCompra> {
    const { data, error } = await supabase
      .from("ordens_compra")
      .update({
        tp_status: "RECEBIDA",
        dt_recebimento: new Date().toISOString(),
        nr_nota_fiscal: notaFiscal,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro ao receber OC: ${error.message}`);
    return data as OrdemCompra;
  },
};

// ── Relatórios ────────────────────────────────────────────────────────────────

export const purchasesReportsService = {
  /**
   * Total gasto em ordens de compra recebidas, no período.
   * Filtra por company_id via RLS — a query já está escopada.
   */
  async getTotalGasto(dataInicio: string, dataFim: string): Promise<number> {
    const { data, error } = await supabase
      .from("ordens_compra")
      .select("vl_total")
      .eq("tp_status", "RECEBIDA")
      .gte("dt_emissao", dataInicio)
      .lte("dt_emissao", dataFim);
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []).reduce((acc, row) => acc + Number(row.vl_total ?? 0), 0);
  },

  async getOCsPorStatus(): Promise<Record<z.infer<typeof tpStatusOCEnum>, number>> {
    const { data, error } = await supabase
      .from("ordens_compra")
      .select("tp_status");
    if (error) throw new Error(`Erro: ${error.message}`);
    const acc: Record<string, number> = {};
    for (const row of data ?? []) {
      acc[row.tp_status] = (acc[row.tp_status] ?? 0) + 1;
    }
    return acc as Record<z.infer<typeof tpStatusOCEnum>, number>;
  },
};

export const purchasesService = {
  fornecedores: fornecedoresService,
  cotacoes: cotacoesService,
  ordensCompra: ordensCompraService,
  reports: purchasesReportsService,
};
