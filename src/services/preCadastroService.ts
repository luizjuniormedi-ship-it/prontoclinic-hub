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
 *   - criar(dados)            -> Edge Function pre-cadastro
 *   - confirmar(token)        -> Edge Function pre-cadastro
 *   - buscarPorToken(token)   -> Edge Function pre-cadastro
 *   - listarPendentes(companyId) -> SELECT pre_cadastros_pendentes
 *   - listar(companyId, filtros)
 *   - promoverParaPaciente(id) -> RPC promote_pre_cadastro
 *   - reenviarEmail(id)        -> UPDATE (renova token) + dispara email
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
  token_confirmacao: string | null;
  token_confirmacao_hash?: string | null;
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
  accepted: true;
}

export type PreCadastroFormErrors = Partial<Record<keyof PreCadastroFormData, string>>;

const PRE_CADASTRO_OPERATIONAL_COLUMNS = [
  "id", "company_id", "full_name", "cpf", "birth_date", "gender", "email",
  "phone", "whatsapp", "cep", "logradouro", "numero", "complemento", "bairro",
  "cidade", "uf", "ibge_cidade", "lg_aceite_termo", "dt_aceite_termo",
  "versao_termo", "dt_token_exp", "lg_confirmado", "dt_confirmacao",
  "cd_paciente_final", "dt_migracao", "status", "tentativas_confirmacao",
  "dt_ultimo_envio", "motivo_cancelamento", "created_at", "updated_at",
].join(", ");

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

async function requestKeyFor(form: { email: string; cpf?: string; versao_termo: string }): Promise<{ key: string; storageKey: string }> {
  const fingerprint = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({
      email: form.email.toLowerCase().trim(),
      cpf: form.cpf?.replace(/\D/g, "") ?? "",
      versao: form.versao_termo,
    })),
  );
  const digest = Array.from(new Uint8Array(fingerprint), (value) => value.toString(16).padStart(2, "0")).join("");
  const storageKey = `prontomedic:pre-cadastro:${digest}`;
  const existing = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(storageKey);
  const key = existing && /^[0-9a-f-]{36}$/i.test(existing) ? existing : crypto.randomUUID();
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(storageKey, key);
  return { key, storageKey };
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

/** Resolve companyId padrao (em producao, vir de um mapping dominio->empresa) */
async function resolveCompanyId(explicitCompanyId?: string): Promise<string> {
  if (explicitCompanyId) return explicitCompanyId;

  // Fallback: pega primeira empresa ativa (dev/single-tenant)
  // Schema real da tabela `companies` (migration 00000) usa `lg_ativo`,
  // NAO `status`. Filtro corrigido para casar com a coluna existente.
  const { data, error } = await supabase
    .from("companies")
    .select("id")
    .eq("lg_ativo", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao buscar empresa ativa: ${error.message}`);
  }
  if (!data) {
    throw new Error(
      "Nenhuma empresa ativa encontrada para pre-cadastro. " +
        "Cadastre uma empresa com lg_ativo=true ou passe companyId explicito.",
    );
  }
  return (data as { id: string }).id;
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
    _opts: { companyId?: string; sendEmail?: boolean } = {},
  ): Promise<CriarPreCadastroResult> {
    const parsed = preCadastroSchema.parse(formData) as PreCadastroFormData;
    const textoHash = await hashTermoPreCadastro();
    const { key: requestKey, storageKey } = await requestKeyFor(parsed);
    const { data, error } = await supabase.functions.invoke("pre-cadastro", {
      headers: { "Idempotency-Key": requestKey },
      body: { action: "request", ...parsed, texto_termo_hash: textoHash },
    });

    if (error) {
      throw new Error("Falha ao enviar o pré-cadastro. Tente novamente sem alterar os dados.");
    }
    if (data?.accepted !== true) throw new Error("Resposta inválida do serviço de pré-cadastro.");
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(storageKey);
    return { accepted: true };
  },

  // ---------------------------------------------------------------------------
  // 2. Confirmar pre-cadastro (clica no link do email)
  // ---------------------------------------------------------------------------
  async confirmar(token: string): Promise<{ status: PreCadastroStatus }> {
    if (!token || token.length < 16) {
      throw new Error("Token invalido");
    }

    const { data, error } = await supabase.functions.invoke("pre-cadastro", {
      body: { action: "confirm", token },
    });

    if (error) {
      // Erros comuns: "Token invalido", "Token expirado", "ja processado"
      throw new Error(error.message);
    }

    if (!PRE_CADASTRO_STATUS.includes(data?.status)) {
      throw new Error("Resposta invalida do servidor");
    }
    return { status: data.status as PreCadastroStatus };
  },

  // ---------------------------------------------------------------------------
  // 3. Buscar pre-cadastro por token (para exibir antes de confirmar)
  //    A resposta publica contem apenas estado e expiracao, nunca PII.
  // ---------------------------------------------------------------------------
  async buscarPorToken(token: string): Promise<Partial<PreCadastro> | null> {
    if (!token || token.length < 16) return null;
    const { data, error } = await supabase.functions.invoke("pre-cadastro", {
      body: { action: "status", token },
    });
    if (error || !PRE_CADASTRO_STATUS.includes(data?.status)) return null;
    return { status: data.status, dt_token_exp: data.expiresAt ?? null };
  },

  // ---------------------------------------------------------------------------
  // 4. Listar pendentes (admin/recepcao)
  // ---------------------------------------------------------------------------
  async listarPendentes(companyId?: string): Promise<PreCadastroPendente[]> {
    const targetCompanyId = companyId ?? (await resolveCompanyId());

    const { data, error } = await supabase
      .from("pre_cadastros_pendentes")
      .select([
        "id", "company_id", "full_name", "email", "phone", "birth_date", "gender",
        "cep", "cidade", "uf", "created_at", "dt_token_exp",
        "horas_para_expirar", "dt_ultimo_envio", "tentativas_confirmacao",
      ].join(", "))
      .eq("company_id", targetCompanyId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Erro ao listar pendentes: ${error.message}`);
    return (data ?? []) as unknown as PreCadastroPendente[];
  },

  // ---------------------------------------------------------------------------
  // 5. Listar todos (admin) com filtros
  // ---------------------------------------------------------------------------
  async listar(
    companyId?: string,
    filtros?: { status?: PreCadastroStatus; limit?: number },
  ): Promise<PreCadastro[]> {
    const targetCompanyId = companyId ?? (await resolveCompanyId());

    let query = supabase
      .from("pre_cadastro")
      .select(PRE_CADASTRO_OPERATIONAL_COLUMNS)
      .eq("company_id", targetCompanyId)
      .order("created_at", { ascending: false })
      .limit(filtros?.limit ?? 100);

    if (filtros?.status) {
      query = query.eq("status", filtros.status);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Erro ao listar pre-cadastros: ${error.message}`);
    return (data ?? []) as unknown as PreCadastro[];
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
  async reenviarEmail(preCadastroId: string): Promise<{ accepted: true }> {
    if (!preCadastroId) throw new Error("preCadastroId obrigatorio");
    const storageKey = `prontomedic:pre-cadastro-resend:${preCadastroId}`;
    const storedKey = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(storageKey);
    const requestKey = storedKey && /^[0-9a-f-]{36}$/i.test(storedKey) ? storedKey : crypto.randomUUID();
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(storageKey, requestKey);
    const { data, error } = await supabase.functions.invoke("pre-cadastro", {
      headers: { "Idempotency-Key": requestKey },
      body: { action: "resend", pre_cadastro_id: preCadastroId },
    });
    if (error) throw new Error("Falha ao reenviar a confirmação.");
    if (data?.accepted !== true) throw new Error("Resposta inválida do serviço de pré-cadastro.");
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(storageKey);
    return { accepted: true };
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
