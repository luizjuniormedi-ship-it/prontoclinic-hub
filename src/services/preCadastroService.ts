/**
 * preCadastroService.ts
 *
 * Modulo de pre-cadastro online de pacientes (PWA publico).
 *
 * Espelha e moderniza o SIGH.pre_cadastro (estrutura vazia).
 * Feature critica que o SIGH nao tem — permite sign-up publico
 * com confirmacao por e-mail (72h de validade) e migracao para
 * paciente definitivo via admin/recepcao.
 *
 * Operacoes:
 *   - criar(dados)            -> RPC create_pre_cadastro
 *   - confirmar(token)        -> RPC confirm_pre_cadastro
 *   - buscarPorToken(token)   -> RPC pre_confirm_pre_cadastro
 *   - listarPendentes(companyId) -> SELECT pre_cadastros_pendentes
 *   - listar(companyId, filtros)
 *   - promoverParaPaciente(id) -> RPC promote_pre_cadastro
 *   - reenviarEmail(id)        -> RPC renew_pre_cadastro_confirmation + email
 *   - cancelar(id, motivo)     -> RPC cancel_pre_cadastro
 *   - validarForm(dados)       -> Zod
 *
 * LGPD:
 *   - Hash SHA-256 do termo (prova de ciencia)
 *   - IP + user_agent capturados
 *   - Soft delete (status = CANCELADO), nunca hard delete
 *
 * Migration relacionada: supabase/migrations/20260101000011_pre_cadastro.sql
 */

import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { env } from "@/lib/env";
import { emailService } from "./emailService";

// =============================================================================
// Enums
// =============================================================================

export const PRE_CADASTRO_STATUS = [
  "PENDENTE",
  "CONFIRMADO",
  "EXPIRADO",
  "CANCELADO",
  "MIGRADO",
] as const;
export type PreCadastroStatus = (typeof PRE_CADASTRO_STATUS)[number];

export const GENDER = ["M", "F", "O"] as const;
export type Gender = (typeof GENDER)[number];

export const UF_BRASIL = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;
export type UF = (typeof UF_BRASIL)[number];

// =============================================================================
// Interfaces
// =============================================================================

export interface PreCadastro {
  id: string;
  company_id: string;
  full_name: string;
  cpf: string | null;
  cpf_hash: string | null;
  birth_date: string | null;
  gender: Gender | null;
  email: string;
  email_hash: string | null;
  phone: string | null;
  whatsapp: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: UF | null;
  ibge_cidade: string | null;
  lg_aceite_termo: boolean;
  dt_aceite_termo: string | null;
  versao_termo: string;
  texto_termo_hash: string;
  ip_origem: string | null;
  user_agent: string | null;
  token_confirmacao: string;
  dt_token_exp: string;
  lg_confirmado: boolean;
  dt_confirmacao: string | null;
  cd_paciente_final: number | null;
  dt_migracao: string | null;
  status: PreCadastroStatus;
  tentativas_confirmacao: number;
  dt_ultimo_envio: string | null;
  motivo_cancelamento: string | null;
  created_at: string;
  updated_at: string;
}

export interface PreCadastroPendente extends PreCadastro {
  horas_para_expirar: number;
}

export interface PreCadastroFormData {
  full_name: string;
  email: string;
  phone: string;
  whatsapp?: string;
  cpf?: string;
  birth_date: string;       // YYYY-MM-DD
  gender: Gender;
  cep: string;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: UF;
  ibge_cidade?: string;
  lg_aceite_termo: boolean;
  versao_termo: string;
}

export interface CriarPreCadastroResult {
  id: string;
  token: string;
  dt_exp: string;
  linkConfirmacao: string;
}

export type PreCadastroFormErrors = Partial<Record<keyof PreCadastroFormData, string>>;

// =============================================================================
// Validacao (Zod)
// =============================================================================

/** Validador de CPF (modulo 11) */
function isValidCPF(cpf: string): boolean {
  cpf = cpf.replace(/\D/g, "");
  if (cpf.length !== 11) return false;
  if (/^(\d)\1+$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i], 10) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(cpf[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i], 10) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === parseInt(cpf[10], 10);
}

/** Texto canonico do termo de pre-cadastro (LGPD) */
export const TEXTO_TERMO_PRE_CADASTRO = `
TERMO DE CONSENTIMENTO PARA PRE-CADASTRO DE PACIENTE
(Lei 13.709/2018 — LGPD)

Ao prosseguir com este pre-cadastro, autorizo a coleta e o tratamento
dos meus dados pessoais (nome, data de nascimento, sexo, CPF, telefone,
e-mail e endereco) para finalidades de:

  a) Identificacao e cadastro no sistema da clinica;
  b) Agendamento de consultas e exames;
  c) Comunicacao sobre agendamentos, lembretes e resultados;
  d) Cumprimento de obrigacoes legais e regulatorias (CFM, ANS).

Meus dados serao armazenados em ambiente seguro (Supabase/PostgreSQL)
com criptografia em transito (TLS 1.2+) e em repouso, e o acesso sera
restrito a profissionais autorizados da clinica.

Posso revogar este consentimento a qualquer momento, solicitar acesso,
correcao, portabilidade ou eliminacao dos meus dados (LGPD art. 18),
encaminhando solicitacao por escrito a clinica.

Este pre-cadastro NAO substitui o atendimento medico nem o cadastro
definitivo. O preenchimento e de minha inteira responsabilidade,
garantindo a veracidade das informacoes prestadas.
`.trim();

/** Versao do termo — incrementada quando ha mudanca substantiva */
export const VERSAO_TERMO_PRE_CADASTRO = "v1.0-2026-06-22";

/** Computa SHA-256 do termo (browser) */
async function hashTermoPreCadastro(): Promise<string> {
  const enc = new TextEncoder().encode(TEXTO_TERMO_PRE_CADASTRO);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const preCadastroSchema = z.object({
  full_name: z
    .string()
    .min(3, "Nome deve ter no minimo 3 caracteres")
    .max(200, "Nome deve ter no maximo 200 caracteres")
    .regex(/^[A-Za-zÀ-ÿ\s'-]+$/, "Nome contem caracteres invalidos"),
  email: z
    .string()
    .email("E-mail invalido")
    .max(255, "E-mail muito longo")
    .transform((v) => v.toLowerCase().trim()),
  phone: z
    .string()
    .regex(/^\+?[\d\s()-]{10,20}$/, "Telefone invalido (formato BR: (11) 99999-9999)"),
  whatsapp: z.string().optional(),
  cpf: z
    .string()
    .optional()
    .refine(
      (v) => !v || isValidCPF(v),
      "CPF invalido (digitos verificadores nao conferem)",
    ),
  birth_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD")
    .refine((v) => {
      const d = new Date(v + "T00:00:00");
      if (isNaN(d.getTime())) return false;
      const now = new Date();
      if (d > now) return false;
      const age = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      return age >= 0 && age <= 130;
    }, "Data de nascimento invalida (nao pode ser futura; max 130 anos)"),
  gender: z.enum(GENDER, { errorMap: () => ({ message: "Sexo invalido" }) }),
  cep: z
    .string()
    .regex(/^\d{5}-?\d{3}$/, "CEP invalido (formato: 00000-000)")
    .transform((v) => v.replace(/\D/g, "")),
  logradouro: z.string().min(2, "Logradouro obrigatorio").max(200),
  numero: z.string().min(1, "Numero obrigatorio").max(20),
  complemento: z.string().max(100).optional(),
  bairro: z.string().min(2, "Bairro obrigatorio").max(100),
  cidade: z.string().min(2, "Cidade obrigatoria").max(100),
  uf: z.enum(UF_BRASIL, { errorMap: () => ({ message: "UF invalida" }) }),
  ibge_cidade: z.string().regex(/^\d{6,7}$/).optional(),
  lg_aceite_termo: z.literal(true, {
    errorMap: () => ({ message: "Voce precisa aceitar o termo de uso" }),
  }),
  versao_termo: z.string().min(1),
});

// =============================================================================
// Helpers
// =============================================================================

/** Detecta IP do cliente (no navegador, via servico externo) */
async function getClientIp(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as { ip?: string };
    return data.ip ?? null;
  } catch {
    return null;
  }
}

function getUserAgent(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent.slice(0, 500);
}

/** Constroi link publico de confirmacao */
function buildConfirmLink(token: string): string {
  const base = env.VITE_APP_URL ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/pre-cadastro/confirmar?token=${encodeURIComponent(token)}`;
}

/** Resolve o tenant publico sem inferencia ou consulta cross-tenant. */
function resolveCompanyId(explicitCompanyId?: string): string {
  const companyId = explicitCompanyId ?? env.VITE_PUBLIC_COMPANY_ID;
  if (!companyId) {
    throw new Error(
      "Empresa do pre-cadastro nao configurada. Informe companyId explicitamente " +
        "ou configure VITE_PUBLIC_COMPANY_ID com um UUID valido.",
    );
  }

  const parsed = z.string().uuid().safeParse(companyId);
  if (!parsed.success) {
    throw new Error(
      "Empresa do pre-cadastro invalida: companyId/VITE_PUBLIC_COMPANY_ID deve ser um UUID valido.",
    );
  }
  return parsed.data;
}

// =============================================================================
// Service
// =============================================================================

export const preCadastroService = {
  // ---------------------------------------------------------------------------
  // 1. Criar pre-cadastro (sign-up publico)
  // ---------------------------------------------------------------------------
  async criar(
    formData: PreCadastroFormData,
    opts: { companyId?: string; sendEmail?: boolean } = {},
  ): Promise<CriarPreCadastroResult> {
    const parsed = preCadastroSchema.parse(formData);

    const companyId = resolveCompanyId(opts.companyId);
    const textoHash = await hashTermoPreCadastro();
    const ipOrigem = await getClientIp();
    const userAgent = getUserAgent();

    const { data, error } = await supabase.rpc("create_pre_cadastro", {
      p_company_id: companyId,
      p_full_name: parsed.full_name,
      p_email: parsed.email,
      p_phone: parsed.phone,
      p_cpf: parsed.cpf?.replace(/\D/g, "") ?? null,
      p_whatsapp: parsed.whatsapp ?? null,
      p_birth_date: parsed.birth_date,
      p_gender: parsed.gender,
      p_cep: parsed.cep,
      p_logradouro: parsed.logradouro,
      p_numero: parsed.numero,
      p_complemento: parsed.complemento ?? null,
      p_bairro: parsed.bairro,
      p_cidade: parsed.cidade,
      p_uf: parsed.uf,
      p_ibge_cidade: parsed.ibge_cidade ?? null,
      p_versao_termo: parsed.versao_termo,
      p_texto_termo_hash: textoHash,
      p_ip_origem: ipOrigem,
      p_user_agent: userAgent,
    });

    if (error) {
      throw new Error(`Falha ao criar pre-cadastro: ${error.message}`);
    }

    type RpcRow = { id: string; token: string; dt_exp: string };
    const row = Array.isArray(data) ? (data[0] as RpcRow) : (data as RpcRow);
    if (!row) {
      throw new Error("Resposta invalida do servidor (sem id/token)");
    }

    const linkConfirmacao = buildConfirmLink(row.token);

    if (opts.sendEmail !== false) {
      try {
        await emailService.sendPreCadastroConfirmation({
          to: parsed.email,
          nome: parsed.full_name,
          linkConfirmacao,
          dtExp: row.dt_exp,
        });
      } catch (err) {
        // Nao bloquear o sign-up se o email falhar — apenas logar
        console.error("[pre-cadastro] falha ao enviar email de confirmacao", err);
      }
    }

    return {
      id: row.id,
      token: row.token,
      dt_exp: row.dt_exp,
      linkConfirmacao,
    };
  },

  // ---------------------------------------------------------------------------
  // 2. Confirmar pre-cadastro (clica no link do email)
  // ---------------------------------------------------------------------------
  async confirmar(token: string): Promise<{
    id: string;
    full_name: string;
    email: string;
    status: PreCadastroStatus;
    company_id: string;
  }> {
    if (!token || token.length < 16) {
      throw new Error("Token invalido");
    }

    const { data, error } = await supabase.rpc("confirm_pre_cadastro", {
      p_token: token,
    });

    if (error) {
      // Erros comuns: "Token invalido", "Token expirado", "ja processado"
      throw new Error(error.message);
    }

    type RpcRow = {
      id: string;
      full_name: string;
      email: string;
      status: PreCadastroStatus;
      company_id: string;
    };
    const row = Array.isArray(data) ? (data[0] as RpcRow) : (data as RpcRow);
    if (!row) {
      throw new Error("Resposta invalida do servidor");
    }

    // E-mail de boas-vindas (fire-and-forget)
    void emailService.sendWelcome(row.email, row.full_name).catch((err) => {
      console.error("[pre-cadastro] falha ao enviar welcome", err);
    });

    return row;
  },

  // ---------------------------------------------------------------------------
  // 3. Buscar pre-cadastro por token (para exibir antes de confirmar)
  // ---------------------------------------------------------------------------
  async buscarPorToken(token: string): Promise<Partial<PreCadastro> | null> {
    if (!token || token.length < 16) return null;

    const { data, error } = await supabase.rpc("pre_confirm_pre_cadastro", {
      p_token: token,
    });

    if (error) {
      if (error.code === "PGRST116" || /row-level security/i.test(error.message)) {
        return null;
      }
      console.warn("[pre-cadastro] buscarPorToken falhou", error);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return (row as Partial<PreCadastro> | undefined) ?? null;
  },

  // ---------------------------------------------------------------------------
  // 4. Listar pendentes (admin/recepcao)
  // ---------------------------------------------------------------------------
  async listarPendentes(companyId?: string): Promise<PreCadastroPendente[]> {
    const targetCompanyId = resolveCompanyId(companyId);

    const { data, error } = await supabase
      .from("pre_cadastros_pendentes")
      .select("*")
      .eq("company_id", targetCompanyId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Erro ao listar pendentes: ${error.message}`);
    return (data ?? []) as PreCadastroPendente[];
  },

  // ---------------------------------------------------------------------------
  // 5. Listar todos (admin) com filtros
  // ---------------------------------------------------------------------------
  async listar(
    companyId?: string,
    filtros?: { status?: PreCadastroStatus; limit?: number },
  ): Promise<PreCadastro[]> {
    const targetCompanyId = resolveCompanyId(companyId);

    let query = supabase
      .from("pre_cadastro")
      .select("*")
      .eq("company_id", targetCompanyId)
      .order("created_at", { ascending: false })
      .limit(filtros?.limit ?? 100);

    if (filtros?.status) {
      query = query.eq("status", filtros.status);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Erro ao listar pre-cadastros: ${error.message}`);
    return (data ?? []) as PreCadastro[];
  },

  // ---------------------------------------------------------------------------
  // 6. Promover para paciente definitivo
  // ---------------------------------------------------------------------------
  async promoverParaPaciente(preCadastroId: string): Promise<number> {
    if (!preCadastroId) throw new Error("preCadastroId obrigatorio");

    const { data, error } = await supabase.rpc("promote_pre_cadastro", {
      p_id: preCadastroId,
    });

    if (error) throw new Error(`Falha ao promover: ${error.message}`);
    if (data === null || data === undefined) {
      throw new Error("Resposta invalida do servidor");
    }
    return Number(data);
  },

  // ---------------------------------------------------------------------------
  // 7. Reenviar email de confirmacao (renova token)
  // ---------------------------------------------------------------------------
  async reenviarEmail(preCadastroId: string): Promise<{ linkConfirmacao: string }> {
    if (!preCadastroId) throw new Error("preCadastroId obrigatorio");

    const { data, error } = await supabase.rpc(
      "renew_pre_cadastro_confirmation",
      { p_id: preCadastroId },
    );

    if (error) throw new Error(`Falha ao reenviar: ${error.message}`);

    type RpcRow = {
      token: string;
      dt_exp: string;
      email: string;
      full_name: string;
    };
    const row = Array.isArray(data) ? (data[0] as RpcRow) : (data as RpcRow);
    if (!row?.token || !row.dt_exp || !row.email || !row.full_name) {
      throw new Error("Resposta invalida do servidor");
    }

    const linkConfirmacao = buildConfirmLink(row.token);

    await emailService.sendPreCadastroConfirmation({
      to: row.email,
      nome: row.full_name,
      linkConfirmacao,
      dtExp: row.dt_exp,
    });

    return { linkConfirmacao };
  },

  // ---------------------------------------------------------------------------
  // 8. Cancelar pre-cadastro
  // ---------------------------------------------------------------------------
  async cancelar(preCadastroId: string, motivo: string): Promise<boolean> {
    if (!preCadastroId) throw new Error("preCadastroId obrigatorio");
    if (!motivo || motivo.trim().length === 0) {
      throw new Error("Motivo do cancelamento e obrigatorio");
    }

    const { data, error } = await supabase.rpc("cancel_pre_cadastro", {
      p_id: preCadastroId,
      p_motivo: motivo.trim(),
    });

    if (error) throw new Error(`Falha ao cancelar: ${error.message}`);
    return Boolean(data);
  },

  // ---------------------------------------------------------------------------
  // 9. Validar form (cliente-side, antes de enviar)
  // ---------------------------------------------------------------------------
  validarForm(dados: Partial<PreCadastroFormData>): PreCadastroFormErrors {
    const result = preCadastroSchema.safeParse(dados);
    if (result.success) return {};
    const errors: PreCadastroFormErrors = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof PreCadastroFormData;
      if (!errors[key]) errors[key] = issue.message;
    }
    return errors;
  },

  // ---------------------------------------------------------------------------
  // 10. Expor constante do termo (para exibicao no modal)
  // ---------------------------------------------------------------------------
  getTextoTermo(): string {
    return TEXTO_TERMO_PRE_CADASTRO;
  },

  getVersaoTermo(): string {
    return VERSAO_TERMO_PRE_CADASTRO;
  },
};

export default preCadastroService;

