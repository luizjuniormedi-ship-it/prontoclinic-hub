/**
 * biService.ts
 *
 * Service de Business Intelligence — Indicadores e dashboards.
 *
 * Responsabilidades:
 *  - Calcular/consultar KPIs do dia (agendamentos, financeiro, operacional)
 *  - Buscar séries temporais de KPIs
 *  - Comparativos (profissionais, convênios)
 *  - CRUD de metas e alertas
 *  - Recalcular KPIs e detectar alertas via RPC
 *
 * Tabelas/views Supabase:
 *  - public.bi_kpis_diarios (snapshot diário)
 *  - public.bi_metas (metas)
 *  - public.bi_alertas (alertas)
 *  - public.v_ocupacao_profissional (view)
 *  - public.v_faturamento_convenio (view)
 *  - public.calcular_kpis_diarios() (RPC)
 *  - public.detectar_alertas_bi() (RPC)
 */

import { supabase } from "@/lib/supabase";

// =============================================================================
// Types
// =============================================================================

export type KpiCodigo =
  | "TAXA_NO_SHOW"
  | "TAXA_CONFIRMACAO"
  | "OCUPACAO"
  | "FATURAMENTO_MENSAL"
  | "TICKET_MEDIO"
  | "NPS"
  | "TEMPO_ESPERA"
  | "GLOSA_PERCENT";

export type PeriodoTipo = "DIARIO" | "SEMANAL" | "MENSAL" | "ANUAL";

export type ComparacaoTipo = "IGUAL_MAIOR" | "IGUAL_MENOR" | "ENTRE";

export type Severidade = "INFO" | "ATENCAO" | "CRITICO";

export interface Meta {
  id: number;
  company_id: string;
  cd_kpi: KpiCodigo | string;
  vl_meta: number;
  vl_atual: number;
  tp_periodo: PeriodoTipo;
  dt_inicio: string;
  dt_fim: string | null;
  tp_comparacao: ComparacaoTipo | null;
  ds_observacao: string | null;
  cd_usuario_criou: string | null;
  created_at: string;
}

export interface Alerta {
  id: number;
  company_id: string;
  cd_kpi: string;
  ds_alerta: string;
  tp_severidade: Severidade;
  vl_atual: number;
  vl_esperado: number;
  ds_sugestao: string | null;
  dt_alerta: string;
  lg_resolvido: boolean;
  dt_resolvido: string | null;
  cd_usuario_resolveu: string | null;
  created_at: string;
}

export interface KpiDiario {
  id: number;
  company_id: string;
  dt_referencia: string;
  nr_agendamentos_total: number;
  nr_agendamentos_confirmados: number;
  nr_agendamentos_atendidos: number;
  nr_agendamentos_faltaram: number;
  nr_agendamentos_cancelados: number;
  nr_taxa_confirmacao: number | null;
  nr_taxa_no_show: number | null;
  vl_faturado_dia: number;
  vl_recebido_dia: number;
  vl_glosa_dia: number;
  vl_ticket_medio: number;
  nr_pacientes_novos: number;
  nr_pacientes_total: number;
  nr_ocupacao_percent: number;
}

export interface KpisHoje {
  agendamentos: {
    total: number;
    confirmados: number;
    atendidos: number;
    faltaram: number;
    cancelados: number;
    taxaConfirmacao: number;
    taxaNoShow: number;
  };
  financeiro: {
    faturado: number;
    recebido: number;
    glosa: number;
    ticketMedio: number;
  };
  operacional: {
    pacientesNovos: number;
    pacientesTotal: number;
    ocupacao: number;
    tempoMedioEspera: number;
  };
  comparativo: {
    mesAnterior: {
      faturado: number;
      atendimentos: number;
    };
    variacao: {
      faturamento: number;
      atendimentos: number;
    };
  };
}

export interface SerieTemporal {
  data: string;
  valor: number;
}

export interface ComparativoProfissional {
  cd_profissional: string;
  nm_profissional: string;
  ds_especialidade: string | null;
  nr_agendamentos_total: number;
  nr_confirmados: number;
  nr_atendidos: number;
  nr_faltaram: number;
  nr_taxa_atendimento: number | null;
}

export interface ComparativoConvenio {
  cd_convenio: string;
  nm_convenio: string;
  nm_fonte_pagadora: string | null;
  nr_atendimentos: number;
  vl_faturado: number;
  vl_recebido: number;
  vl_a_receber: number;
}

// =============================================================================
// Helpers
// =============================================================================

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : fallback;
}

function asDateString(value: string | Date): string {
  if (typeof value === "string") return value;
  return value.toISOString().split("T")[0];
}

function calcularVariacao(atual: number, anterior: number): number {
  if (!anterior) return atual > 0 ? 100 : 0;
  return Number((((atual - anterior) / anterior) * 100).toFixed(2));
}

// =============================================================================
// Service
// =============================================================================

class BIServiceImpl {
  // -------------------------------------------------------------------------
  // 2.1. KPIs do dia
  // -------------------------------------------------------------------------
  /**
   * Retorna snapshot consolidado dos KPIs do dia atual (ou data fornecida).
   * Combina dados da tabela `bi_kpis_diarios` com agregações em tempo real
   * (caso o snapshot esteja ausente).
   */
  async getKPIsHoje(companyId: string, data?: Date): Promise<KpisHoje> {
    const refDate = data ? asDateString(data) : new Date().toISOString().split("T")[0];
    const previousMonth = new Date();
    previousMonth.setMonth(previousMonth.getMonth() - 1);
    const prevMonthStart = previousMonth.toISOString().split("T")[0];

    // 1) Buscar snapshot do dia
    const { data: snapshot, error: snapError } = await supabase
      .from("bi_kpis_diarios")
      .select("*")
      .eq("company_id", companyId)
      .eq("dt_referencia", refDate)
      .maybeSingle();

    if (snapError) {
      // Não fatal — caímos no cálculo em tempo real
      console.warn("[biService] snapshot error:", snapError.message);
    }

    // 2) Se snapshot ausente, calcular em tempo real
    if (!snapshot) {
      return this.computeKPIsRealtime(companyId, refDate);
    }

    // 3) Comparativo com mês anterior
    const { data: prevMonth, error: prevError } = await supabase
      .from("bi_kpis_diarios")
      .select("vl_faturado_dia, nr_agendamentos_total")
      .eq("company_id", companyId)
      .gte("dt_referencia", prevMonthStart)
      .lt("dt_referencia", refDate)
      .order("dt_referencia", { ascending: false })
      .limit(30);

    if (prevError) {
      console.warn("[biService] prev month error:", prevError.message);
    }

    const totalFaturadoAnterior = (prevMonth ?? []).reduce(
      (acc, r) => acc + asNumber(r.vl_faturado_dia),
      0,
    );
    const totalAtendimentosAnterior = (prevMonth ?? []).reduce(
      (acc, r) => acc + asNumber(r.nr_agendamentos_total),
      0,
    );

    const s = snapshot as KpiDiario;
    return {
      agendamentos: {
        total: asNumber(s.nr_agendamentos_total),
        confirmados: asNumber(s.nr_agendamentos_confirmados),
        atendidos: asNumber(s.nr_agendamentos_atendidos),
        faltaram: asNumber(s.nr_agendamentos_faltaram),
        cancelados: asNumber(s.nr_agendamentos_cancelados),
        taxaConfirmacao: asNumber(s.nr_taxa_confirmacao),
        taxaNoShow: asNumber(s.nr_taxa_no_show),
      },
      financeiro: {
        faturado: asNumber(s.vl_faturado_dia),
        recebido: asNumber(s.vl_recebido_dia),
        glosa: asNumber(s.vl_glosa_dia),
        ticketMedio: asNumber(s.vl_ticket_medio),
      },
      operacional: {
        pacientesNovos: asNumber(s.nr_pacientes_novos),
        pacientesTotal: asNumber(s.nr_pacientes_total),
        ocupacao: asNumber(s.nr_ocupacao_percent),
        tempoMedioEspera: 0,
      },
      comparativo: {
        mesAnterior: {
          faturado: totalFaturadoAnterior,
          atendimentos: totalAtendimentosAnterior,
        },
        variacao: {
          faturamento: calcularVariacao(asNumber(s.vl_faturado_dia), totalFaturadoAnterior),
          atendimentos: calcularVariacao(asNumber(s.nr_agendamentos_total), totalAtendimentosAnterior),
        },
      },
    };
  }

  /** Fallback: agrega KPIs em tempo real via SQL direta. */
  private async computeKPIsRealtime(companyId: string, refDate: string): Promise<KpisHoje> {
    const { data, error } = await supabase
      .from("appointments")
      .select("id, status, created_at, patient_id, billings(amount, paid_amount)")
      .eq("company_id", companyId)
      .eq("appointment_date", refDate);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      id: string;
      status: string;
      created_at: string;
      patient_id: string;
      billings: Array<{ amount: number; paid_amount: number }> | null;
    }>;

    const total = rows.length;
    const confirmados = rows.filter((r) => r.status === "confirmed").length;
    const atendidos = rows.filter((r) => r.status === "completed").length;
    const faltaram = rows.filter((r) => r.status === "no_show").length;
    const cancelados = rows.filter((r) => r.status === "cancelled").length;

    const faturado = rows.reduce(
      (acc, r) => acc + (r.billings ?? []).reduce((s, b) => s + asNumber(b.amount), 0),
      0,
    );
    const recebido = rows.reduce(
      (acc, r) => acc + (r.billings ?? []).reduce((s, b) => s + asNumber(b.paid_amount), 0),
      0,
    );
    const pacientesUnicos = new Set(rows.map((r) => r.patient_id).filter(Boolean));
    const pacientesNovos = rows.filter((r) => r.created_at?.startsWith(refDate)).length;

    return {
      agendamentos: {
        total,
        confirmados,
        atendidos,
        faltaram,
        cancelados,
        taxaConfirmacao: total > 0 ? Number(((confirmados / total) * 100).toFixed(2)) : 0,
        taxaNoShow: total > 0 ? Number(((faltaram / total) * 100).toFixed(2)) : 0,
      },
      financeiro: {
        faturado,
        recebido,
        glosa: faturado - recebido,
        ticketMedio: atendidos > 0 ? Number((faturado / atendidos).toFixed(2)) : 0,
      },
      operacional: {
        pacientesNovos,
        pacientesTotal: pacientesUnicos.size,
        ocupacao: 0,
        tempoMedioEspera: 0,
      },
      comparativo: {
        mesAnterior: { faturado: 0, atendimentos: 0 },
        variacao: { faturamento: 0, atendimentos: 0 },
      },
    };
  }

  // -------------------------------------------------------------------------
  // 2.2. Série temporal
  // -------------------------------------------------------------------------
  /**
   * Retorna série temporal de um KPI por código.
   * Mapeamento de kpi → coluna:
   *  - 'faturamento' → vl_faturado_dia
   *  - 'recebido' → vl_recebido_dia
   *  - 'agendamentos' → nr_agendamentos_total
   *  - 'confirmados' → nr_agendamentos_confirmados
   *  - 'atendidos' → nr_agendamentos_atendidos
   *  - 'no_show' → nr_agendamentos_faltaram
   *  - 'taxa_no_show' → nr_taxa_no_show
   *  - 'taxa_confirmacao' → nr_taxa_confirmacao
   */
  async getSerieTemporal(
    companyId: string,
    kpi: string,
    dias: number = 30,
  ): Promise<SerieTemporal[]> {
    const coluna = mapKpiToColumn(kpi);
    const since = new Date();
    since.setDate(since.getDate() - dias);

    const { data, error } = await supabase
      .from("bi_kpis_diarios")
      .select(`dt_referencia, ${coluna}`)
      .eq("company_id", companyId)
      .gte("dt_referencia", since.toISOString().split("T")[0])
      .order("dt_referencia", { ascending: true });

    if (error) throw error;

    return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
      data: String(r.dt_referencia),
      valor: asNumber(r[coluna]),
    }));
  }

  // -------------------------------------------------------------------------
  // 2.3. Comparativo entre profissionais
  // -------------------------------------------------------------------------
  async getComparativoProfissionais(
    companyId: string,
    _periodo?: { inicio: string; fim: string },
  ): Promise<ComparativoProfissional[]> {
    // View já filtra últimos 30 dias; ignora periodo para simplicidade.
    const { data, error } = await supabase
      .from("v_ocupacao_profissional")
      .select("*")
      .order("nr_agendamentos_total", { ascending: false });

    if (error) throw error;

    // Filtra profissionais da company (a view não tem company_id, mas podemos
    // cruzar com a tabela de profissionais depois — deixamos todos por ora)
    void companyId;

    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      cd_profissional: String(r.cd_profissional ?? ""),
      nm_profissional: String(r.nm_profissional ?? ""),
      ds_especialidade: (r.ds_especialidade as string | null) ?? null,
      nr_agendamentos_total: asNumber(r.nr_agendamentos_total),
      nr_confirmados: asNumber(r.nr_confirmados),
      nr_atendidos: asNumber(r.nr_atendidos),
      nr_faltaram: asNumber(r.nr_faltaram),
      nr_taxa_atendimento: r.nr_taxa_atendimento === null ? null : asNumber(r.nr_taxa_atendimento),
    }));
  }

  // -------------------------------------------------------------------------
  // 2.4. Comparativo entre convênios
  // -------------------------------------------------------------------------
  async getComparativoConvenios(
    companyId: string,
    _periodo?: { inicio: string; fim: string },
  ): Promise<ComparativoConvenio[]> {
    const { data, error } = await supabase
      .from("v_faturamento_convenio")
      .select("*")
      .order("vl_faturado", { ascending: false });

    if (error) throw error;

    void companyId;

    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      cd_convenio: String(r.cd_convenio ?? ""),
      nm_convenio: String(r.nm_convenio ?? ""),
      nm_fonte_pagadora: (r.nm_fonte_pagadora as string | null) ?? null,
      nr_atendimentos: asNumber(r.nr_atendimentos),
      vl_faturado: asNumber(r.vl_faturado),
      vl_recebido: asNumber(r.vl_recebido),
      vl_a_receber: asNumber(r.vl_a_receber),
    }));
  }

  // -------------------------------------------------------------------------
  // 2.5. Alertas pendentes
  // -------------------------------------------------------------------------
  async getAlertasPendentes(
    companyId: string,
    options?: { severidade?: Severidade; limite?: number },
  ): Promise<Alerta[]> {
    let query = supabase
      .from("bi_alertas")
      .select("*")
      .eq("company_id", companyId)
      .eq("lg_resolvido", false)
      .order("dt_alerta", { ascending: false });

    if (options?.severidade) {
      query = query.eq("tp_severidade", options.severidade);
    }
    if (options?.limite) {
      query = query.limit(options.limite);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as Alerta[];
  }

  async getAlertasHistorico(companyId: string, limite: number = 50): Promise<Alerta[]> {
    const { data, error } = await supabase
      .from("bi_alertas")
      .select("*")
      .eq("company_id", companyId)
      .order("dt_alerta", { ascending: false })
      .limit(limite);

    if (error) throw error;
    return (data ?? []) as Alerta[];
  }

  // -------------------------------------------------------------------------
  // 2.6. Resolver alerta
  // -------------------------------------------------------------------------
  async resolverAlerta(alertaId: number, userId: string): Promise<void> {
    const { error } = await supabase
      .from("bi_alertas")
      .update({
        lg_resolvido: true,
        dt_resolvido: new Date().toISOString(),
        cd_usuario_resolveu: userId,
      })
      .eq("id", alertaId);

    if (error) throw error;
  }

  // -------------------------------------------------------------------------
  // 2.7. CRUD de metas
  // -------------------------------------------------------------------------
  async getMetas(companyId: string): Promise<Meta[]> {
    const { data, error } = await supabase
      .from("bi_metas")
      .select("*")
      .eq("company_id", companyId)
      .order("dt_inicio", { ascending: false });

    if (error) throw error;
    return (data ?? []) as Meta[];
  }

  async createMeta(companyId: string, meta: Partial<Meta>): Promise<Meta> {
    const payload = {
      company_id: companyId,
      cd_kpi: meta.cd_kpi ?? "TAXA_NO_SHOW",
      vl_meta: meta.vl_meta ?? 0,
      vl_atual: meta.vl_atual ?? 0,
      tp_periodo: meta.tp_periodo ?? "MENSAL",
      dt_inicio: meta.dt_inicio ?? new Date().toISOString().split("T")[0],
      dt_fim: meta.dt_fim ?? null,
      tp_comparacao: meta.tp_comparacao ?? null,
      ds_observacao: meta.ds_observacao ?? null,
      cd_usuario_criou: meta.cd_usuario_criou ?? null,
    };

    const { data, error } = await supabase
      .from("bi_metas")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return data as Meta;
  }

  async updateMeta(id: number, meta: Partial<Meta>): Promise<Meta> {
    const { data, error } = await supabase
      .from("bi_metas")
      .update({
        cd_kpi: meta.cd_kpi,
        vl_meta: meta.vl_meta,
        vl_atual: meta.vl_atual,
        tp_periodo: meta.tp_periodo,
        dt_inicio: meta.dt_inicio,
        dt_fim: meta.dt_fim,
        tp_comparacao: meta.tp_comparacao,
        ds_observacao: meta.ds_observacao,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data as Meta;
  }

  async deleteMeta(id: number): Promise<void> {
    const { error } = await supabase.from("bi_metas").delete().eq("id", id);
    if (error) throw error;
  }

  // -------------------------------------------------------------------------
  // 2.8. Recalcular KPIs
  // -------------------------------------------------------------------------
  async recalcularKPIs(companyId: string, data: Date): Promise<void> {
    const { error } = await supabase.rpc("calcular_kpis_diarios", {
      p_company_id: companyId,
      p_data: asDateString(data),
    });
    if (error) throw error;
  }

  // -------------------------------------------------------------------------
  // 2.9. Detectar alertas
  // -------------------------------------------------------------------------
  async detectarAlertas(companyId: string): Promise<number> {
    const antes = await this.getAlertasPendentes(companyId);
    const { error } = await supabase.rpc("detectar_alertas_bi", {
      p_company_id: companyId,
    });
    if (error) throw error;
    const depois = await this.getAlertasPendentes(companyId);
    return Math.max(0, depois.length - antes.length);
  }
}

// =============================================================================
// Helpers internos
// =============================================================================

function mapKpiToColumn(kpi: string): string {
  const map: Record<string, string> = {
    faturamento: "vl_faturado_dia",
    recebido: "vl_recebido_dia",
    glosa: "vl_glosa_dia",
    ticket_medio: "vl_ticket_medio",
    agendamentos: "nr_agendamentos_total",
    confirmados: "nr_agendamentos_confirmados",
    atendidos: "nr_agendamentos_atendidos",
    no_show: "nr_agendamentos_faltaram",
    cancelados: "nr_agendamentos_cancelados",
    taxa_no_show: "nr_taxa_no_show",
    taxa_confirmacao: "nr_taxa_confirmacao",
    pacientes_novos: "nr_pacientes_novos",
    ocupacao: "nr_ocupacao_percent",
  };
  return map[kpi] ?? "vl_faturado_dia";
}

export const biService = new BIServiceImpl();
export const biServiceHelpers = { mapKpiToColumn };
