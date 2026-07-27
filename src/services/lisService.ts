/**
 * lisService — Módulo LIS/Laboratório (Laboratory Information System)
 *
 * Implementa o fluxo completo de exames laboratoriais:
 *   - Catálogo (TUSS, LOINC, sigla)
 *   - Valores de referência (por sexo/idade)
 *   - Pedidos (workflow PENDENTE → COLETADO → EM_ANALISE → LIBERADO → ENTREGUE)
 *   - Resultados (com classificação automática NORMAL/ALTO/BAIXO/CRITICO)
 *   - Alertas críticos (comunicação ao médico)
 *   - Parser HL7 v2.5 (ORU^R01)
 *
 * Migration relacionada: 20260101000018_lis.sql
 *
 * Padrão HL7 v2.5:
 *   - Segmentos terminados em \r
 *   - Campos separados por |
 *   - Componentes por ^
 *   - Repetições por ~
 *   - Mensagem típica: ORU^R01 (Observational Result Unsolicited)
 */

import { supabase } from "@/lib/supabase";

// ── Tipos / Enums ────────────────────────────────────────────────────────────

export type LabExamCategoria =
  | "HEMATOLOGIA"
  | "BIOQUIMICA"
  | "URINALISE"
  | "COAGULACAO"
  | "IMUNOLOGIA"
  | "SOROLOGIA"
  | "CULTURA"
  | "HORMONIO"
  | "PARASITOLOGIA"
  | "OUTROS";

export type LabMaterial = "SANGUE" | "URINA" | "FEZES" | "SWAB" | "LIQUOR" | "OUTROS";

export type LabPrioridade = "ROTINA" | "URGENTE" | "EMERGENCIA";

export type LabTipoAtendimento = "AMBULATORIAL" | "INTERNACAO" | "URGENCIA" | "DOMICILIAR";

export type LabPedidoStatus =
  | "PENDENTE"
  | "COLETADO"
  | "EM_ANALISE"
  | "LIBERADO"
  | "ENTREGUE"
  | "CANCELADO";

export type LabResultadoTipo =
  | "NORMAL"
  | "BAIXO"
  | "ALTO"
  | "CRITICO_BAIXO"
  | "CRITICO_ALTO"
  | "INCONCLUSIVO";

export type AlertaTipo = "CRITICO_BAIXO" | "CRITICO_ALTO";
export type FormaComunicacao = "TELEFONE" | "SMS" | "PRESENCIAL" | "WHATSAPP" | "EMAIL";

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface ExameCatalogo {
  id: number;
  company_id: string;
  ds_exame: string;
  ds_sigla: string;
  cd_tuss?: string | null;
  cd_loinc?: string | null;
  ds_categoria?: string | null;
  ds_metodo?: string | null;
  ds_material?: string | null;
  nr_prazo_dias: number;
  vl_particular?: number | null;
  vl_convenio?: number | null;
  lg_ativo: boolean;
  cd_origem_sigh?: number | null;
  created_at: string;
  updated_at: string;
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const normalized = typeof value === "string"
    ? value.trim().replace(",", ".")
    : value;
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeExameCatalogo(row: Record<string, unknown>): ExameCatalogo {
  return {
    ...(row as unknown as ExameCatalogo),
    nr_prazo_dias: normalizeNullableNumber(row.nr_prazo_dias) ?? 0,
    vl_particular: normalizeNullableNumber(row.vl_particular),
    vl_convenio: normalizeNullableNumber(row.vl_convenio),
  };
}

function normalizeValorReferencia(row: Record<string, unknown>): ValorReferencia {
  return {
    ...(row as unknown as ValorReferencia),
    vl_minimo: normalizeNullableNumber(row.vl_minimo),
    vl_maximo: normalizeNullableNumber(row.vl_maximo),
    nr_idade_min: normalizeNullableNumber(row.nr_idade_min) ?? 0,
    nr_idade_max: normalizeNullableNumber(row.nr_idade_max) ?? 120,
  };
}

function normalizeResultadoLab(row: Record<string, unknown>): ResultadoLab {
  return {
    ...(row as unknown as ResultadoLab),
    vl_resultado: normalizeNullableNumber(row.vl_resultado),
    vl_minimo_referencia: normalizeNullableNumber(row.vl_minimo_referencia),
    vl_maximo_referencia: normalizeNullableNumber(row.vl_maximo_referencia),
  };
}

function normalizeAlertaCritico(row: Record<string, unknown>): AlertaCritico {
  return {
    ...(row as unknown as AlertaCritico),
    vl_resultado: normalizeNullableNumber(row.vl_resultado),
  };
}

function makeOperationId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("Gerador seguro de identificador indisponível");
  }
  return globalThis.crypto.randomUUID();
}

export interface LisMutationOptions {
  operationId?: string;
}

function resolveOperationId(options: LisMutationOptions = {}): string {
  if (options.operationId === undefined) return makeOperationId();

  const operationId = options.operationId.trim();
  if (!operationId) {
    throw new Error("Identificador da operação não pode ser vazio");
  }
  return operationId;
}

function omitClientResultClassification(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const serverClassifiedValue = { ...value };
  delete serverClassifiedValue.tp_resultado;
  return serverClassifiedValue;
}

function asRecord(value: unknown, operation: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Resposta inválida da operação ${operation}`);
  }
  return value as Record<string, unknown>;
}

export interface ValorReferencia {
  id: number;
  company_id?: string;
  cd_exame: number;
  ds_parametro: string;
  vl_minimo?: number | null;
  vl_maximo?: number | null;
  ds_unidade?: string | null;
  cd_sexo?: "M" | "F" | "A" | null;
  nr_idade_min: number;
  nr_idade_max: number;
  lg_ativo: boolean;
  created_at: string;
}

export interface PedidoLab {
  id: number;
  company_id: string;
  cd_paciente: number;
  cd_medico: number;
  cd_appointment?: number | null;
  dt_pedido: string;
  cd_tipo_atendimento: LabTipoAtendimento;
  tp_prioridade: LabPrioridade;
  ds_hipotese_diagnostica?: string | null;
  ds_observacoes?: string | null;
  tp_status: LabPedidoStatus;
  dt_coleta?: string | null;
  dt_liberacao?: string | null;
  cd_lab_externo?: string | null;
  nr_protocolo_lab?: string | null;
  cd_origem_sigh?: number | null;
  created_at: string;
  // Joins
  paciente_nome?: string;
  medico_nome?: string;
  itens_count?: number;
}

export interface PedidoItem {
  id: number;
  cd_pedido: number;
  cd_exame: number;
  tp_status: LabPedidoStatus;
  dt_coleta?: string | null;
  dt_liberacao?: string | null;
  ds_amostra_id?: string | null;
  ds_observacao?: string | null;
  created_at: string;
  // Joins
  exame_sigla?: string;
  exame_nome?: string;
}

export interface ResultadoLab {
  id: number;
  company_id?: string;
  cd_item_pedido: number;
  cd_valor_referencia?: number | null;
  ds_parametro: string;
  vl_resultado?: number | null;
  vl_resultado_texto?: string | null;
  ds_unidade?: string | null;
  vl_minimo_referencia?: number | null;
  vl_maximo_referencia?: number | null;
  tp_resultado?: LabResultadoTipo | null;
  dt_resultado: string;
  cd_equipamento?: string | null;
  cd_lote_reagente?: string | null;
  cd_usuario_laboratorio?: string | null;
  ds_observacao?: string | null;
  ds_hl7_message?: string | null;
  created_at: string;
}

export interface AlertaCritico {
  id: number;
  cd_resultado: number;
  cd_paciente: number;
  cd_medico: number;
  dt_alerta: string;
  tp_alerta: AlertaTipo;
  ds_parametro?: string | null;
  vl_resultado?: number | null;
  vl_referencia?: string | null;
  tp_status?: "PENDENTE" | "COMUNICADO" | "RESOLVIDO";
  lg_comunicado: boolean;
  dt_comunicacao?: string | null;
  cd_usuario_comunicou?: string | null;
  ds_forma_comunicacao?: string | null;
  dt_resolucao?: string | null;
  ds_motivo_resolucao?: string | null;
  created_at: string;
  // Joins
  paciente_nome?: string;
  medico_nome?: string;
  resultado?: ResultadoLab | null;
}

export interface CatalogoFilters {
  categoria?: LabExamCategoria;
  material?: LabMaterial;
  search?: string;
  ativo?: boolean;
}

export interface PedidoFilters {
  tp_status?: LabPedidoStatus | LabPedidoStatus[];
  cd_paciente?: number;
  cd_medico?: number;
  dt_inicio?: string;
  dt_fim?: string;
  tp_prioridade?: LabPrioridade;
}

export interface RelatorioLab {
  total_pedidos: number;
  total_exames: number;
  por_status: Record<LabPedidoStatus, number>;
  por_categoria: Record<string, number>;
  total_alertas_criticos: number;
  alertas_pendentes: number;
  tempo_medio_liberacao_horas: number;
  exames_mais_solicitados: Array<{ sigla: string; nome: string; count: number }>;
}

// ── HL7 Parser ───────────────────────────────────────────────────────────────

export interface HL7ParsedField {
  field_name: string;
  field_value: string;
}

export interface HL7OBX {
  set_id: string;
  value_type: string;
  code: string;
  description: string;
  value: string;
  units: string;
  reference_range: string;
  abnormal_flag: string;
}

export interface HL7PID {
  name: string;
  dob: string;
  sex: string;
}

export interface HL7ORU {
  obx_list: HL7OBX[];
  pid: HL7PID | null;
  obr_id: string | null;
  obr_exame: string | null;
  msg_datetime: string | null;
}

/**
 * Faz parse de uma mensagem HL7 v2.5 ORU^R01.
 * Retorna estrutura tipada com OBX, PID, OBR e MSH.
 */
export function parseHL7(message: string): HL7ORU {
  const result: HL7ORU = {
    obx_list: [],
    pid: null,
    obr_id: null,
    obr_exame: null,
    msg_datetime: null,
  };

  if (!message || message.length === 0) return result;

  // HL7 v2.5 usa \r como separador de segmento (também aceita \n para tolerância)
  const segments = message.split(/\r\n|\r|\n/);

  for (const segment of segments) {
    if (!segment) continue;
    const fields = segment.split("|");
    const segType = fields[0];

    if (segType === "OBX") {
      // OBX|1|NM|GLUCOSE^Glicose^L|||70-99|mg/dL|||F
      result.obx_list.push({
        set_id: fields[1] ?? "",
        value_type: fields[2] ?? "",
        code: fields[3]?.split("^")[0] ?? "",
        description: fields[3]?.split("^")[1] ?? fields[3] ?? "",
        value: fields[5] ?? "",
        units: fields[6] ?? "",
        reference_range: fields[7] ?? "",
        abnormal_flag: fields[8] ?? "",
      });
    } else if (segType === "PID") {
      const nameField = fields[5] ?? "";
      // HL7 XPN: LastName^FirstName^MiddleName^Suffix^Prefix
      // Output format: "FirstName MiddleName LastName"
      const nameParts = nameField.split("^");
      const last = nameParts[0] ?? "";
      const first = nameParts[1] ?? "";
      const middle = nameParts[2] ?? "";
      const composed = [first, middle, last].filter(Boolean).join(" ").trim();
      result.pid = {
        name: composed || nameField,
        dob: formatHL7Date(fields[7] ?? ""),
        sex: fields[8] ?? "",
      };
    } else if (segType === "OBR") {
      result.obr_id = fields[3] ?? null;
      result.obr_exame = fields[4]?.split("^")[1] ?? fields[4] ?? null;
    } else if (segType === "MSH") {
      result.msg_datetime = formatHL7DateTime(fields[6] ?? "");
    }
  }

  return result;
}

function formatHL7Date(raw: string): string {
  // HL7 date: YYYYMMDD → YYYY-MM-DD
  if (raw.length < 8) return raw;
  return `${raw.substring(0, 4)}-${raw.substring(4, 6)}-${raw.substring(6, 8)}`;
}

function formatHL7DateTime(raw: string): string {
  if (raw.length < 8) return raw;
  const date = formatHL7Date(raw.substring(0, 8));
  const time = raw.length >= 12 ? ` ${raw.substring(8, 10)}:${raw.substring(10, 12)}` : "";
  return `${date}${time}`;
}

// ── Classificador de Resultados ──────────────────────────────────────────────

/**
 * Classifica um resultado numérico com base nos valores de referência.
 * Replica a função SQL classificar_resultado_lab para uso no front.
 */
export function classificar(
  valor: number | null | undefined,
  minimo: number | null | undefined,
  maximo: number | null | undefined,
): LabResultadoTipo {
  if (valor === null || valor === undefined || (minimo == null && maximo == null)) {
    return "INCONCLUSIVO";
  }

  const v = Number(valor);
  if (Number.isNaN(v)) return "INCONCLUSIVO";

  if (minimo !== null && minimo !== undefined && v < minimo * 0.5) {
    return "CRITICO_BAIXO";
  }
  if (maximo !== null && maximo !== undefined && v > maximo * 1.5) {
    return "CRITICO_ALTO";
  }
  if (minimo !== null && minimo !== undefined && v < minimo) {
    return "BAIXO";
  }
  if (maximo !== null && maximo !== undefined && v > maximo) {
    return "ALTO";
  }
  return "NORMAL";
}

// ── Catálogo ─────────────────────────────────────────────────────────────────

export const catalogo = {
  async getAll(companyId: string, filters: CatalogoFilters = {}): Promise<ExameCatalogo[]> {
    let q = supabase
      .from("exames_lab_catalogo")
      .select("*")
      .eq("company_id", companyId)
      .order("ds_categoria", { ascending: true })
      .order("ds_exame", { ascending: true });

    if (filters.categoria) q = q.eq("ds_categoria", filters.categoria);
    if (filters.material) q = q.eq("ds_material", filters.material);
    if (filters.ativo !== undefined) q = q.eq("lg_ativo", filters.ativo);
    if (filters.search) {
      q = q.or(
        `ds_exame.ilike.%${filters.search}%,ds_sigla.ilike.%${filters.search}%,cd_tuss.ilike.%${filters.search}%`,
      );
    }

    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map((row) =>
      normalizeExameCatalogo(row as Record<string, unknown>),
    );
  },

  async getById(id: number): Promise<ExameCatalogo | null> {
    const { data, error } = await supabase
      .from("exames_lab_catalogo")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data
      ? normalizeExameCatalogo(data as Record<string, unknown>)
      : null;
  },

  async create(input: Omit<ExameCatalogo, "id" | "created_at" | "updated_at">): Promise<ExameCatalogo> {
    const { data, error } = await supabase.rpc("m23_upsert_exam_catalog_secure", {
      p_exam: input,
    });
    if (error) throw error;
    return normalizeExameCatalogo(asRecord(data, "m23_upsert_exam_catalog_secure"));
  },

  async update(id: number, patch: Partial<ExameCatalogo>): Promise<ExameCatalogo> {
    const { data, error } = await supabase.rpc("m23_upsert_exam_catalog_secure", {
      p_exam: { ...patch, id },
    });
    if (error) throw error;
    return normalizeExameCatalogo(asRecord(data, "m23_upsert_exam_catalog_secure"));
  },

  async inactivate(id: number): Promise<void> {
    const { error } = await supabase.rpc("m23_upsert_exam_catalog_secure", {
      p_exam: { id, lg_ativo: false },
    });
    if (error) throw error;
  },
};

// ── Valores de Referência ────────────────────────────────────────────────────

export const valorReferencia = {
  async getByExame(cdExame: number): Promise<ValorReferencia[]> {
    const { data, error } = await supabase
      .from("exames_lab_valor_referencia")
      .select("*")
      .eq("cd_exame", cdExame)
      .eq("lg_ativo", true)
      .order("ds_parametro");
    if (error) throw error;
    return (data || []).map((row) =>
      normalizeValorReferencia(row as Record<string, unknown>),
    );
  },

  async create(input: Omit<ValorReferencia, "id" | "created_at">): Promise<ValorReferencia> {
    const { data, error } = await supabase.rpc("m23_upsert_reference_range_secure", {
      p_reference: input,
    });
    if (error) throw error;
    return normalizeValorReferencia(
      asRecord(data, "m23_upsert_reference_range_secure"),
    );
  },
};

// ── Pedidos ──────────────────────────────────────────────────────────────────

export const pedido = {
  async listar(companyId: string, filters: PedidoFilters = {}): Promise<PedidoLab[]> {
    let q = supabase
      .from("exames_lab_pedido")
      .select(
        `*,
        paciente:patients!lab_order_company_patient_fk(full_name),
        medico:professionals!lab_order_company_professional_fk(full_name),
        itens:exames_lab_pedido_itens!lab_item_company_order_fk(count)`,
      )
      .eq("company_id", companyId)
      .order("dt_pedido", { ascending: false });

    if (filters.tp_status) {
      if (Array.isArray(filters.tp_status)) {
        q = q.in("tp_status", filters.tp_status);
      } else {
        q = q.eq("tp_status", filters.tp_status);
      }
    }
    if (filters.cd_paciente) q = q.eq("cd_paciente", filters.cd_paciente);
    if (filters.cd_medico) q = q.eq("cd_medico", filters.cd_medico);
    if (filters.tp_prioridade) q = q.eq("tp_prioridade", filters.tp_prioridade);
    if (filters.dt_inicio) q = q.gte("dt_pedido", filters.dt_inicio);
    if (filters.dt_fim) q = q.lte("dt_pedido", filters.dt_fim);

    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map((row: Record<string, unknown>) => {
      const paciente = row.paciente as { full_name?: string } | null;
      const medico = row.medico as { full_name?: string } | null;
      const itens = row.itens as Array<{ count: number }> | null;
      return {
        ...(row as unknown as PedidoLab),
        paciente_nome: paciente?.full_name,
        medico_nome: medico?.full_name,
        itens_count: itens?.[0]?.count ?? 0,
      };
    });
  },

  async getById(id: number): Promise<{
    pedido: PedidoLab;
    itens: Array<PedidoItem & { resultados: ResultadoLab[] }>;
  } | null> {
    const { data: p, error: e1 } = await supabase
      .from("exames_lab_pedido")
      .select(
        `*,
        paciente:patients!lab_order_company_patient_fk(full_name, birth_date, sex),
        medico:professionals!lab_order_company_professional_fk(full_name)`,
      )
      .eq("id", id)
      .maybeSingle();
    if (e1) throw e1;
    if (!p) return null;

    const { data: itens, error: e2 } = await supabase
      .from("exames_lab_pedido_itens")
      .select(
        `*,
        exame:exames_lab_catalogo!lab_item_company_exam_fk(ds_sigla, ds_exame),
        resultados:exames_lab_resultado!lab_result_company_item_fk(*)`,
      )
      .eq("cd_pedido", id);
    if (e2) throw e2;

    return {
      pedido: p as PedidoLab,
      itens: (itens || []).map((it: Record<string, unknown>) => {
        const exame = it.exame as { ds_sigla?: string; ds_exame?: string } | null;
        return {
          ...(it as unknown as PedidoItem),
          exame_sigla: exame?.ds_sigla,
          exame_nome: exame?.ds_exame,
          resultados: Array.isArray(it.resultados)
            ? it.resultados.map((row) =>
              normalizeResultadoLab(row as Record<string, unknown>),
            )
            : [],
        };
      }),
    };
  },

  async create(input: {
    company_id: string;
    cd_paciente: number;
    cd_medico: number;
    cd_appointment?: number;
    cd_tipo_atendimento?: LabTipoAtendimento;
    tp_prioridade?: LabPrioridade;
    ds_hipotese_diagnostica?: string;
    ds_observacoes?: string;
    cd_lab_externo?: string;
    itens: Array<{ cd_exame: number; ds_observacao?: string }>;
  }, options: LisMutationOptions = {}): Promise<{ pedido_id: number; itens_ids: number[] }> {
    if (!input.itens || input.itens.length === 0) {
      throw new Error("Pedido deve conter ao menos um exame");
    }

    const { itens, ...orderInput } = input;
    const { data, error } = await supabase.rpc("m23_create_lab_order_secure", {
      p_operation_id: resolveOperationId(options),
      p_order: {
        ...orderInput,
        cd_tipo_atendimento: input.cd_tipo_atendimento ?? "AMBULATORIAL",
        tp_prioridade: input.tp_prioridade ?? "ROTINA",
      },
      p_items: itens,
    });
    if (error) throw error;

    const result = asRecord(data, "m23_create_lab_order_secure");
    const pedidoId = Number(result.pedido_id);
    const itensIds = Array.isArray(result.itens_ids)
      ? result.itens_ids.map(Number).filter(Number.isFinite)
      : [];
    if (!Number.isFinite(pedidoId) || itensIds.length !== itens.length) {
      throw new Error("Resposta inválida ao criar pedido laboratorial");
    }
    return { pedido_id: pedidoId, itens_ids: itensIds };
  },

  async atualizarStatus(
    id: number,
    status: LabPedidoStatus,
    opts: { dt_coleta?: string; dt_liberacao?: string } = {},
  ): Promise<void> {
    void opts;
    const rpcName = status === "ENTREGUE"
      ? "m23_deliver_order_secure"
      : "m23_transition_specimen_secure";
    const rpcArgs = status === "ENTREGUE"
      ? { p_order_id: id }
      : { p_order_id: id, p_status: status };
    const { error } = await supabase.rpc(rpcName, rpcArgs);
    if (error) throw error;
  },

  async marcarColetado(itemId: number, amostraId: string): Promise<void> {
    const normalizedSampleId = amostraId.trim();
    if (!normalizedSampleId) {
      throw new Error("Identificador da amostra é obrigatório");
    }
    const { error } = await supabase.rpc("m23_collect_specimen_secure", {
      p_item_id: itemId,
      p_sample_id: normalizedSampleId,
    });
    if (error) throw error;
  },
};

// ── Resultados ───────────────────────────────────────────────────────────────

export const resultado = {
  async inserir(
    input: Omit<
      ResultadoLab,
      "id" | "created_at" | "dt_resultado" | "tp_resultado"
    > & { id?: number; dt_resultado?: string },
    options: LisMutationOptions = {},
  ): Promise<ResultadoLab> {
    const payload = omitClientResultClassification({
      ...input,
      dt_resultado: input.dt_resultado ?? new Date().toISOString(),
    } as Record<string, unknown>);
    const { data, error } = await supabase.rpc("m23_record_results_secure", {
      p_item_id: input.cd_item_pedido,
      p_results: [payload],
      p_operation_id: resolveOperationId(options),
    });
    if (error) throw error;
    if (!Array.isArray(data) || !data[0]) {
      throw new Error("Resposta inválida ao registrar resultado laboratorial");
    }
    return normalizeResultadoLab(data[0] as Record<string, unknown>);
  },

  async inserirLote(
    cdItemPedido: number,
    parametros: Array<{
      id?: number;
      ds_parametro: string;
      vl_resultado: number | null;
      vl_resultado_texto?: string | null;
      ds_unidade?: string;
      vl_minimo_referencia?: number | null;
      vl_maximo_referencia?: number | null;
      cd_equipamento?: string | null;
      cd_lote_reagente?: string | null;
      cd_usuario_laboratorio?: string | null;
      ds_observacao?: string;
      ds_hl7_message?: string | null;
    }>,
    options: LisMutationOptions = {},
  ): Promise<ResultadoLab[]> {
    if (parametros.length === 0) return [];

    const rows = parametros.map((p) => ({
      ...(p.id !== undefined ? { id: p.id } : {}),
      ds_parametro: p.ds_parametro,
      vl_resultado: p.vl_resultado,
      vl_resultado_texto: p.vl_resultado_texto ?? null,
      ds_unidade: p.ds_unidade,
      vl_minimo_referencia: p.vl_minimo_referencia ?? null,
      vl_maximo_referencia: p.vl_maximo_referencia ?? null,
      cd_equipamento: p.cd_equipamento ?? null,
      cd_lote_reagente: p.cd_lote_reagente ?? null,
      cd_usuario_laboratorio: p.cd_usuario_laboratorio ?? null,
      ds_observacao: p.ds_observacao,
      ds_hl7_message: p.ds_hl7_message ?? null,
    }));

    const { data, error } = await supabase.rpc("m23_record_results_secure", {
      p_item_id: cdItemPedido,
      p_results: rows,
      p_operation_id: resolveOperationId(options),
    });
    if (error) throw error;
    if (!Array.isArray(data)) {
      throw new Error("Resposta inválida ao registrar resultados laboratoriais");
    }
    return data.map((row) =>
      normalizeResultadoLab(row as Record<string, unknown>),
    );
  },

  async listarPorItem(cdItemPedido: number): Promise<ResultadoLab[]> {
    const { data, error } = await supabase
      .from("exames_lab_resultado")
      .select("*")
      .eq("cd_item_pedido", cdItemPedido)
      .order("ds_parametro");
    if (error) throw error;
    return (data || []).map((row) =>
      normalizeResultadoLab(row as Record<string, unknown>),
    );
  },

  async liberarItem(itemId: number): Promise<void> {
    const { error } = await supabase.rpc("m23_validate_result_secure", {
      p_item_id: itemId,
    });
    if (error) throw error;
  },
};

// ── Alertas Críticos ─────────────────────────────────────────────────────────

export const alerta = {
  async listarPendentes(companyId?: string): Promise<AlertaCritico[]> {
    let q = supabase
      .from("exames_lab_alerta_critico")
      .select(
        `*,
        resultado:exames_lab_resultado!lab_alert_company_result_fk(*),
        paciente:patients!lab_alert_company_patient_fk(full_name),
        medico:professionals!lab_alert_company_professional_fk(full_name)`,
      )
      .eq("tp_status", "PENDENTE")
      .eq("lg_comunicado", false)
      .order("dt_alerta", { ascending: false });
    if (companyId) {
      q = q.eq("company_id", companyId);
    }
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map((row: Record<string, unknown>) => {
      const paciente = row.paciente as { full_name?: string } | null;
      const medico = row.medico as { full_name?: string } | null;
      const resultado = row.resultado;
      return {
        ...normalizeAlertaCritico(row),
        paciente_nome: paciente?.full_name,
        medico_nome: medico?.full_name,
        resultado: resultado && typeof resultado === "object" && !Array.isArray(resultado)
          ? normalizeResultadoLab(resultado as Record<string, unknown>)
          : null,
      };
    });
  },

  async comunicar(
    id: number,
    forma: FormaComunicacao,
    _usuarioId: string,
  ): Promise<void> {
    const { error } = await supabase.rpc("m23_acknowledge_critical_alert_secure", {
      p_alert_id: id,
      p_channel: forma,
    });
    if (error) throw error;
  },

  async listarPorPaciente(cdPaciente: number): Promise<AlertaCritico[]> {
    const { data, error } = await supabase
      .from("exames_lab_alerta_critico")
      .select("*")
      .eq("cd_paciente", cdPaciente)
      .order("dt_alerta", { ascending: false });
    if (error) throw error;
    return (data || []).map((row) =>
      normalizeAlertaCritico(row as Record<string, unknown>),
    );
  },
};

// ── Relatório / Estatísticas ─────────────────────────────────────────────────

export async function getRelatorio(
  companyId: string,
  periodo: { dt_inicio: string; dt_fim: string },
): Promise<RelatorioLab> {
  // Pedidos no período
  const { data: pedidos, error: e1 } = await supabase
    .from("exames_lab_pedido")
    .select("id, tp_status, dt_pedido, dt_liberacao")
    .eq("company_id", companyId)
    .gte("dt_pedido", periodo.dt_inicio)
    .lte("dt_pedido", periodo.dt_fim);
  if (e1) throw e1;

  const total_pedidos = pedidos?.length ?? 0;
  const por_status: Record<LabPedidoStatus, number> = {
    PENDENTE: 0,
    COLETADO: 0,
    EM_ANALISE: 0,
    LIBERADO: 0,
    ENTREGUE: 0,
    CANCELADO: 0,
  };
  let tempoTotalHoras = 0;
  let liberadosCount = 0;
  for (const p of pedidos || []) {
    if (p.tp_status in por_status) {
      por_status[p.tp_status as LabPedidoStatus]++;
    }
    if (p.tp_status === "LIBERADO" && p.dt_liberacao) {
      const diff = (new Date(p.dt_liberacao).getTime() - new Date(p.dt_pedido).getTime()) / 3600000;
      tempoTotalHoras += diff;
      liberadosCount++;
    }
  }

  // Itens e categorias
  const { data: itens } = await supabase
    .from("exames_lab_pedido_itens")
    .select(`cd_exame, exame:exames_lab_catalogo!lab_item_company_exam_fk(ds_sigla, ds_exame, ds_categoria)`)
    .in("cd_pedido", (pedidos || []).map((p) => p.id));
  const total_exames = itens?.length ?? 0;

  const por_categoria: Record<string, number> = {};
  const contagem: Record<string, { sigla: string; nome: string; count: number }> = {};
  for (const it of itens || []) {
    const ex = it.exame as { ds_sigla?: string; ds_exame?: string; ds_categoria?: string } | null;
    if (ex?.ds_categoria) {
      por_categoria[ex.ds_categoria] = (por_categoria[ex.ds_categoria] || 0) + 1;
    }
    if (ex?.ds_sigla) {
      if (!contagem[ex.ds_sigla]) {
        contagem[ex.ds_sigla] = { sigla: ex.ds_sigla, nome: ex.ds_exame || "", count: 0 };
      }
      contagem[ex.ds_sigla].count++;
    }
  }
  const exames_mais_solicitados = Object.values(contagem)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Alertas
  const { count: totalAlertas } = await supabase
    .from("exames_lab_alerta_critico")
    .select("id", { count: "exact", head: true });
  const { count: pendentes } = await supabase
    .from("exames_lab_alerta_critico")
    .select("id", { count: "exact", head: true })
    .eq("tp_status", "PENDENTE")
    .eq("lg_comunicado", false);

  return {
    total_pedidos,
    total_exames,
    por_status,
    por_categoria,
    total_alertas_criticos: totalAlertas ?? 0,
    alertas_pendentes: pendentes ?? 0,
    tempo_medio_liberacao_horas:
      liberadosCount > 0 ? Math.round((tempoTotalHoras / liberadosCount) * 10) / 10 : 0,
    exames_mais_solicitados,
  };
}

// ── Workflow de status (validação de transições) ────────────────────────────

const WORKFLOW_PEDIDO: Record<LabPedidoStatus, LabPedidoStatus[]> = {
  PENDENTE: ["COLETADO", "CANCELADO"],
  COLETADO: ["EM_ANALISE", "CANCELADO"],
  EM_ANALISE: ["LIBERADO", "CANCELADO"],
  LIBERADO: ["ENTREGUE"],
  ENTREGUE: [],
  CANCELADO: [],
};

export function canTransition(from: LabPedidoStatus, to: LabPedidoStatus): boolean {
  return WORKFLOW_PEDIDO[from]?.includes(to) ?? false;
}

export const LAB_STATUS_OPTIONS: LabPedidoStatus[] = [
  "PENDENTE",
  "COLETADO",
  "EM_ANALISE",
  "LIBERADO",
  "ENTREGUE",
  "CANCELADO",
];

export const LAB_CATEGORIAS: LabExamCategoria[] = [
  "HEMATOLOGIA",
  "BIOQUIMICA",
  "URINALISE",
  "COAGULACAO",
  "IMUNOLOGIA",
  "SOROLOGIA",
  "CULTURA",
  "HORMONIO",
  "PARASITOLOGIA",
  "OUTROS",
];

export const LAB_MATERIAIS: LabMaterial[] = [
  "SANGUE",
  "URINA",
  "FEZES",
  "SWAB",
  "LIQUOR",
  "OUTROS",
];
