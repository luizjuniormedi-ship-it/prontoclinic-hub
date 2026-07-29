/**
 * tissService — Módulo TISS/XML (faturamento eletrônico de convênios)
 *
 * Mantém o domínio TISS próprio do ProntoMedic. O cliente só consulta tabelas;
 * mudanças de estado passam por RPCs transacionais, auditáveis e isoladas por
 * empresa. Nenhuma operação deste serviço acessa ou altera o DataSIGH.
 *
 * Padrão TISS da ANS (Agência Nacional de Saúde Suplementar)
 *   - Comunicação vigente para guias: 04.03.00 (ANS, maio/2026)
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

/** A ANS publica a release como 04.03.00; o dm_versao do XSD exige 4.03.00. */
export const TISS_COMMUNICATION_RELEASE = "04.03.00" as const;
export const TISS_COMMUNICATION_VERSION = "4.03.00" as const;
export type TissCommunicationVersion = typeof TISS_COMMUNICATION_VERSION;

export type GlosaStatus = "PENDENTE" | "ENVIADO" | "DEFERIDO" | "INDEFERIDO" | "PARCIAL";

export interface TissXml {
  id: number;
  company_id: string;
  cd_fatura?: number;
  appointment_id?: number;
  cd_convenio?: number;
  ds_descricao?: string;
  ds_filename?: string;
  dt_fatura?: string;
  ds_tipo_guia?: TissTipoGuia;
  cd_lote?: number;
  ds_protocolo?: string;
  dt_recurso?: string;
  ds_recurso_xml?: string;
  ds_protocolo_recurso?: string;
  vl_informado?: number;
  vl_processado?: number;
  vl_liberado?: number;
  vl_glosa?: number;
  bl_xml_enviado?: string;
  bl_xml_retorno?: string;
  bl_xml_recurso?: string;
  ds_hash_envio?: string;
  ds_hash_retorno?: string;
  ds_versao_tiss: string;
  tp_ambiente: TissAmbiente;
  status: TissStatus;
  ds_motivo_rejeicao?: string;
  lg_deletado: boolean;
  dt_envio?: string;
  dt_retorno?: string;
  dt_pagamento?: string;
  cd_user_envio?: string;
  cd_user_recebimento?: string;
  cd_origem_sigh?: number;
  created_at: string;
  updated_at: string;
}

export interface TissGlosa {
  id: number;
  cd_tiss_xml: number;
  company_id: string;
  cd_glosa_code?: string;
  ds_motivo?: string;
  vl_glosa: number;
  dt_glosa: string;
  lg_recurso_enviado: boolean;
  dt_recurso?: string;
  ds_protocolo_recurso?: string;
  bl_xml_recurso?: string;
  ds_status_recurso: GlosaStatus;
  cd_procedimento_tuss?: string;
  cd_executante?: string;
  cd_user_registro?: string;
  cd_origem_sigh?: number;
  created_at: string;
  updated_at: string;
}

export interface TissProtocol {
  id: number;
  company_id: string;
  cd_convenio: number;
  ds_endpoint: string;
  ds_versao_tiss: string;
  tp_ambiente: TissAmbiente;
  lg_active: boolean;
  ds_observacao?: string;
  dt_ultimo_teste?: string;
  ds_status_teste?: string;
  cd_origem_sigh?: number;
  created_at: string;
  updated_at: string;
}

export interface TissXmlDocument {
  id: number;
  appointment_id?: number;
  ds_filename?: string;
  ds_versao_tiss: string;
  tp_ambiente: TissAmbiente;
  status: TissStatus;
  ds_hash_envio?: string;
  ds_hash_retorno?: string;
  bl_xml_enviado?: string;
  bl_xml_retorno?: string;
  bl_xml_recurso?: string;
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

function normalizeNonNegativeNumber(value: unknown, field: string, nullAsZero = false): number {
  if (value === null || value === undefined) {
    if (nullAsZero) return 0;
    throw new Error(`Valor numérico TISS ausente em ${field}.`);
  }

  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" &&
      !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))
  ) {
    throw new Error(`Valor numérico TISS inválido em ${field}.`);
  }

  const normalized = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`Valor numérico TISS inválido em ${field}.`);
  }
  return normalized;
}

function addFiniteTissValues(left: number, right: number, field: string): number {
  const total = left + right;
  if (!Number.isFinite(total)) {
    throw new Error(`Total TISS inválido em ${field}.`);
  }
  return total;
}

function createTissOperationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  throw new Error("Runtime sem gerador criptográfico de operation_id TISS");
}

async function createMonthlyBatchOperationId(
  companyId: string,
  competence: string
): Promise<string> {
  if (
    typeof crypto === "undefined" ||
    !crypto.subtle ||
    typeof TextEncoder === "undefined"
  ) {
    throw new Error("Runtime sem gerador criptográfico de idempotência TISS");
  }

  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`prontomedic:tiss:monthly:${companyId}:${competence}`)
    )
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function asRpcRecord(data: unknown, operation: string): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${operation} retornou uma resposta inválida`);
  }
  return data as Record<string, unknown>;
}

function rpcPositiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} retornou um identificador inválido`);
  }
  return parsed;
}

function calculateFinitePercentage(numerator: number, denominator: number, field: string): number {
  if (denominator === 0) return 0;
  const percentage = (numerator / denominator) * 100;
  if (!Number.isFinite(percentage)) {
    throw new Error(`Percentual TISS inválido em ${field}.`);
  }
  return Number(percentage.toFixed(2));
}

function normalizeTissXmlRow(row: unknown, context: string): TissXml {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`Registro TISS inválido em ${context}.`);
  }

  const source = row as Record<string, unknown>;
  return {
    ...source,
    vl_informado: normalizeNonNegativeNumber(source.vl_informado, `${context}.vl_informado`, true),
    vl_processado: normalizeNonNegativeNumber(source.vl_processado, `${context}.vl_processado`, true),
    vl_liberado: normalizeNonNegativeNumber(source.vl_liberado, `${context}.vl_liberado`, true),
    vl_glosa: normalizeNonNegativeNumber(source.vl_glosa, `${context}.vl_glosa`, true),
  } as unknown as TissXml;
}

function normalizeTissGlosaRow(row: unknown, context: string): TissGlosa {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`Registro de glosa TISS inválido em ${context}.`);
  }

  const source = row as Record<string, unknown>;
  return {
    ...source,
    vl_glosa: normalizeNonNegativeNumber(source.vl_glosa, `${context}.vl_glosa`, true),
  } as unknown as TissGlosa;
}

export interface TissXmlBuildInput {
  appointmentId: number;
  tipoGuia: TissTipoGuia;
  nr_carteira: string;
  cd_atendimento?: string;
  pacienteNome: string;
  profissionalNome: string;
  professionalLicense: string;
  providerCnpj: string;
  registroAns: string;
  /** Campos obrigatórios no tissGuiasV4_03_00.xsd para uma guia SP/SADT. */
  cnes?: string;
  professionalCouncilCode?: string;
  professionalStateCode?: string;
  professionalCbos?: string;
  atendimentoRN?: "S" | "N";
  caraterAtendimento?: "1" | "2";
  tipoAtendimento?: "01" | "02" | "03" | "04" | "08" | "09" | "10" | "13" | "23";
  indicadorAcidente?: "0" | "1" | "2" | "9";
  regimeAtendimento?: "01" | "02" | "03" | "04" | "05";
  dataExecucao?: string;
  versao?: TissCommunicationVersion;
  procedimentos: Array<{
    cd_tuss: string;
    ds_procedimento: string;
    qt: number;
    vl_unitario: number;
  }>;
  vl_total?: number;
  agora?: Date;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function leftRotate32(value: number, amount: number): number {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

function md5Iso88591(value: string): string {
  const bytes = encodeIso88591(value);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

  for (let offset = 0; offset < padded.length; offset += 64) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const word = view.getUint32(offset + g * 4, true);
      const constant = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
      const nextB = (b + leftRotate32((a + f + constant + word) >>> 0, shifts[Math.floor(i / 16) * 4 + (i % 4)])) >>> 0;
      a = d;
      d = c;
      c = b;
      b = nextB;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0]
    .flatMap((word) => [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff])
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** Calcula o MD5 TISS sobre os valores da transação, sem tags e sem epílogo. */
export function calculateTissTransactionMd5(transactionXml: string): string {
  const withoutEpilogue = transactionXml.replace(/<ans:epilogo>[\s\S]*?<\/ans:epilogo>/, "");
  const values = Array.from(withoutEpilogue.matchAll(/>([^<]*)</g))
    .map((match) => match[1])
    .filter((value) => value.trim().length > 0)
    .map(decodeXmlText)
    .join("");
  if (!values) {
    throw new Error("Não foi possível calcular o MD5 TISS: transação sem valores.");
  }
  return md5Iso88591(values);
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function requireTiss403SadtFields(input: TissXmlBuildInput): void {
  if (input.tipoGuia !== "SP/SADT") {
    throw new Error("O gerador TISS 04.03.00 implementa somente guia SP/SADT.");
  }
  const required: Array<[string, unknown]> = [
    ["nr_carteira", input.nr_carteira],
    ["professionalLicense", onlyDigits(input.professionalLicense)],
    ["providerCnpj", onlyDigits(input.providerCnpj)],
    ["registroAns", onlyDigits(input.registroAns)],
    ["cnes", input.cnes],
    ["professionalCouncilCode", input.professionalCouncilCode],
    ["professionalStateCode", input.professionalStateCode],
    ["professionalCbos", input.professionalCbos],
    ["atendimentoRN", input.atendimentoRN],
    ["caraterAtendimento", input.caraterAtendimento],
    ["tipoAtendimento", input.tipoAtendimento],
    ["indicadorAcidente", input.indicadorAcidente],
    ["regimeAtendimento", input.regimeAtendimento],
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`Dados obrigatórios TISS 04.03.00 ausentes: ${missing.join(", ")}.`);
  }
  if (onlyDigits(input.providerCnpj).length !== 14) {
    throw new Error("CNPJ do prestador deve conter 14 dígitos para TISS 04.03.00.");
  }
  if (!/^\d{6}$/.test(onlyDigits(input.registroAns))) {
    throw new Error("Registro ANS deve conter 6 dígitos para TISS 04.03.00.");
  }
  if (!input.procedimentos.length) {
    throw new Error("A guia SP/SADT deve conter ao menos um procedimento executado.");
  }
  input.procedimentos.forEach((procedure, index) => {
    const quantity = normalizeNonNegativeNumber(procedure.qt, `procedimentos[${index}].qt`);
    normalizeNonNegativeNumber(procedure.vl_unitario, `procedimentos[${index}].vl_unitario`);
    if (!/^\d{1,10}$/.test(procedure.cd_tuss) || quantity <= 0) {
      throw new Error("Procedimento TISS inválido: informe código TUSS numérico, quantidade positiva e valor não negativo.");
    }
  });
  if (input.vl_total !== undefined) {
    normalizeNonNegativeNumber(input.vl_total, "vl_total");
  }
}

/**
 * Builds a TISS message without network or database side effects.
 * Persistence and operator delivery are deliberately handled by separate steps.
 */
export function buildTissXml(input: TissXmlBuildInput): { xml: string; vlTotal: number; hash: string } {
  requireTiss403SadtFields(input);
  const agora = input.agora ?? new Date();
  const version = input.versao ?? TISS_COMMUNICATION_VERSION;
  if (version !== TISS_COMMUNICATION_VERSION) {
    throw new Error(`Versão de comunicação não suportada pelo gerador: ${version}.`);
  }
  const executionDate = isoToTissDate(input.dataExecucao ?? agora.toISOString());
  const executionTime = agora.toISOString().substring(11, 19);
  const providerCnpj = onlyDigits(input.providerCnpj);
  const registroAns = onlyDigits(input.registroAns);
  const professionalLicense = onlyDigits(input.professionalLicense);
  const normalizedProcedures = input.procedimentos.map((procedure, index) => ({
    ...procedure,
    qt: normalizeNonNegativeNumber(procedure.qt, `procedimentos[${index}].qt`),
    vl_unitario: normalizeNonNegativeNumber(
      procedure.vl_unitario,
      `procedimentos[${index}].vl_unitario`
    ),
  }));
  const calculatedTotal = normalizedProcedures.reduce((acc, procedure, index) => {
    const itemTotal = procedure.qt * procedure.vl_unitario;
    if (!Number.isFinite(itemTotal)) {
      throw new Error(`Total TISS inválido em procedimentos[${index}].`);
    }
    return addFiniteTissValues(acc, itemTotal, "procedimentos");
  }, 0);
  const vlTotal =
    input.vl_total === undefined
      ? calculatedTotal
      : normalizeNonNegativeNumber(input.vl_total, "vl_total");
  const procs = normalizedProcedures
    .map(
      (p, index) => `
            <ans:procedimentoExecutado>
              <ans:sequencialItem>${index + 1}</ans:sequencialItem>
              <ans:dataExecucao>${executionDate}</ans:dataExecucao>
              <ans:horaInicial>${executionTime}</ans:horaInicial>
              <ans:procedimento>
                <ans:codigoTabela>22</ans:codigoTabela>
                <ans:codigoProcedimento>${xmlEscape(p.cd_tuss)}</ans:codigoProcedimento>
                <ans:descricaoProcedimento>${xmlEscape(p.ds_procedimento)}</ans:descricaoProcedimento>
              </ans:procedimento>
              <ans:quantidadeExecutada>${p.qt}</ans:quantidadeExecutada>
              <ans:reducaoAcrescimo>1.00</ans:reducaoAcrescimo>
              <ans:valorUnitario>${p.vl_unitario.toFixed(2)}</ans:valorUnitario>
              <ans:valorTotal>${(p.qt * p.vl_unitario).toFixed(2)}</ans:valorTotal>
            </ans:procedimentoExecutado>`
    )
    .join("");
  const transactionId = String(agora.getTime()).slice(-12);
  const guideNumber = xmlEscape(input.cd_atendimento || String(input.appointmentId));
  const transactionXml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">
  <ans:cabecalho>
    <ans:identificacaoTransacao>
      <ans:tipoTransacao>ENVIO_LOTE_GUIAS</ans:tipoTransacao>
      <ans:sequencialTransacao>${transactionId}</ans:sequencialTransacao>
      <ans:dataRegistroTransacao>${isoToTissDate(agora.toISOString())}</ans:dataRegistroTransacao>
      <ans:horaRegistroTransacao>${executionTime}</ans:horaRegistroTransacao>
    </ans:identificacaoTransacao>
    <ans:origem>
      <ans:identificacaoPrestador><ans:CNPJ>${providerCnpj}</ans:CNPJ></ans:identificacaoPrestador>
    </ans:origem>
    <ans:destino>
      <ans:registroANS>${registroAns}</ans:registroANS>
    </ans:destino>
    <ans:Padrao>${version}</ans:Padrao>
  </ans:cabecalho>
  <ans:prestadorParaOperadora>
    <ans:loteGuias>
      <ans:numeroLote>${transactionId}</ans:numeroLote>
      <ans:guiasTISS>
        <ans:guiaSP-SADT>
          <ans:cabecalhoGuia>
            <ans:registroANS>${registroAns}</ans:registroANS>
            <ans:numeroGuiaPrestador>${guideNumber}</ans:numeroGuiaPrestador>
          </ans:cabecalhoGuia>
          <ans:dadosBeneficiario>
            <ans:numeroCarteira>${xmlEscape(input.nr_carteira)}</ans:numeroCarteira>
            <ans:atendimentoRN>${input.atendimentoRN}</ans:atendimentoRN>
          </ans:dadosBeneficiario>
          <ans:dadosSolicitante>
            <ans:contratadoSolicitante><ans:cnpjContratado>${providerCnpj}</ans:cnpjContratado></ans:contratadoSolicitante>
            <ans:nomeContratadoSolicitante>${xmlEscape(input.profissionalNome)}</ans:nomeContratadoSolicitante>
            <ans:profissionalSolicitante>
              <ans:nomeProfissional>${xmlEscape(input.profissionalNome)}</ans:nomeProfissional>
              <ans:conselhoProfissional>${input.professionalCouncilCode}</ans:conselhoProfissional>
              <ans:numeroConselhoProfissional>${professionalLicense}</ans:numeroConselhoProfissional>
              <ans:UF>${input.professionalStateCode}</ans:UF>
              <ans:CBOS>${input.professionalCbos}</ans:CBOS>
            </ans:profissionalSolicitante>
          </ans:dadosSolicitante>
          <ans:dadosSolicitacao>
            <ans:dataSolicitacao>${executionDate}</ans:dataSolicitacao>
            <ans:caraterAtendimento>${input.caraterAtendimento}</ans:caraterAtendimento>
          </ans:dadosSolicitacao>
          <ans:dadosExecutante>
            <ans:contratadoExecutante><ans:cnpjContratado>${providerCnpj}</ans:cnpjContratado></ans:contratadoExecutante>
            <ans:CNES>${xmlEscape(input.cnes!)}</ans:CNES>
          </ans:dadosExecutante>
          <ans:dadosAtendimento>
            <ans:tipoAtendimento>${input.tipoAtendimento}</ans:tipoAtendimento>
            <ans:indicacaoAcidente>${input.indicadorAcidente}</ans:indicacaoAcidente>
            <ans:regimeAtendimento>${input.regimeAtendimento}</ans:regimeAtendimento>
          </ans:dadosAtendimento>
          <ans:procedimentosExecutados>${procs}
          </ans:procedimentosExecutados>
          <ans:valorTotal>
            <ans:valorProcedimentos>${vlTotal.toFixed(2)}</ans:valorProcedimentos>
            <ans:valorTotalGeral>${vlTotal.toFixed(2)}</ans:valorTotalGeral>
          </ans:valorTotal>
        </ans:guiaSP-SADT>
      </ans:guiasTISS>
    </ans:loteGuias>
  </ans:prestadorParaOperadora>`;
  const hash = calculateTissTransactionMd5(transactionXml);
  const xml = `${transactionXml}
  <ans:epilogo><ans:hash>${hash}</ans:hash></ans:epilogo>
</ans:mensagemTISS>`;
  return { xml, vlTotal, hash };
}

export function buildTissLoteGuiasSoapEnvelope(xml: string): string {
  const cabecalho = xml.match(/<ans:cabecalho>[\s\S]*?<\/ans:cabecalho>/)?.[0];
  const loteGuias = xml.match(/<ans:loteGuias>[\s\S]*?<\/ans:loteGuias>/)?.[0];
  const hash = xml.match(/<ans:epilogo>\s*<ans:hash>([A-Fa-f0-9]{32})<\/ans:hash>\s*<\/ans:epilogo>/)?.[1];
  if (!cabecalho || !loteGuias || !hash) {
    throw new Error("XML TISS incompleto para montar o envelope SOAP loteGuiasWS.");
  }
  return `<?xml version="1.0" encoding="ISO-8859-1"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">
  <soapenv:Header/>
  <soapenv:Body>
    <ans:loteGuiasWS>
      ${cabecalho}
      ${loteGuias}
      <ans:hash>${hash}</ans:hash>
    </ans:loteGuiasWS>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function encodeIso88591(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint > 255) {
      throw new Error(`Caractere fora de ISO-8859-1 no XML TISS: U+${codePoint.toString(16).toUpperCase()}.`);
    }
    bytes.push(codePoint);
  }
  return Uint8Array.from(bytes);
}

export function validateTissTransmissionPrerequisites(input: {
  xmlBody?: string;
  xmlVersion: string;
  protocolVersion?: string;
  hasServerTransport: boolean;
}): string {
  const xmlBody = input.xmlBody?.trim();
  if (!xmlBody) {
    throw new Error("XML TISS ausente. Gere e valide a guia antes da transmissão.");
  }
  if (!input.protocolVersion || input.protocolVersion !== input.xmlVersion) {
    throw new Error(
      `Versão TISS incompatível: XML ${input.xmlVersion}, protocolo ${input.protocolVersion || "não informado"}.`
    );
  }
  if (input.xmlVersion !== TISS_COMMUNICATION_VERSION) {
    throw new Error(
      `Versão TISS não homologada para envio: ${input.xmlVersion}. O gerador suporta ${TISS_COMMUNICATION_VERSION}.`
    );
  }
  const declaredVersion = xmlBody.match(/<ans:Padrao>([^<]+)<\/ans:Padrao>/)?.[1];
  if (declaredVersion !== input.xmlVersion) {
    throw new Error(
      `Versão declarada no XML (${declaredVersion || "ausente"}) diverge da versão persistida (${input.xmlVersion}).`
    );
  }
  if (!/<ans:epilogo>\s*<ans:hash>(?!0{32}<\/ans:hash>)[A-Fa-f0-9]{32}<\/ans:hash>\s*<\/ans:epilogo>/.test(xmlBody)) {
    throw new Error("Hash MD5 TISS ausente ou pendente. O epílogo deve ser calculado no servidor antes do envio.");
  }
  if (!input.hasServerTransport) {
    throw new Error(
      "Transmissão TISS direta pelo navegador está desabilitada. Use o gateway servidor com validação XSD e certificado A1."
    );
  }
  return xmlBody;
}

// ── Service ────────────────────────────────────────────────────────

export const tissService = {
  // ── CRUD de XMLs ───────────────────────────────────────────────

  async listFaturas(
    companyId: string,
    filters?: { status?: TissStatus; mes?: number; ano?: number; cd_convenio?: number }
  ): Promise<TissXml[]> {
    if (!companyId) throw new Error("Empresa obrigatória para consultar TISS");
    if (filters?.mes && !filters.ano) {
      throw new Error("Ano obrigatório para filtrar a competência TISS");
    }
    const { data, error } = await supabase.rpc("m16_list_xml_secure", {
      p_year: filters?.ano ?? null,
      p_limit: 500,
    });
    if (error) throw error;
    return ((data || []) as Array<Record<string, unknown>>)
      .map((row, index) =>
        normalizeTissXmlRow(
          { ...row, company_id: companyId, lg_deletado: false },
          `m16_list_xml_secure[${index}]`,
        ),
      )
      .filter((row) => !filters?.status || row.status === filters.status)
      .filter((row) => !filters?.cd_convenio || row.cd_convenio === filters.cd_convenio)
      .filter((row) => {
        if (!filters?.mes) return true;
        const month = Number(row.dt_fatura?.slice(5, 7));
        return month === filters.mes;
      });
  },

  async getXmlDocument(id: number): Promise<TissXmlDocument> {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error("Identificador do XML TISS inválido");
    }
    const { data, error } = await supabase.rpc("m16_get_xml_document_secure", {
      p_tiss_xml_id: id,
    });
    if (error) throw error;
    const document = asRpcRecord(data, "m16_get_xml_document_secure");
    if (rpcPositiveInteger(document.id, "m16_get_xml_document_secure.id") !== id) {
      throw new Error("m16_get_xml_document_secure retornou XML divergente");
    }
    return document as unknown as TissXmlDocument;
  },

  // ── Geracao do XML TISS ───────────────────────────────────────

  /**
   * Gera XML TISS SP/SADT da release de comunicação 04.03.00
   * (valor canônico dm_versao no XSD: 4.03.00).
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
      cnes?: string;
      professionalCouncilCode?: string;
      professionalStateCode?: string;
      professionalCbos?: string;
      atendimentoRN?: "S" | "N";
      caraterAtendimento?: "1" | "2";
      tipoAtendimento?: "01" | "02" | "03" | "04" | "08" | "09" | "10" | "13" | "23";
      indicadorAcidente?: "0" | "1" | "2" | "9";
      regimeAtendimento?: "01" | "02" | "03" | "04" | "05";
      dataExecucao?: string;
      procedimentos: Array<{
        cd_tuss: string;
        ds_procedimento: string;
        qt: number;
        vl_unitario: number;
      }>;
    }
  ): Promise<{ xml: string; id: number; hash: string }> {
    // Buscar contexto
    const { data: company } = await supabase
      .from("companies")
      .select("id, cnpj, razao_social, name")
      .single();
    const { data: convenio } = await supabase
      .from("insurance_companies")
      .select("name, registro_ans, cnpj")
      .eq("id", codes.cd_convenio)
      .single();
    const { data: paciente } = await supabase
      .from("patients")
      .select("full_name, cpf, birth_date, sex")
      .eq("id", codes.cd_paciente)
      .single();
    const { data: prof } = await supabase
      .from("professionals")
      .select("full_name, cpf, professional_license")
      .eq("id", codes.cd_profissional)
      .single();

    const agora = new Date();
    const built = buildTissXml({
      appointmentId,
      tipoGuia: codes.tipoGuia,
      nr_carteira: codes.nr_carteira,
      cd_atendimento: codes.cd_atendimento,
      pacienteNome: paciente?.full_name || "",
      profissionalNome: prof?.full_name || "",
      professionalLicense: prof?.professional_license || "",
      providerCnpj: company?.cnpj || "",
      registroAns: convenio?.registro_ans || "",
      cnes: codes.cnes,
      professionalCouncilCode: codes.professionalCouncilCode,
      professionalStateCode: codes.professionalStateCode,
      professionalCbos: codes.professionalCbos,
      atendimentoRN: codes.atendimentoRN,
      caraterAtendimento: codes.caraterAtendimento,
      tipoAtendimento: codes.tipoAtendimento,
      indicadorAcidente: codes.indicadorAcidente,
      regimeAtendimento: codes.regimeAtendimento,
      dataExecucao: codes.dataExecucao,
      procedimentos: codes.procedimentos,
      vl_total: codes.vl_total,
      agora,
    });
    const { xml, vlTotal, hash } = built;

    const { data: persisted, error } = await supabase.rpc("m16_persist_xml_secure", {
      p_operation_id: createTissOperationId(),
      p_appointment_id: appointmentId,
      p_payload: {
        cd_convenio: codes.cd_convenio,
        ds_descricao: `${convenio?.name || "Convenio"} - ${codes.tipoGuia} - Apt ${appointmentId}`,
        ds_filename: `tiss_${appointmentId}_${Date.now()}.xml`,
        dt_fatura: agora.toISOString().substring(0, 10),
        ds_tipo_guia: codes.tipoGuia,
        cd_lote: Date.now(),
        vl_informado: vlTotal,
        bl_xml_enviado: xml,
        ds_hash_envio: hash,
        ds_versao_tiss: TISS_COMMUNICATION_VERSION,
        tp_ambiente: "HOMOLOGACAO",
      },
    });
    if (error) throw error;
    const response = asRpcRecord(persisted, "m16_persist_xml_secure");
    const id = rpcPositiveInteger(response.id, "m16_persist_xml_secure.id");

    return { xml, id, hash };
  },

  // ── Processamento do retorno ───────────────────────────────────

  async processReturn(_tissXmlId: number, _returnXML: string): Promise<never> {
    throw new Error(
      "Processamento de retorno TISS bloqueado no cliente. O XML deve ser validado pelo XSD oficial e processado exclusivamente pelo gateway servidor homologado."
    );
  },

  // ── Registro manual de glosa ───────────────────────────────────

  async registrarGlosa(
    tissXmlId: number,
    motivo: string,
    valor: number,
    codigo?: string
  ): Promise<TissGlosa> {
    const normalizedValue = normalizeNonNegativeNumber(valor, "registrarGlosa.valor");
    const { data: persisted, error } = await supabase.rpc(
      "m16_record_manual_denial_secure",
      {
        p_operation_id: createTissOperationId(),
        p_tiss_xml_id: tissXmlId,
        p_reason: motivo,
        p_amount: normalizedValue,
        p_code: codigo,
      }
    );
    if (error) throw error;
    const response = asRpcRecord(persisted, "m16_record_manual_denial_secure");
    const denialId = rpcPositiveInteger(
      response.id,
      "m16_record_manual_denial_secure.id"
    );
    const { data: denials, error: readError } = await supabase.rpc(
      "m16_list_denials_secure",
      { p_tiss_xml_id: tissXmlId, p_limit: 500 },
    );
    if (readError) throw readError;
    const row = ((denials || []) as Array<Record<string, unknown>>).find(
      (item) => Number(item.id) === denialId,
    );
    if (!row) throw new Error("Glosa registrada não foi encontrada no escopo ativo");
    return normalizeTissGlosaRow(row, "tiss_glosas");
  },

  async listGlosas(tissXmlId: number): Promise<TissGlosa[]> {
    const { data, error } = await supabase.rpc("m16_list_denials_secure", {
      p_tiss_xml_id: tissXmlId,
      p_limit: 500,
    });
    if (error) throw error;
    return ((data || []) as Array<Record<string, unknown>>).map((row, index) =>
      normalizeTissGlosaRow(
        { ...row, cd_tiss_xml: row.tiss_xml_id },
        `m16_list_denials_secure[${index}]`,
      ),
    );
  },

  // ── Recurso de Glosa ───────────────────────────────────────────

  async enviarRecurso(glosaId: number, recursoXML: string): Promise<{ sent: boolean; protocolo?: string }> {
    void recursoXML;
    throw new Error(
      `Envio do recurso de glosa ${glosaId} está bloqueado no cliente até existir gateway servidor TISS 04.03.00 homologado.`
    );
  },

  async gerarXMLRecurso(glosaId: number): Promise<string> {
    throw new Error(
      `Recurso de glosa ${glosaId} não foi migrado para o XSD 04.03.00 e permanece bloqueado para evitar XML incompatível.`
    );
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
    if (!companyId) {
      throw new Error("Empresa obrigatória para gerar a competência TISS");
    }
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new Error("Competência TISS possui mês inválido");
    }
    if (!Number.isInteger(ano) || ano < 2000 || ano > 2200) {
      throw new Error("Competência TISS possui ano inválido");
    }
    const competence = `${ano}-${String(mes).padStart(2, "0")}-01`;
    const operationId = await createMonthlyBatchOperationId(companyId, competence);
    const { data, error } = await supabase.rpc(
      "m16_generate_monthly_batch_secure",
      {
        p_operation_id: operationId,
        p_competence: competence,
      }
    );
    if (error) throw error;
    const response = asRpcRecord(data, "m16_generate_monthly_batch_secure");
    return {
      lote: rpcPositiveInteger(response.lote, "m16_generate_monthly_batch_secure.lote"),
      total_xmls: normalizeNonNegativeNumber(
        response.total_xmls,
        "m16_generate_monthly_batch_secure.total_xmls"
      ),
      vl_total: normalizeNonNegativeNumber(
        response.vl_total,
        "m16_generate_monthly_batch_secure.vl_total"
      ),
    };
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

    const stats = ((data || []) as Array<Record<string, unknown>>).map((row, index) => {
      const context = `tiss_get_stats[${index}]`;
      return {
        convenio: typeof row.convenio_name === "string" ? row.convenio_name : "",
        guias: normalizeNonNegativeNumber(row.total_guias, `${context}.total_guias`, true),
        informado: normalizeNonNegativeNumber(row.total_enviado, `${context}.total_enviado`, true),
        processado: normalizeNonNegativeNumber(row.total_processado, `${context}.total_processado`, true),
        liberado: normalizeNonNegativeNumber(row.total_liberado, `${context}.total_liberado`, true),
        glosado: normalizeNonNegativeNumber(row.total_glosado, `${context}.total_glosado`, true),
        pago: normalizeNonNegativeNumber(row.total_pago, `${context}.total_pago`, true),
        taxaGlosa: normalizeNonNegativeNumber(row.taxa_glosa_percent, `${context}.taxa_glosa_percent`, true),
      };
    });

    const tot = stats.reduce(
      (acc, r) => ({
        guias: addFiniteTissValues(acc.guias, r.guias, "tiss_get_stats.total_guias"),
        informado: addFiniteTissValues(acc.informado, r.informado, "tiss_get_stats.total_enviado"),
        processado: addFiniteTissValues(acc.processado, r.processado, "tiss_get_stats.total_processado"),
        liberado: addFiniteTissValues(acc.liberado, r.liberado, "tiss_get_stats.total_liberado"),
        glosado: addFiniteTissValues(acc.glosado, r.glosado, "tiss_get_stats.total_glosado"),
        pago: addFiniteTissValues(acc.pago, r.pago, "tiss_get_stats.total_pago"),
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
      taxa_glosa_percent: calculateFinitePercentage(
        tot.glosado,
        tot.informado,
        "tiss_get_stats.taxa_glosa_percent"
      ),
      taxa_recebimento_percent: calculateFinitePercentage(
        tot.pago,
        tot.liberado,
        "tiss_get_stats.taxa_recebimento_percent"
      ),
      por_convenio: stats.map((r) => ({
        convenio: r.convenio,
        guias: r.guias,
        informado: r.informado,
        liberado: r.liberado,
        glosa: r.glosado,
        taxa_glosa: r.taxaGlosa,
      })),
    };
  },

  // ── Protocolos (configuracao) ──────────────────────────────────

  async listProtocols(companyId: string): Promise<TissProtocol[]> {
    if (!companyId) throw new Error("Empresa obrigatória para consultar protocolos TISS");
    const { data, error } = await supabase.rpc("m16_list_protocols_secure");
    if (error) throw error;
    return ((data || []) as Array<Record<string, unknown>>).map(
      (row) => ({ ...row, company_id: companyId }) as unknown as TissProtocol,
    );
  },

  async saveProtocol(
    companyId: string,
    data: Partial<TissProtocol> & { cd_convenio: number; ds_endpoint: string }
  ): Promise<TissProtocol> {
    const payload = {
      cd_convenio: data.cd_convenio,
      ds_endpoint: data.ds_endpoint,
      ds_versao_tiss: data.ds_versao_tiss || TISS_COMMUNICATION_VERSION,
      tp_ambiente: data.tp_ambiente || "HOMOLOGACAO",
      lg_active: data.lg_active ?? true,
      ds_observacao: data.ds_observacao,
    };
    const { data: row, error } = await supabase.rpc("m16_save_protocol_secure", {
      p_operation_id: createTissOperationId(),
      p_payload: payload,
    });
    if (error) throw error;
    const response = asRpcRecord(row, "m16_save_protocol_secure");
    if (response.company_id !== companyId) {
      throw new Error("m16_save_protocol_secure retornou empresa divergente");
    }
    return response as unknown as TissProtocol;
  },
};

export default tissService;
