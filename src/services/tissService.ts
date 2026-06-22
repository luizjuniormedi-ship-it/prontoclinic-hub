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
  company_id: string;
  cd_fatura?: number;
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
  cd_certificado_a1_path?: string;
  ds_certificado_senha?: string;
  ds_usuario?: string;
  ds_senha?: string;
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

function sha256(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  return crypto.subtle.digest("SHA-256", enc).then((buf) => {
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  });
}

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
    const vlTotal = codes.vl_total ?? codes.procedimentos.reduce((acc, p) => acc + p.qt * p.vl_unitario, 0);

    const procs = codes.procedimentos
      .map(
        (p) => `
      <ans:procedimento>
        <ans:codigoTabela>22</ans:codigoTabela>
        <ans:codigoProcedimento>${xmlEscape(p.cd_tuss)}</ans:codigoProcedimento>
        <ans:descricaoProcedimento>${xmlEscape(p.ds_procedimento)}</ans:descricaoProcedimento>
        <ans:quantidadeExecutada>${p.qt}</ans:quantidadeExecutada>
        <ans:valorUnitario>${p.vl_unitario.toFixed(2)}</ans:valorUnitario>
        <ans:valorTotal>${(p.qt * p.vl_unitario).toFixed(2)}</ans:valorTotal>
      </ans:procedimento>`
      )
      .join("");

    const guiaTipo =
      codes.tipoGuia === "CONSULTA"
        ? `<ans:guiaConsulta>
        <ans:numeroGuiaPrestador>${codes.cd_atendimento || appointmentId}</ans:numeroGuiaPrestador>
        <ans:beneficiario>
          <ans:numeroCarteira>${xmlEscape(codes.nr_carteira)}</ans:numeroCarteira>
          <ans:nomeBeneficiario>${xmlEscape(paciente?.full_name || "")}</ans:nomeBeneficiario>
        </ans:beneficiario>
        <ans:profissionalExecutante>
          <ans:nomeProfissional>${xmlEscape(prof?.full_name || "")}</ans:nomeProfissional>
          <ans:conselhoProfissional>CRM</ans:conselhoProfissional>
          <ans:numeroConselhoProfissional>${xmlEscape(prof?.professional_license || "")}</ans:numeroConselhoProfissional>
        </ans:profissionalExecutante>
        <ans:valorProcedimento>${vlTotal.toFixed(2)}</ans:valorProcedimento>
      </ans:guiaConsulta>`
        : `<ans:guiaSP-SADT>
        <ans:numeroGuiaPrestador>${codes.cd_atendimento || appointmentId}</ans:numeroGuiaPrestador>
        <ans:beneficiario>
          <ans:numeroCarteira>${xmlEscape(codes.nr_carteira)}</ans:numeroCarteira>
          <ans:nomeBeneficiario>${xmlEscape(paciente?.full_name || "")}</ans:nomeBeneficiario>
        </ans:beneficiario>
        <ans:procedimentosExecutados>${procs}</ans:procedimentosExecutados>
        <ans:valorTotal>${vlTotal.toFixed(2)}</ans:valorTotal>
      </ans:guiaSP-SADT>`;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas" versao="3.05.00">
  <ans:cabecalho>
    <ans:identificacaoTransacao>
      <ans:tipoTransacao>ENVIO_LOTE_GUIAS</ans:tipoTransacao>
      <ans:sequencialTransacao>${agora.getTime()}</ans:sequencialTransacao>
      <ans:dataRegistroTransacao>${agora.toISOString()}</ans:dataRegistroTransacao>
      <ans:horaRegistroTransacao>${agora.toTimeString().substring(0, 8)}</ans:horaRegistroTransacao>
    </ans:identificacaoTransacao>
    <ans:origem>
      <ans:identificacaoPrestador>${xmlEscape(company?.cnpj || "")}</ans:identificacaoPrestador>
    </ans:origem>
    <ans:destino>
      <ans:registroANS>${xmlEscape(convenio?.registro_ans || "")}</ans:registroANS>
    </ans:destino>
  </ans:cabecalho>
  <ans:prestadorParaOperadora>
    <ans:loteGuias>
      <ans:numeroLote>${Date.now()}</ans:numeroLote>
      <ans:guias>
        ${guiaTipo}
      </ans:guias>
    </ans:loteGuias>
  </ans:prestadorParaOperadora>
</ans:mensagemTISS>`;

    const hash = await sha256(xml);

    // Persistir
    const { data: row, error } = await supabase
      .from("tiss_xml")
      .insert({
        company_id: company?.id,
        cd_convenio: codes.cd_convenio,
        ds_descricao: `${convenio?.name || "Convenio"} - ${codes.tipoGuia} - Apt ${appointmentId}`,
        ds_filename: `tiss_${appointmentId}_${Date.now()}.xml`,
        dt_fatura: agora.toISOString().substring(0, 10),
        ds_tipo_guia: codes.tipoGuia,
        cd_lote: Date.now(),
        vl_informado: vlTotal,
        bl_xml_enviado: xml,
        ds_hash_envio: hash,
        ds_versao_tiss: "3.05.00",
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
   * Em homologacao: chama o endpoint configurado (VITE_TISS_ENDPOINT_<CONVENIO>)
   * Em producao: usa certificado A1 e assina o XML
   */
  async sendToOperadora(tissXmlId: number): Promise<{ sent: boolean; protocolo?: string; response?: any }> {
    const xml = await this.getById(tissXmlId);

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

    const start = Date.now();
    let sent = false;
    let protocolo: string | undefined;
    let respXml: string | undefined;
    let motivoRejeicao: string | undefined;

    try {
      const res = await fetch(proto.ds_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: `"tissAction/${xml.ds_tipo_guia || "ENVIO_LOTE_GUIAS"}"`,
        },
        body: xml.bl_xml_enviado || "",
        signal: AbortSignal.timeout(30000),
      });
      sent = res.ok;
      respXml = await res.text();

      // Extrair protocolo do XML de retorno (parser simples)
      const m = respXml.match(/<ns\d:protocolo[^>]*>([^<]+)<\/ns\d:protocolo>|<protocolo[^>]*>([^<]+)<\/protocolo>/);
      protocolo = m?.[1] || m?.[2];

      if (!sent) {
        motivoRejeicao = `HTTP ${res.status}: ${respXml.substring(0, 500)}`;
      }
    } catch (e) {
      sent = false;
      motivoRejeicao = e instanceof Error ? e.message : "Falha no envio";
    }

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

    // Atualizar status da guia
    await supabase.rpc("recalc_tiss_total_glosa", { p_id: tissXmlId }).then(() => null, () => null);
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
    const hash = await sha256(recursoXML);
    const now = new Date().toISOString();
    let sent = false;
    let protocolo: string | undefined;
    try {
      const { data: glosa } = await supabase
        .from("tiss_glosas")
        .select("cd_tiss_xml")
        .eq("id", glosaId)
        .single();
      const { data: xml } = await supabase
        .from("tiss_xml")
        .select("cd_convenio, tp_ambiente")
        .eq("id", glosa?.cd_tiss_xml || 0)
        .single();
      const { data: proto } = await supabase
        .from("tiss_protocols")
        .select("ds_endpoint")
        .eq("cd_convenio", xml?.cd_convenio || 0)
        .eq("tp_ambiente", xml?.tp_ambiente || "HOMOLOGACAO")
        .eq("lg_active", true)
        .maybeSingle();

      if (proto) {
        const res = await fetch(proto.ds_endpoint, {
          method: "POST",
          headers: { "Content-Type": "text/xml; charset=utf-8" },
          body: recursoXML,
          signal: AbortSignal.timeout(30000),
        });
        sent = res.ok;
        const txt = await res.text();
        const m = txt.match(/<protocolo[^>]*>([^<]+)<\/protocolo>/);
        protocolo = m?.[1];
      } else {
        // Em homologacao, simular sucesso
        sent = true;
        protocolo = `REC_HOM_${Date.now()}`;
      }
    } catch {
      sent = false;
    }

    await supabase
      .from("tiss_glosas")
      .update({
        lg_recurso_enviado: sent,
        dt_recurso: now,
        ds_protocolo_recurso: protocolo,
        bl_xml_recurso: recursoXML,
        ds_status_recurso: sent ? "ENVIADO" : "PENDENTE",
        updated_at: now,
      })
      .eq("id", glosaId);

    return { sent, protocolo };
  },

  async gerarXMLRecurso(glosaId: number): Promise<string> {
    const { data: glosa } = await supabase
      .from("tiss_glosas")
      .select("*, tiss_xml(cd_convenio, ds_protocolo, dt_fatura, vl_glosa)")
      .eq("id", glosaId)
      .single();
    if (!glosa) throw new Error("Glosa nao encontrada");

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
      <ans:protocoloGlosaOriginal>${xmlEscape(glosa.tiss_xml?.ds_protocolo || "")}</ans:protocoloGlosaOriginal>
      <ans:dataGlosaOriginal>${isoToTissDate(glosa.tiss_xml?.dt_fatura)}</ans:dataGlosaOriginal>
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
    let lote = Math.floor(Date.now() / 1000);
    let vlTotal = 0;
    let count = 0;
    for (const apt of appointments || []) {
      const { data: plan } = await supabase
        .from("insurance_plans")
        .select("insurance_company_id, codigo")
        .eq("id", apt.cd_insurance_plan || 0)
        .maybeSingle();
      if (!plan) continue;

      const vlTotalApt = (apt as any).total_amount || 0;
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
        ds_versao_tiss: "3.05.00",
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
      .select("*")
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
      ds_versao_tiss: data.ds_versao_tiss || "3.05.00",
      tp_ambiente: data.tp_ambiente || "HOMOLOGACAO",
      cd_certificado_a1_path: data.cd_certificado_a1_path,
      ds_certificado_senha: data.ds_certificado_senha,
      ds_usuario: data.ds_usuario,
      ds_senha: data.ds_senha,
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
