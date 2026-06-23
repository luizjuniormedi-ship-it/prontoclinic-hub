/**
 * assinaturaDigitalService — Assinatura Digital ICP-Brasil
 *
 * Migration relacionada: 20260101000026_assinatura_digital.sql
 *
 * Decisões:
 *   - Chave privada NUNCA é armazenada — apenas o hash e metadados
 *   - Hash SHA-256 garante integridade do documento
 *   - Assinatura PKCS#7 (base64) garante autenticidade + não-repúdio
 *   - Log imutável (LGPD: rastreabilidade total)
 *   - Validação de data de validade + revogação
 *
 * Conformidade:
 *   - MP 2.200-2/2001 (ICP-Brasil)
 *   - Resolução CFM 2.314/2022 (prontuário digital)
 *   - Lei 14.063/2020 (assinaturas eletrônicas)
 *
 * Importante:
 *   A assinatura real (geração do PKCS#7) acontece CLIENT-SIDE via
 *   biblioteca @signpdf ou WebCrypto API. Este service apenas armazena
 *   e valida metadados.
 */

import { z } from "zod";
import { supabase } from "@/lib/supabase";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const tpCertificadoEnum = z.enum(["A1", "A3", "ICP_BRASIL"]);

export const tpDocumentoEnum = z.enum([
  "RECEITA",
  "ATESTADO",
  "LAUDO",
  "PRESCRICAO",
  "RELATORIO",
  "TERMO_CONSENTIMENTO",
  "OUTRO",
]);

export const certificadoSchema = z.object({
  cd_profissional: z.number().int().positive(),
  tp_certificado: tpCertificadoEnum,
  nr_serie: z.string().min(1, "Número de série obrigatório").max(100),
  cd_emissor: z.string().max(100).optional().nullable(),
  dt_validade_inicio: z.string().min(1, "Data de início obrigatória"),
  dt_validade_fim: z.string().min(1, "Data de fim obrigatória"),
  ds_arquivo_url: z.string().url().optional().nullable(),
  lg_ativo: z.boolean().default(true),
});

export const documentoAssinadoSchema = z.object({
  cd_certificado: z.number().int().positive(),
  cd_profissional: z.number().int().positive(),
  tp_documento: tpDocumentoEnum,
  cd_documento_origem: z.number().int().positive().optional().nullable(),
  ds_hash_documento: z.string().regex(/^[a-f0-9]{64}$/, "Hash deve ser SHA-256 (64 hex chars)"),
  ds_hash_assinatura: z.string().min(1, "Hash da assinatura obrigatório").max(256),
  ds_assinatura_p7s: z.string().min(1, "Assinatura PKCS#7 obrigatória"),
  ip_origem: z.string().optional().nullable(),
  cd_autoridade_certificadora: z.string().max(100).optional().nullable(),
  nr_protocolo_ans: z.string().max(50).optional().nullable(),
});

export const revogacaoSchema = z.object({
  ds_motivo_revogacao: z.string().min(5, "Motivo deve ter ao menos 5 caracteres"),
});

// ── Types ───────────────────────────────────────────────────────────────────

export type Certificado = z.infer<typeof certificadoSchema> & {
  id: number;
  company_id: string;
  lg_revogado: boolean;
  dt_revogacao: string | null;
  ds_motivo_revogacao: string | null;
  cd_origem_sigh?: number | null;
  created_at: string;
};

export type DocumentoAssinado = z.infer<typeof documentoAssinadoSchema> & {
  id: string;
  company_id: string;
  dt_assinatura: string;
  lg_valido: boolean;
  dt_validacao: string | null;
  ds_motivo_invalidacao: string | null;
  cd_origem_sigh?: number | null;
  created_at: string;
};

export type AssinaturaAuditoria = {
  id: string;
  company_id: string;
  cd_profissional: number;
  ds_profissional: string;
  tp_documento: z.infer<typeof tpDocumentoEnum>;
  ds_hash_documento: string;
  dt_assinatura: string;
  ip_origem: string | null;
  lg_valido: boolean;
  tp_certificado: z.infer<typeof tpCertificadoEnum>;
  nr_serie: string;
  cd_emissor: string | null;
  dt_validade_fim: string;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Calcula o hash SHA-256 de uma string usando Web Crypto API.
 * Disponível em browsers e Node 18+.
 */
export async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Calcula o IP do cliente (browser) — caso esteja disponível.
 */
export async function getClientIP(): Promise<string | null> {
  try {
    const res = await fetch("https://api.ipify.org?format=json", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { ip?: string };
    return data.ip ?? null;
  } catch {
    return null;
  }
}

/**
 * Verifica se o certificado está válido (não revogado e dentro da validade).
 */
export function certificadoValido(cert: Certificado, agora: Date = new Date()): boolean {
  if (!cert.lg_ativo || cert.lg_revogado) return false;
  const inicio = new Date(cert.dt_validade_inicio);
  const fim = new Date(cert.dt_validade_fim);
  return agora >= inicio && agora <= fim;
}

// ── Services ────────────────────────────────────────────────────────────────

export const certificadosService = {
  async getAll(ativo = true): Promise<Certificado[]> {
    let q = supabase
      .from("certificados_digitais")
      .select("*")
      .order("dt_validade_fim", { ascending: false });
    if (ativo) q = q.eq("lg_ativo", true);
    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as Certificado[];
  },

  async getByProfissional(cdProfissional: number): Promise<Certificado | null> {
    const { data, error } = await supabase
      .from("certificados_digitais")
      .select("*")
      .eq("cd_profissional", cdProfissional)
      .eq("lg_ativo", true)
      .eq("lg_revogado", false)
      .order("dt_validade_fim", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data as Certificado) ?? null;
  },

  async getById(id: number): Promise<Certificado | null> {
    const { data, error } = await supabase
      .from("certificados_digitais")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data as Certificado) ?? null;
  },

  async create(input: z.infer<typeof certificadoSchema>): Promise<Certificado> {
    const parsed = certificadoSchema.parse(input);
    // Validação cruzada
    if (new Date(parsed.dt_validade_fim) <= new Date(parsed.dt_validade_inicio)) {
      throw new Error("Data de fim deve ser posterior à data de início.");
    }
    const { data, error } = await supabase
      .from("certificados_digitais")
      .insert(parsed)
      .select()
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new Error("Já existe um certificado com este número de série para este profissional.");
      }
      throw new Error(`Erro: ${error.message}`);
    }
    return data as Certificado;
  },

  async revogar(id: number, input: z.infer<typeof revogacaoSchema>): Promise<Certificado> {
    const parsed = revogacaoSchema.parse(input);
    const { data, error } = await supabase
      .from("certificados_digitais")
      .update({
        lg_revogado: true,
        lg_ativo: false,
        dt_revogacao: new Date().toISOString(),
        ds_motivo_revogacao: parsed.ds_motivo_revogacao,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as Certificado;
  },
};

export const documentosAssinadosService = {
  /**
   * Registra um documento assinado digitalmente.
   * Espera que ds_hash_documento, ds_hash_assinatura e ds_assinatura_p7s
   * tenham sido gerados CLIENT-SIDE (browser) usando a chave privada.
   */
  async create(input: z.infer<typeof documentoAssinadoSchema>): Promise<DocumentoAssinado> {
    const parsed = documentoAssinadoSchema.parse(input);
    const { data, error } = await supabase
      .from("documentos_assinados")
      .insert({
        ...parsed,
        dt_assinatura: new Date().toISOString(),
        lg_valido: true,
        dt_validacao: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(`Erro ao registrar documento assinado: ${error.message}`);
    return data as DocumentoAssinado;
  },

  async getByDocumentoOrigem(
    tpDocumento: z.infer<typeof tpDocumentoEnum>,
    cdDocumentoOrigem: number,
  ): Promise<DocumentoAssinado | null> {
    const { data, error } = await supabase
      .from("documentos_assinados")
      .select("*")
      .eq("tp_documento", tpDocumento)
      .eq("cd_documento_origem", cdDocumentoOrigem)
      .order("dt_assinatura", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data as DocumentoAssinado) ?? null;
  },

  async getByProfissional(cdProfissional: number, limit = 50): Promise<DocumentoAssinado[]> {
    const { data, error } = await supabase
      .from("documentos_assinados")
      .select("*")
      .eq("cd_profissional", cdProfissional)
      .order("dt_assinatura", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as DocumentoAssinado[];
  },

  async getAuditoria(filters?: { tp_documento?: z.infer<typeof tpDocumentoEnum> }): Promise<AssinaturaAuditoria[]> {
    let q = supabase
      .from("v_assinaturas_auditoria")
      .select("*")
      .order("dt_assinatura", { ascending: false })
      .limit(500);
    if (filters?.tp_documento) q = q.eq("tp_documento", filters.tp_documento);
    const { data, error } = await q;
    if (error) throw new Error(`Erro: ${error.message}`);
    return (data ?? []) as AssinaturaAuditoria[];
  },

  /**
   * Invalida um documento assinado (ex: certificado revogado retroativamente).
   */
  async invalidar(id: string, motivo: string): Promise<DocumentoAssinado> {
    if (!motivo || motivo.trim().length < 5) {
      throw new Error("Motivo da invalidação deve ter ao menos 5 caracteres.");
    }
    const { data, error } = await supabase
      .from("documentos_assinados")
      .update({
        lg_valido: false,
        ds_motivo_invalidacao: motivo,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as DocumentoAssinado;
  },
};

export const assinaturaDigitalService = {
  certificados: certificadosService,
  documentos: documentosAssinadosService,
  sha256,
  getClientIP,
  certificadoValido,
};
