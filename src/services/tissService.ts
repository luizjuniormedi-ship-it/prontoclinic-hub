/**
 * tissService — Módulo TISS/XML (faturamento eletrônico de convênios)
 *
 * Espelha o modelo SIGH (Sistema Integrado de Gestão Hospitalar):
 *   - xml (544)              → public.tiss_xml
 *   - xml_pagamentos         → campos dt_pagamento / vl_pagamento em tiss_xml
 *   - recurso_de_glosa       → public.tiss_glosas
 *   - BPA / SUS              → futuro (todas vazias no SIGH)
 *
 * Padrão TISS da ANS (Agência Nacional de Saúde Suplementar)
 *   - Versão atual: 3.05.00
 *   - Componentes: comunicacaoBeneficiario, solicitacaoProcedimento,
 *     demonstrativoAnaliseConta, demonstrativoPagamento, recursoGlosa
 *   - Schema XSD: https://www.gov.br/ans/pt-br/assuntos/prestadores/
 *     tiss-padrao-para-intercambio-de-informacao-de-saude-suplementar
 *
 * Migration relacionada: 20260101000010_tiss.sql
 */

import { supabase } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────

export type TissStatus =
  | "PENDENTE"
  | "ENVIADO"
  | "PROCESSADO"
  | "GLOSADO"
  | "RECEBIDO"
  | "PAGO"
  | "CANCELADO"
  | "REJEITADO";

export type TissTipoGuia =
  | "CONSULTA"
  | "SP/SADT"
  | "INTERNACAO"
  | "HONORARIO"
  | "ODONTOLOGIA"
  | "AUXILIAR";

export type TissAmbiente = "HOMOLOGACAO" | "PRODUCAO";

export type GlosaStatus = "PENDENTE" | "ENVIADO" | "DEFERIDO" | "INDEFERIDO" | "PARCIAL";

export interface TissXml {
  id: number;
  cd_fatura?: number;
  cd_convenio?: number;
  ds_descricao?: string;
  ds_filename?: string;
  dt_fatura?: string;
  ds_tipo_guia?: TissTipoGuia;
  cd_lote?: number;
  ds_protocolo?: string;
  dt_recurso?: string;
  ds_protocolo_recurso?: string;
  vl_informado?: number;
  vl_processado?: number;
  vl_liberado?: number;
  vl_glosa?: number;
  ds_versao_tiss: string;
  tp_ambiente: TissAmbiente;
  status: TissStatus;
  ds_motivo_rejeicao?: string;
  lg_deletado: boolean;
  dt_envio?: string;
  dt_retorno?: string;
  dt_pagamento?: string;
  created_at: string;
  updated_at: string;
}

export interface TissReadModel {
  tiss_xml_id: number;
  billing_id: number | null;
  appointment_id: number | null;
  patient_id: number | null;
  insurance_plan_id: number | null;
  insurance_company_id: number | null;
  insurance_company_name: string | null;
  insurance_plan_name: string | null;
  billing_amount: number | null;
  tiss_created_at: string;
}

interface TissReadModelRow extends Omit<TissReadModel, "billing_amount"> {
  billing_amount: number | string | null;
}

export const TISS_XML_METADATA_COLUMNS =
  "id, cd_fatura, cd_convenio, ds_descricao, ds_filename, dt_fatura, ds_tipo_guia, cd_lote, ds_protocolo, dt_recurso, ds_protocolo_recurso, vl_informado, vl_processado, vl_liberado, vl_glosa, ds_versao_tiss, tp_ambiente, status, ds_motivo_rejeicao, lg_deletado, dt_envio, dt_retorno, dt_pagamento, created_at, updated_at";

export interface TissGlosa {
  id: number;
  cd_tiss_xml: number;
  cd_glosa_code?: string;
  ds_motivo?: string;
  vl_glosa: number;
  dt_glosa: string;
  lg_recurso_enviado: boolean;
  dt_recurso?: string;
  ds_protocolo_recurso?: string;
  ds_status_recurso: GlosaStatus;
  cd_procedimento_tuss?: string;
  cd_executante?: string;
  created_at: string;
  updated_at: string;
}

const TISS_GLOSA_METADATA_COLUMNS =
  "id, cd_tiss_xml, cd_glosa_code, ds_motivo, vl_glosa, dt_glosa, lg_recurso_enviado, dt_recurso, ds_protocolo_recurso, ds_status_recurso, cd_procedimento_tuss, cd_executante, created_at, updated_at";

export interface TissProtocol {
  id: number;
  cd_convenio: number;
  ds_versao_tiss: string;
  tp_ambiente: TissAmbiente;
  lg_active: boolean;
  ds_observacao?: string;
  dt_ultimo_teste?: string;
  ds_status_teste?: string;
  created_at: string;
  updated_at: string;
}

const TISS_PROTOCOL_METADATA_COLUMNS =
  "id, cd_convenio, ds_versao_tiss, tp_ambiente, lg_active, ds_observacao, dt_ultimo_teste, ds_status_teste, created_at, updated_at";

interface TissXmlRecursoRelation {
  cd_convenio?: number;
  ds_protocolo?: string;
  dt_fatura?: string;
  vl_glosa?: number;
}

function firstRelated<T>(relation: T | T[] | null | undefined): T | undefined {
  return Array.isArray(relation) ? relation[0] : relation ?? undefined;
}

// ── Códigos TISS (tabela oficial ANS, subset) ──────────────────────

export const TISS_GLOSA_CODES: Array<{ codigo: string; descricao: string }> = [
  { codigo: "7101", descricao: "Procedimento nao coberto" },
  { codigo: "7102", descricao: "Procedimento nao autorizado" },
  { codigo: "7103", descricao: "Identificacao do beneficiario invalida" },
  { codigo: "7104", descricao: "Carater de internacao invalido" },
  { codigo: "7105", descricao: "Data de realizacao do procedimento invalida" },
  { codigo: "7106", descricao: "Quantidade de procedimentos invalida" },
  { codigo: "7107", descricao: "Valor do procedimento invalido" },
  { codigo: "7108", descricao: "Procedimento sem cobertura para a especialidade" },
  { codigo: "7109", descricao: "Procedimento nao contratado" },
  { codigo: "7110", descricao: "Carater de atendimento nao contratado" },
  { codigo: "7111", descricao: "Procedimento exige autorizacao previa" },
  { codigo: "7112", descricao: "Procedimento excede quantidade contratada" },
  { codigo: "7113", descricao: "Procedimento fora do periodo de cobertura" },
  { codigo: "7114", descricao: "Idade do beneficiario incompativel" },
  { codigo: "7115", descricao: "Carater de internacao incompativel" },
  { codigo: "7116", descricao: "Procedimento nao pertence ao profissional" },
  { codigo: "7117", descricao: "Numero de dias de internacao excedido" },
  { codigo: "7118", descricao: "Numero de diarias excedido" },
  { codigo: "7119", descricao: "Material/medicamento nao autorizado" },
  { codigo: "7120", descricao: "Taxa nao contratada" },
  { codigo: "7121", descricao: "Gas medicinal nao contratado" },
  { codigo: "7122", descricao: "OPME nao autorizado" },
  { codigo: "7123", descricao: "Valor de OPME excede contrato" },
  { codigo: "7124", descricao: "Honorario excede tabela" },
  { codigo: "7125", descricao: "Acomodacao incompativel" },
  { codigo: "7126", descricao: "Tipo de parto incompativel" },
  { codigo: "7127", descricao: "Codigo TUSS invalido" },
  { codigo: "7128", descricao: "CID incompativel" },
  { codigo: "7129", descricao: "Documentacao incompleta" },
  { codigo: "7130", descricao: "Guia sem numero de autorizacao" },
];

// ── Helpers ────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isoToTissDate(iso?: string): string {
  if (!iso) return new Date().toISOString().substring(0, 10);
  return iso.substring(0, 10);
}

function isoToTissDateTime(iso?: string): string {
  if (!iso) return new Date().toISOString();
  return iso;
}

// ── Service ────────────────────────────────────────────────────────

export const tissService = {
  // ── CRUD de XMLs ───────────────────────────────────────────────

  async listFaturas(filters?: {
    mes?: number;
    ano?: number;
    insurance_company_id?: number;
  }): Promise<TissReadModel[]> {
    const { data, error } = await supabase.rpc("list_tiss_read_model_secure", {
      p_year: filters?.ano ?? null,
      p_month: filters?.mes ?? null,
      p_insurance_company_id: filters?.insurance_company_id ?? null,
    });
    if (error) throw error;
    return ((data || []) as TissReadModelRow[]).map((row) => ({
      tiss_xml_id: row.tiss_xml_id,
      billing_id: row.billing_id,
      appointment_id: row.appointment_id,
      patient_id: row.patient_id,
      insurance_plan_id: row.insurance_plan_id,
      insurance_company_id: row.insurance_company_id,
      insurance_company_name: row.insurance_company_name,
      insurance_plan_name: row.insurance_plan_name,
      billing_amount: row.billing_amount === null ? null : Number(row.billing_amount),
      tiss_created_at: row.tiss_created_at,
    }));
  },

  async getById(id: number): Promise<TissXml> {
    const { data, error } = await supabase
      .from("tiss_xml")
      .select(TISS_XML_METADATA_COLUMNS)
      .eq("id", id)
      .single();
    if (error) throw error;
    return data as TissXml;
  },

  // ── Geracao do XML TISS ───────────────────────────────────────

  /**
   * Gera XML TISS 3.05 para um agendamento e seus procedimentos
   * Estrutura:
   *   <ans:mensagemTISS>
   *     <ans:cabecalho>...</ans:cabecalho>
   *     <ans:prestadorParaOperadora>
   *       <ans:loteGuias>
   *         <ans:guias>
   *           <ans:guiaConsulta>... OU <ans:guiaSP-SADT>...
   *         </ans:guias>
   *       </ans:loteGuias>
   *     </ans:prestadorParaOperadora>
   *   </ans:mensagemTISS>
   */
  async generateXML(
    appointmentId: number,
    codes: {
      tipoGuia: TissTipoGuia;
      cd_convenio: number;
      cd_paciente: number;
      cd_profissional: number;
      nr_carteira: string;
      cd_atendimento?: string;
      vl_total?: number;
      procedimentos: Array<{
        cd_tuss: string;
        ds_procedimento: string;
        qt: number;
        vl_unitario: number;
      }>;
    }
  ): Promise<{ xml: string; id: number; hash: string }> {
    void appointmentId;
    void codes;
    throw new Error("Geracao XML TISS bloqueada no navegador: operacao exige backend seguro e auditoria");
  },

  // ── Envio a Operadora ──────────────────────────────────────────

  /**
   * Envia o XML TISS para a operadora via webservice
   * Em homologacao: chama o endpoint configurado (VITE_TISS_ENDPOINT_<CONVENIO>)
   * Em producao: usa certificado A1 e assina o XML
   */
  async sendToOperadora(tissXmlId: number): Promise<{ sent: boolean; protocolo?: string; response?: unknown }> {
    void tissXmlId;
    throw new Error(
      "Transmissao TISS bloqueada: exige backend seguro com certificado A1, idempotencia e auditoria"
    );
  },

  // ── Processamento do retorno ───────────────────────────────────

  /**
   * Processa o XML de retorno da operadora
   * Extrai: protocolo, valores processados, glosas individuais
   */
  async processReturn(tissXmlId: number, returnXML: string): Promise<{
    protocolo: string;
    vl_processado: number;
    vl_liberado: number;
    vl_glosa: number;
    glosas: Array<{ codigo: string; motivo: string; valor: number }>;
  }> {
    void tissXmlId;
    void returnXML;
    throw new Error("Processamento de retorno TISS bloqueado no navegador: operacao exige backend seguro e auditoria");
  },

  // ── Registro manual de glosa ───────────────────────────────────

  async registrarGlosa(
    tissXmlId: number,
    motivo: string,
    valor: number,
    codigo?: string
  ): Promise<TissGlosa> {
    void tissXmlId;
    void motivo;
    void valor;
    void codigo;
    throw new Error("Registro de glosa TISS bloqueado no navegador: operacao exige backend seguro e auditoria");
  },

  async listGlosas(tissXmlId: number): Promise<TissGlosa[]> {
    const { data, error } = await supabase
      .from("tiss_glosas")
      .select(TISS_GLOSA_METADATA_COLUMNS)
      .eq("cd_tiss_xml", tissXmlId)
      .order("dt_glosa", { ascending: false });
    if (error) throw error;
    return (data || []) as TissGlosa[];
  },

  // ── Recurso de Glosa ───────────────────────────────────────────

  async enviarRecurso(glosaId: number, recursoXML: string): Promise<{ sent: boolean; protocolo?: string }> {
    void glosaId;
    void recursoXML;
    throw new Error("Envio de recurso TISS bloqueado no navegador: operacao exige backend seguro e auditoria");
  },

  async gerarXMLRecurso(glosaId: number): Promise<string> {
    const { data: glosa } = await supabase
      .from("tiss_glosas")
      .select("cd_glosa_code, ds_motivo, vl_glosa, tiss_xml(cd_convenio, ds_protocolo, dt_fatura, vl_glosa)")
      .eq("id", glosaId)
      .single();
    if (!glosa) throw new Error("Glosa nao encontrada");

    const tissXml = firstRelated<TissXmlRecursoRelation>(glosa.tiss_xml);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas" versao="3.05.00">
  <ans:cabecalho>
    <ans:identificacaoTransacao>
      <ans:tipoTransacao>ENVIO_RECURSO_GLOSA</ans:tipoTransacao>
      <ans:sequencialTransacao>${Date.now()}</ans:sequencialTransacao>
      <ans:dataRegistroTransacao>${new Date().toISOString()}</ans:dataRegistroTransacao>
    </ans:identificacaoTransacao>
  </ans:cabecalho>
  <ans:operadoraParaPrestador>
    <ans:recursoGlosa>
      <ans:protocoloGlosaOriginal>${xmlEscape(tissXml?.ds_protocolo || "")}</ans:protocoloGlosaOriginal>
      <ans:dataGlosaOriginal>${isoToTissDate(tissXml?.dt_fatura)}</ans:dataGlosaOriginal>
      <ans:codigoGlosa>${xmlEscape(glosa.cd_glosa_code || "")}</ans:codigoGlosa>
      <ans:motivoGlosa>${xmlEscape(glosa.ds_motivo || "")}</ans:motivoGlosa>
      <ans:valorGlosa>${glosa.vl_glosa.toFixed(2)}</ans:valorGlosa>
      <ans:justificativaPrestador>Recurso administrativo - solicitamos revisao da glosa com base na documentacao clinica anexa.</ans:justificativaPrestador>
    </ans:recursoGlosa>
  </ans:operadoraParaPrestador>
</ans:mensagemTISS>`;
    return xml;
  },

  // ── Geracao de Fatura Mensal ───────────────────────────────────

  /**
   * Fecha o mes e gera um lote de XMLs TISS para todos os atendimentos
   * cobertos por convenios que nao foram faturados ainda
   */
  async gerarFaturaMensal(
    mes: number,
    ano: number,
    companyId: string
  ): Promise<{ lote: number; total_xmls: number; vl_total: number }> {
    void mes;
    void ano;
    void companyId;
    throw new Error(
      "Geracao mensal TISS bloqueada: o fluxo legado nao possui contrato transacional seguro"
    );
  },

  // ── Estatisticas (dashboard) ───────────────────────────────────

  async getEstatisticas(
    companyId: string,
    year?: number
  ): Promise<{
    total_guias: number;
    total_enviado: number;
    total_processado: number;
    total_liberado: number;
    total_glosado: number;
    total_pago: number;
    taxa_glosa_percent: number;
    taxa_recebimento_percent: number;
    por_convenio: Array<{
      convenio: string;
      guias: number;
      informado: number;
      liberado: number;
      glosa: number;
      taxa_glosa: number;
    }>;
  }> {
    const { data, error } = await supabase.rpc("tiss_get_stats", {
      p_company_id: companyId,
      p_year: year || new Date().getFullYear(),
    });
    if (error) throw error;

    const stats = (data || []) as Array<{
      cd_convenio: number;
      convenio_name: string;
      total_guias: number;
      total_enviado: number;
      total_processado: number;
      total_liberado: number;
      total_glosado: number;
      total_pago: number;
      taxa_glosa_percent: number;
      taxa_recebimento_percent: number;
    }>;

    const tot = stats.reduce(
      (acc, r) => ({
        guias: acc.guias + Number(r.total_guias),
        informado: acc.informado + Number(r.total_enviado),
        processado: acc.processado + Number(r.total_processado),
        liberado: acc.liberado + Number(r.total_liberado),
        glosado: acc.glosado + Number(r.total_glosado),
        pago: acc.pago + Number(r.total_pago),
      }),
      { guias: 0, informado: 0, processado: 0, liberado: 0, glosado: 0, pago: 0 }
    );

    return {
      total_guias: tot.guias,
      total_enviado: tot.informado,
      total_processado: tot.processado,
      total_liberado: tot.liberado,
      total_glosado: tot.glosado,
      total_pago: tot.pago,
      taxa_glosa_percent: tot.informado > 0 ? +((tot.glosado / tot.informado) * 100).toFixed(2) : 0,
      taxa_recebimento_percent: tot.liberado > 0 ? +((tot.pago / tot.liberado) * 100).toFixed(2) : 0,
      por_convenio: stats.map((r) => ({
        convenio: r.convenio_name,
        guias: Number(r.total_guias),
        informado: Number(r.total_enviado),
        liberado: Number(r.total_liberado),
        glosa: Number(r.total_glosado),
        taxa_glosa: Number(r.taxa_glosa_percent),
      })),
    };
  },

  // ── Protocolos (configuracao) ──────────────────────────────────

  async listProtocols(companyId: string): Promise<TissProtocol[]> {
    const { data, error } = await supabase
      .from("tiss_protocols")
      .select(TISS_PROTOCOL_METADATA_COLUMNS)
      .eq("company_id", companyId)
      .order("cd_convenio");
    if (error) throw error;
    return (data || []) as TissProtocol[];
  },

  async saveProtocol(
    companyId: string,
    data: { cd_convenio: number; ds_endpoint: string }
  ): Promise<TissProtocol> {
    void companyId;
    void data;
    throw new Error("Configuracao de protocolo TISS bloqueada no navegador: operacao exige backend seguro e auditoria");
  },
};

export default tissService;
