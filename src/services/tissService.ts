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
  for (const procedure of input.procedimentos) {
    if (!/^\d{1,10}$/.test(procedure.cd_tuss) || procedure.qt <= 0 || procedure.vl_unitario < 0) {
      throw new Error("Procedimento TISS inválido: informe código TUSS numérico, quantidade positiva e valor não negativo.");
    }
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
  const vlTotal =
    input.vl_total ??
    input.procedimentos.reduce((acc, p) => acc + p.qt * p.vl_unitario, 0);
  const procs = input.procedimentos
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

export interface TissTransmissionResult {
  sent: boolean;
  status: number;
  protocolo?: string;
  response?: string;
  reason?: string;
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

/**
 * Sends one XML through an explicitly injected server transport. The request
 * follows the official SOAP 1.1 loteGuias WSDL; no browser fetch fallback exists.
 */
export async function transmitTissXml(input: {
  endpoint: string;
  xml: string;
  tipoGuia?: TissTipoGuia;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<TissTransmissionResult> {
  const requestFetch = input.fetchImpl;
  if (!requestFetch) {
    return {
      sent: false,
      status: 0,
      reason: "Transporte TISS não injetado. O envio direto pelo navegador permanece desabilitado.",
    };
  }

  try {
    const soapEnvelope = buildTissLoteGuiasSoapEnvelope(input.xml);
    const response = await requestFetch(input.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=iso-8859-1",
        SOAPAction: '""',
      },
      body: encodeIso88591(soapEnvelope),
      signal: AbortSignal.timeout(input.timeoutMs ?? 30000),
    });
    const responseText = await response.text();
    const protocolMatch = responseText.match(
      /<(?:[\w.-]+:)?(?:numeroProtocolo|protocolo)[^>]*>([^<]+)<\/(?:[\w.-]+:)?(?:numeroProtocolo|protocolo)>/
    );
    const protocolo = protocolMatch?.[1];

    return {
      sent: response.ok,
      status: response.status,
      protocolo,
      response: responseText,
      reason: response.ok ? undefined : `HTTP ${response.status}: ${responseText.substring(0, 500)}`,
    };
  } catch (error) {
    return {
      sent: false,
      status: 0,
      reason: error instanceof Error ? error.message : "Falha no envio",
    };
  }
}

// ── Service ────────────────────────────────────────────────────────

export const tissService = {
  // ── CRUD de XMLs ───────────────────────────────────────────────

  async listFaturas(
    companyId: string,
    filters?: { status?: TissStatus; mes?: number; ano?: number; cd_convenio?: number }
  ): Promise<TissXml[]> {
    let q = supabase
      .from("tiss_xml")
      .select("*, insurance_companies(name, registro_ans)")
      .eq("company_id", companyId)
      .eq("lg_deletado", false)
      .order("dt_fatura", { ascending: false });
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.cd_convenio) q = q.eq("cd_convenio", filters.cd_convenio);
    if (filters?.mes) q = q.eq("dt_fatura", `${filters.ano}-${String(filters.mes).padStart(2, "0")}-01`);
    if (filters?.ano && !filters?.mes) {
      q = q.gte("dt_fatura", `${filters.ano}-01-01`).lte("dt_fatura", `${filters.ano}-12-31`);
    }
    const { data, error } = await q.limit(500);
    if (error) throw error;
    return (data || []) as TissXml[];
  },

  async getById(id: number): Promise<TissXml> {
    const { data, error } = await supabase
      .from("tiss_xml")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data as TissXml;
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

    // Persistir
    const { data: row, error } = await supabase
      .from("tiss_xml")
      .insert({
        company_id: company?.id,
        appointment_id: appointmentId,
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
        status: "PENDENTE",
      })
      .select()
      .single();
    if (error) throw error;

    return { xml, id: row.id, hash };
  },

  // ── Envio a Operadora ──────────────────────────────────────────

  /**
   * Envia o XML TISS para a operadora via webservice
   * Em homologação: aceita apenas transporte servidor explicitamente injetado.
   * Em produção: permanece bloqueado no cliente; certificado A1 e assinatura
   * pertencem ao gateway servidor homologado.
   */
  async sendToOperadora(
    tissXmlId: number,
    options: { fetchImpl?: typeof fetch } = {}
  ): Promise<{ sent: boolean; protocolo?: string; response?: unknown }> {
    const xml = await this.getById(tissXmlId);
    if (xml.tp_ambiente === "PRODUCAO") {
      throw new Error(
        "Envio TISS de produção está bloqueado no cliente. Use o gateway servidor homologado com XSD, MD5 e certificado A1."
      );
    }

    // Buscar protocolo (endpoint) da operadora
    const { data: proto } = await supabase
      .from("tiss_protocols")
      .select("*")
      .eq("cd_convenio", xml.cd_convenio || 0)
      .eq("tp_ambiente", xml.tp_ambiente)
      .eq("lg_active", true)
      .maybeSingle();

    if (!proto) {
      throw new Error(
        `Protocolo TISS nao configurado para convenio ${xml.cd_convenio} no ambiente ${xml.tp_ambiente}. Configure em tiss_protocols.`
      );
    }

    const xmlBody = validateTissTransmissionPrerequisites({
      xmlBody: xml.bl_xml_enviado,
      xmlVersion: xml.ds_versao_tiss,
      protocolVersion: proto.ds_versao_tiss,
      hasServerTransport: Boolean(options.fetchImpl),
    });

    const transmission = await transmitTissXml({
      endpoint: proto.ds_endpoint,
      xml: xmlBody,
      tipoGuia: xml.ds_tipo_guia,
      fetchImpl: options.fetchImpl,
    });
    const sent = transmission.sent;
    const protocolo = transmission.protocolo;
    const respXml = transmission.response;
    const motivoRejeicao = transmission.reason;

    const now = new Date().toISOString();
    await supabase
      .from("tiss_xml")
      .update({
        status: sent ? "ENVIADO" : "REJEITADO",
        dt_envio: now,
        ds_protocolo: protocolo,
        bl_xml_retorno: respXml,
        ds_motivo_rejeicao: motivoRejeicao,
        cd_user_envio: (await supabase.auth.getUser()).data.user?.id,
        updated_at: now,
      })
      .eq("id", tissXmlId);

    return { sent, protocolo, response: respXml };
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
    // Parser simples por regex (em produção, usar DOMParser)
    const protocoloMatch = returnXML.match(/<ns\d:protocolo[^>]*>([^<]+)<\/ns\d:protocolo>|<protocolo[^>]*>([^<]+)<\/protocolo>/);
    const protocolo = protocoloMatch?.[1] || protocoloMatch?.[2] || `PROC_${Date.now()}`;

    const valorProcMatch = returnXML.match(/<valorProcessado[^>]*>([0-9.]+)<\/valorProcessado>/);
    const valorLibMatch = returnXML.match(/<valorLiberado[^>]*>([0-9.]+)<\/valorLiberado>/);
    const vlProcessado = valorProcMatch ? parseFloat(valorProcMatch[1]) : 0;
    const vlLiberado = valorLibMatch ? parseFloat(valorLibMatch[1]) : 0;
    const vlGlosa = vlProcessado - vlLiberado;

    // Extrair glosas (procedimento a procedimento)
    const glosaRegex = /<glosaItem>([\s\S]*?)<\/glosaItem>/g;
    const glosas: Array<{ codigo: string; motivo: string; valor: number }> = [];
    let m;
    while ((m = glosaRegex.exec(returnXML)) !== null) {
      const bloco = m[1];
      const cod = bloco.match(/<codigoGlosa[^>]*>([^<]+)</)?.[1] || "";
      const mot = bloco.match(/<motivoGlosa[^>]*>([^<]+)</)?.[1] || "";
      const val = bloco.match(/<valorGlosa[^>]*>([0-9.]+)</)?.[1] || "0";
      glosas.push({ codigo: cod, motivo: mot, valor: parseFloat(val) });
    }

    const now = new Date().toISOString();
    const novoStatus: TissStatus = vlGlosa > 0 ? "GLOSADO" : "PROCESSADO";
    await supabase
      .from("tiss_xml")
      .update({
        status: novoStatus,
        dt_retorno: now,
        bl_xml_retorno: returnXML,
        ds_protocolo: protocolo,
        vl_processado: vlProcessado,
        vl_liberado: vlLiberado,
        vl_glosa: vlGlosa,
        cd_user_recebimento: (await supabase.auth.getUser()).data.user?.id,
        updated_at: now,
      })
      .eq("id", tissXmlId);

    // Persistir glosas individuais
    if (glosas.length > 0) {
      const { data: company } = await supabase.from("companies").select("id").single();
      await supabase.from("tiss_glosas").insert(
        glosas.map((g) => ({
          cd_tiss_xml: tissXmlId,
          company_id: company?.id,
          cd_glosa_code: g.codigo,
          ds_motivo: g.motivo,
          vl_glosa: g.valor,
          dt_glosa: new Date().toISOString().substring(0, 10),
          ds_status_recurso: "PENDENTE",
        }))
      );
    }

    return { protocolo, vl_processado: vlProcessado, vl_liberado: vlLiberado, vl_glosa: vlGlosa, glosas };
  },

  // ── Registro manual de glosa ───────────────────────────────────

  async registrarGlosa(
    tissXmlId: number,
    motivo: string,
    valor: number,
    codigo?: string
  ): Promise<TissGlosa> {
    const { data: company } = await supabase.from("companies").select("id").single();
    const { data: row, error } = await supabase
      .from("tiss_glosas")
      .insert({
        cd_tiss_xml: tissXmlId,
        company_id: company?.id,
        cd_glosa_code: codigo,
        ds_motivo: motivo,
        vl_glosa: valor,
        dt_glosa: new Date().toISOString().substring(0, 10),
        ds_status_recurso: "PENDENTE",
        cd_user_registro: (await supabase.auth.getUser()).data.user?.id,
      })
      .select()
      .single();
    if (error) throw error;

    // O status so pode avancar depois que o recálculo canonico confirmar.
    const { error: recalcError } = await supabase.rpc("recalc_tiss_total_glosa", { p_id: tissXmlId });
    if (recalcError) throw recalcError;

    // Atualizar status da guia
    await supabase
      .from("tiss_xml")
      .update({ status: "GLOSADO", updated_at: new Date().toISOString() })
      .eq("id", tissXmlId);
    return row as TissGlosa;
  },

  async listGlosas(tissXmlId: number): Promise<TissGlosa[]> {
    const { data, error } = await supabase
      .from("tiss_glosas")
      .select("*")
      .eq("cd_tiss_xml", tissXmlId)
      .order("dt_glosa", { ascending: false });
    if (error) throw error;
    return (data || []) as TissGlosa[];
  },

  // ── Recurso de Glosa ───────────────────────────────────────────

  async enviarRecurso(glosaId: number, recursoXML: string): Promise<{ sent: boolean; protocolo?: string }> {
    void recursoXML;
    throw new Error(
      `Envio do recurso de glosa ${glosaId} está bloqueado no cliente até existir gateway servidor TISS 04.03.00 homologado.`
    );
  },

  async gerarXMLRecurso(glosaId: number): Promise<string> {
    const { data: glosa } = await supabase
      .from("tiss_glosas")
      .select("*, tiss_xml(cd_convenio, ds_protocolo, dt_fatura, vl_glosa)")
      .eq("id", glosaId)
      .single();
    if (!glosa) throw new Error("Glosa nao encontrada");

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
    const dataInicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
    const dataFim = new Date(ano, mes, 0).toISOString().substring(0, 10); // ultimo dia do mes

    // Buscar atendimentos do mes cobertos por convenio
    const { data: appointments, error } = await supabase
      .from("appointments")
      .select("id, cd_patient, cd_insurance_plan, total_amount, status")
      .eq("company_id", companyId)
      .gte("start_time", dataInicio)
      .lte("start_time", dataFim + "T23:59:59")
      .neq("status", "CANCELLED");
    if (error) throw error;

    // Criar XML para cada atendimento
    const lote = Math.floor(Date.now() / 1000);
    let vlTotal = 0;
    let count = 0;
    for (const apt of appointments || []) {
      const { data: plan } = await supabase
        .from("insurance_plans")
        .select("insurance_company_id, codigo")
        .eq("id", apt.cd_insurance_plan || 0)
        .maybeSingle();
      if (!plan) continue;

      const vlTotalApt = (apt as { total_amount?: number }).total_amount || 0;
      vlTotal += vlTotalApt;
      count++;

      await supabase.from("tiss_xml").insert({
        company_id: companyId,
        cd_convenio: plan.insurance_company_id,
        cd_fatura: apt.id,
        ds_descricao: `Fatura mensal ${mes}/${ano} - Apt ${apt.id}`,
        ds_filename: `lote_${lote}_apt_${apt.id}.xml`,
        dt_fatura: dataFim,
        ds_tipo_guia: "CONSULTA",
        cd_lote: lote,
        vl_informado: vlTotalApt,
        vl_liberado: 0,
        vl_glosa: 0,
        ds_versao_tiss: TISS_COMMUNICATION_VERSION,
        tp_ambiente: "HOMOLOGACAO",
        status: "PENDENTE",
      });
    }

    return { lote, total_xmls: count, vl_total: vlTotal };
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
      .select("id, company_id, cd_convenio, ds_endpoint, ds_versao_tiss, tp_ambiente, lg_active, dt_ultimo_teste, ds_status_teste, created_at, updated_at")
      .eq("company_id", companyId)
      .order("cd_convenio");
    if (error) throw error;
    return (data || []) as TissProtocol[];
  },

  async saveProtocol(
    companyId: string,
    data: Partial<TissProtocol> & { cd_convenio: number; ds_endpoint: string }
  ): Promise<TissProtocol> {
    const payload = {
      company_id: companyId,
      cd_convenio: data.cd_convenio,
      ds_endpoint: data.ds_endpoint,
      ds_versao_tiss: data.ds_versao_tiss || TISS_COMMUNICATION_VERSION,
      tp_ambiente: data.tp_ambiente || "HOMOLOGACAO",
      lg_active: data.lg_active ?? true,
      ds_observacao: data.ds_observacao,
    };
    const { data: row, error } = await supabase
      .from("tiss_protocols")
      .upsert(payload, { onConflict: "cd_convenio,tp_ambiente" })
      .select()
      .single();
    if (error) throw error;
    return row as TissProtocol;
  },
};

export default tissService;
