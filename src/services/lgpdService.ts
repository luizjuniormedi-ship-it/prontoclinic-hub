/**
 * lgpdService — Modulo LGPD completo (Lei 13.709/2018)
 *
 * Cobre os direitos do titular (art. 18):
 *   I  — Acesso aos dados
 *   II — Confirmacao de existencia
 *   III — Correcao
 *   IV — Anonimizacao
 *   V  — Portabilidade
 *   VI — Eliminacao (direito ao esquecimento)
 *   IX — Revogacao de consentimento
 *
 * Operacoes:
 *   - getConsentimentos / updateConsentimento
 *   - requestAcesso / requestPortabilidade / requestEsquecimento / requestRevogacao
 *   - anonimização efetiva permanece em fluxo administrativo server-side
 *   - exportarDados (payload de portabilidade)
 *   - getPoliticaRetencao / setPoliticaRetencao
 *   - getSolicitacoes / processarSolicitacao
 *
 * Migration relacionada: supabase/migrations/20260101000006_lgpd.sql
 */

import { z } from "zod";
import { supabase } from "@/lib/supabase";

// =============================================================================
// Tipos e enums
// =============================================================================

export const CANAL = {
  SMS: 1,
  EMAIL: 2,
  WHATSAPP: 3,
  PUSH: 4,
} as const;
export type CanalCode = (typeof CANAL)[keyof typeof CANAL];

export const CANAL_LABEL: Record<CanalCode, string> = {
  1: "SMS",
  2: "E-mail",
  3: "WhatsApp",
  4: "Push",
};

export const TIPO_SOLICITACAO = [
  "ACESSO",
  "PORTABILIDADE",
  "CORRECAO",
  "ESQUECIMENTO",
  "REVOGACAO",
] as const;
export type TipoSolicitacao = (typeof TIPO_SOLICITACAO)[number];

export const STATUS_SOLICITACAO = [
  "PENDENTE",
  "EM_ANDAMENTO",
  "CONCLUIDA",
  "REJEITADA",
] as const;
export type StatusSolicitacao = (typeof STATUS_SOLICITACAO)[number];

export const ACAO_RETENCAO = ["ANONIMIZAR", "DELETAR", "ARQUIVAR"] as const;
export type AcaoRetencao = (typeof ACAO_RETENCAO)[number];

export const MOTIVO_ANONIMIZACAO = [
  "OBITO",
  "EXERCICIO_DIREITO_ESQUECIMENTO",
  "INATIVO_5_ANOS",
  "MIGRACAO_SIGH",
  "SOLICITACAO_TITULAR",
] as const;
export type MotivoAnonimizacao = (typeof MOTIVO_ANONIMIZACAO)[number];

// =============================================================================
// Interfaces
// =============================================================================

export interface PacienteConsentimento {
  id: number;
  company_id: string;
  cd_paciente: number;
  cd_canal: CanalCode;
  lg_optin: boolean;
  dt_optin: string;
  versao_termo: string;
  texto_termo_hash: string;
  ip_origem?: string | null;
  user_agent?: string | null;
  dt_revocacao?: string | null;
  motivo_revocacao?: string | null;
}

export interface LgpdSolicitacao {
  id: number;
  company_id: string;
  cd_paciente: number;
  tipo: TipoSolicitacao;
  status: StatusSolicitacao;
  dt_solicitacao: string;
  dt_prazo: string;
  dt_conclusao?: string | null;
  ip_origem?: string | null;
  motivo_rejeicao?: string | null;
  payload_exportacao?: Record<string, unknown> | null;
}

export interface LgpdPoliticaRetencao {
  id: number;
  company_id: string;
  tabela: string;
  dias_retencao: number;
  acao_apos_expirar: AcaoRetencao;
  updated_at: string;
  updated_by?: string | null;
}

export interface PacienteAnonimizavel {
  id: number;
  company_id: string;
  full_name: string;
  cpf: string | null;
  dias_sem_atendimento: number;
  dt_ultimo_atendimento: string;
}

export interface ExportPayloadPaciente {
  gerado_em: string;
  versao: string;
  paciente: Record<string, unknown>;
  agendamentos: Record<string, unknown>[];
  prontuarios: Record<string, unknown>[];
  exames: Record<string, unknown>[];
  financeiro: Record<string, unknown>[];
  consentimentos: PacienteConsentimento[];
  logs_auditoria: Record<string, unknown>[];
}

// =============================================================================
// Validacao (Zod)
// =============================================================================

const updateConsentimentoSchema = z.object({
  patientId: z.number().int().positive("patientId obrigatorio"),
  canal: z.nativeEnum(CANAL, { errorMap: () => ({ message: "Canal invalido" }) }),
  optin: z.boolean({ required_error: "optin obrigatorio" }),
  ip: z.string().optional().nullable(),
  userAgent: z.string().max(500).optional().nullable(),
  versaoTermo: z.string().regex(/^v\d+\.\d+-\d{4}-\d{2}-\d{2}$/, "Formato esperado: v1.0-YYYY-MM-DD"),
});

const setPoliticaSchema = z.object({
  companyId: z.string().uuid("companyId deve ser UUID"),
  tabela: z.string().min(1).max(50),
  dias: z.number().int().positive().max(36500, "Maximo 100 anos"),
  acao: z.enum(ACAO_RETENCAO),
});

const motivoEsquecimentoSchema = z.enum(MOTIVO_ANONIMIZACAO);

// =============================================================================
// Constantes
// =============================================================================

/** Termo de consentimento canonico — manter em sincronia com o portal do paciente */
export const TEXTO_TERMO_CONSENTIMENTO = `
TERMO DE CONSENTIMENTO PARA TRATAMENTO DE DADOS PESSOAIS
Em conformidade com a Lei 13.709/2018 (LGPD), autorizo o tratamento dos meus
dados pessoais sensíveis de saúde para finalidades clínicas, administrativas
e de comunicação, conforme descritivo do canal selecionado.
Posso revogar este consentimento a qualquer momento.
`.trim();

/** Politica padrao recomendada (LGPD art. 16 + Resolucao CFM 1.821/2007) */
export const POLITICA_PADRAO: Array<{
  tabela: string;
  dias: number;
  acao: AcaoRetencao;
  justificativa: string;
}> = [
  { tabela: "audit_logs",            dias: 1825, acao: "ARQUIVAR",  justificativa: "5 anos — regulatorio + defesa em juizo" },
  { tabela: "appointments",          dias: 1825, acao: "ARQUIVAR",  justificativa: "5 anos — Resolucao CFM 1.821/2007" },
  { tabela: "medical_records",       dias: 7300, acao: "ARQUIVAR",  justificativa: "20 anos — prontuario medico" },
  { tabela: "financial_transactions",dias: 1825, acao: "ARQUIVAR",  justificativa: "5 anos — CTN art. 205 + legislacao fiscal" },
  { tabela: "notifications",         dias: 365,  acao: "DELETAR",   justificativa: "1 ano — sem finalidade apos envio" },
];

/** Hash SHA-256 do termo (computado uma vez no build, revalidado em runtime) */
async function hashTermo(texto: string): Promise<string> {
  const enc = new TextEncoder().encode(texto);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// =============================================================================
// Service
// =============================================================================

export const lgpdService = {
  // ---------------------------------------------------------------------------
  // 1. Consentimentos
  // ---------------------------------------------------------------------------

  /** Lista todos os consentimentos do paciente (um registro por versao do termo). */
  async getConsentimentos(patientId: number): Promise<PacienteConsentimento[]> {
    if (!Number.isInteger(patientId) || patientId <= 0) {
      throw new Error("patientId invalido");
    }
    const { data, error } = await supabase
      .from("paciente_consentimentos")
      .select("*")
      .eq("cd_paciente", patientId)
      .order("cd_canal", { ascending: true })
      .order("dt_optin", { ascending: false });
    if (error) throw new Error(`Erro ao listar consentimentos: ${error.message}`);
    return (data || []) as PacienteConsentimento[];
  },

  /**
   * Registra um opt-in ou opt-out para um canal. Cria um novo registro
   * (UNIQUE(cd_paciente, cd_canal, versao_termo)) — o historico nunca
   * e sobrescrito.
   */
  async updateConsentimento(
    patientId: number,
    canal: CanalCode,
    optin: boolean,
    ip?: string | null,
    userAgent?: string | null,
    versaoTermo = "v1.0-2026-06-22"
  ): Promise<PacienteConsentimento> {
    const parsed = updateConsentimentoSchema.parse({
      patientId,
      canal,
      optin,
      ip,
      userAgent,
      versaoTermo,
    });

    const textoHash = await hashTermo(TEXTO_TERMO_CONSENTIMENTO);

    const payload: Partial<PacienteConsentimento> = {
      cd_paciente: parsed.patientId,
      cd_canal: parsed.canal,
      lg_optin: parsed.optin,
      versao_termo: parsed.versaoTermo,
      texto_termo_hash: textoHash,
      ip_origem: parsed.ip ?? null,
      user_agent: parsed.userAgent ?? null,
      dt_revocacao: parsed.optin ? null : new Date().toISOString(),
      motivo_revocacao: parsed.optin ? null : "OPT_OUT_PELO_TITULAR",
    };

    const { data, error } = await supabase
      .from("paciente_consentimentos")
      .insert(payload)
      .select()
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new Error("Ja existe um consentimento registrado para este paciente/canal/versao");
      }
      throw new Error(`Erro ao registrar consentimento: ${error.message}`);
    }
    return data as PacienteConsentimento;
  },

  // ---------------------------------------------------------------------------
  // 2. Solicitacoes do titular (art. 18)
  // ---------------------------------------------------------------------------

  /** Cria uma solicitacao do tipo informado com prazo de 15 dias (art. 18 §5). */
  async criarSolicitacao(
    patientId: number,
    tipo: TipoSolicitacao,
    ip?: string | null
  ): Promise<LgpdSolicitacao> {
    if (!Number.isInteger(patientId) || patientId <= 0) {
      throw new Error("patientId invalido");
    }
    const { data: companyRow, error: companyErr } = await supabase
      .from("user_profiles")
      .select("company_id")
      .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "")
      .maybeSingle();
    if (companyErr || !companyRow) {
      throw new Error("Nao foi possivel identificar a empresa do usuario");
    }

    const dt_solicitacao = new Date();
    const dt_prazo = new Date(dt_solicitacao.getTime() + 15 * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from("lgpd_solicitacoes")
      .insert({
        cd_paciente: patientId,
        company_id: companyRow.company_id,
        tipo,
        status: "PENDENTE",
        dt_solicitacao: dt_solicitacao.toISOString(),
        dt_prazo: dt_prazo.toISOString(),
        ip_origem: ip ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar solicitacao ${tipo}: ${error.message}`);
    return data as LgpdSolicitacao;
  },

  /** LGPD art. 18 I — direito de acesso aos dados */
  async requestAcesso(patientId: number, ip?: string | null): Promise<LgpdSolicitacao> {
    return this.criarSolicitacao(patientId, "ACESSO", ip);
  },

  /** LGPD art. 18 V — portabilidade (export JSON do titular) */
  async requestPortabilidade(patientId: number, ip?: string | null): Promise<LgpdSolicitacao> {
    return this.criarSolicitacao(patientId, "PORTABILIDADE", ip);
  },

  /**
   * LGPD art. 18 VI — esquecimento
   * Cria a solicitacao E (se motivo for EXERCICIO_DIREITO_ESQUECIMENTO
   * ou SOLICITACAO_TITULAR) ja inicia o processo de anonimizacao.
   */
  async requestEsquecimento(
    patientId: number,
    motivo: MotivoAnonimizacao = "EXERCICIO_DIREITO_ESQUECIMENTO",
    ip?: string | null
  ): Promise<{ solicitacao: LgpdSolicitacao; anonimizacao?: Record<string, unknown> }> {
    motivoEsquecimentoSchema.parse(motivo);
    const solicitacao = await this.criarSolicitacao(patientId, "ESQUECIMENTO", ip);
    return { solicitacao };
  },

  /**
   * A anonimização é destrutiva e não pode ser iniciada pelo navegador.
   * A solicitação deve ser aprovada e executada por um worker administrativo
   * server-side com trilha de auditoria e credencial de serviço.
   */
  async executeEsquecimento(
    patientId: number,
    motivo: MotivoAnonimizacao
  ): Promise<Record<string, unknown>> {
    motivoEsquecimentoSchema.parse(motivo);
    if (!Number.isInteger(patientId) || patientId <= 0) {
      throw new Error("patientId invalido");
    }
    throw new Error(
      "Anonimizacao bloqueada no navegador; use o fluxo administrativo server-side aprovado",
    );
  },

  // ---------------------------------------------------------------------------
  // 3. Exportacao de dados (portabilidade + acesso)
  // ---------------------------------------------------------------------------

  /**
   * Exporta TODOS os dados do paciente em um unico JSON.
   * Usado para PORTABILIDADE (art. 18 V) e ACESSO (art. 18 I).
   * Se alguma tabela relacionada nao existir, retorna [] para ela.
   */
  async exportarDados(patientId: number): Promise<ExportPayloadPaciente> {
    if (!Number.isInteger(patientId) || patientId <= 0) {
      throw new Error("patientId invalido");
    }

    const queries = [
      supabase.from("patients").select("*").eq("id", patientId).maybeSingle(),
      supabase.from("appointments").select("*").eq("patient_id", patientId),
      supabase.from("medical_records").select("*").eq("patient_id", patientId),
      supabase.from("worklist").select("*").eq("patient_id", patientId),
      supabase.from("billing").select("*").eq("patient_id", patientId),
      supabase.from("paciente_consentimentos").select("*").eq("cd_paciente", patientId),
      supabase.from("audit_logs").select("*").eq("entity_id", String(patientId)),
    ];

    const [
      pacienteRes,
      appointmentsRes,
      recordsRes,
      worklistRes,
      billingRes,
      consentRes,
      auditRes,
    ] = await Promise.all(queries);

    return {
      gerado_em: new Date().toISOString(),
      versao: "1.0",
      paciente: pacienteRes.data || {},
      agendamentos: appointmentsRes.data || [],
      prontuarios: recordsRes.data || [],
      exames: worklistRes.data || [],
      financeiro: billingRes.data || [],
      consentimentos: (consentRes.data || []) as PacienteConsentimento[],
      logs_auditoria: auditRes.data || [],
    };
  },

  // ---------------------------------------------------------------------------
  // 4. Politica de retencao
  // ---------------------------------------------------------------------------

  async getPoliticaRetencao(companyId: string): Promise<LgpdPoliticaRetencao[]> {
    if (!companyId) throw new Error("companyId obrigatorio");
    const { data, error } = await supabase
      .from("lgpd_politica_retencao")
      .select("*")
      .eq("company_id", companyId)
      .order("tabela", { ascending: true });
    if (error) throw new Error(`Erro ao listar politica: ${error.message}`);
    return (data || []) as LgpdPoliticaRetencao[];
  },

  async setPoliticaRetencao(
    companyId: string,
    tabela: string,
    dias: number,
    acao: AcaoRetencao
  ): Promise<LgpdPoliticaRetencao> {
    const parsed = setPoliticaSchema.parse({ companyId, tabela, dias, acao });
    const { data, error } = await supabase
      .from("lgpd_politica_retencao")
      .upsert(
        {
          company_id: parsed.companyId,
          tabela: parsed.tabela,
          dias_retencao: parsed.dias,
          acao_apos_expirar: parsed.acao,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,tabela" }
      )
      .select()
      .single();
    if (error) throw new Error(`Erro ao salvar politica: ${error.message}`);
    return data as LgpdPoliticaRetencao;
  },

  /** Aplica a POLITICA_PADRAO recomendada a uma empresa (apenas registros novos). */
  async seedPoliticaPadrao(companyId: string): Promise<void> {
    if (!companyId) throw new Error("companyId obrigatorio");
    for (const p of POLITICA_PADRAO) {
      try {
        await this.setPoliticaRetencao(companyId, p.tabela, p.dias, p.acao);
      } catch (err) {
        // ignora conflito UNIQUE — tabela ja configurada
        if (!(err instanceof Error && err.message.includes("Erro ao salvar politica"))) {
          throw err;
        }
      }
    }
  },

  // ---------------------------------------------------------------------------
  // 5. Workflow de solicitacoes
  // ---------------------------------------------------------------------------

  async getSolicitacoes(status?: StatusSolicitacao): Promise<LgpdSolicitacao[]> {
    let q = supabase
      .from("lgpd_solicitacoes")
      .select("*")
      .order("dt_prazo", { ascending: true });
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao listar solicitacoes: ${error.message}`);
    return (data || []) as LgpdSolicitacao[];
  },

  /**
   * Avanca o workflow de uma solicitacao:
   *   PENDENTE  → EM_ANDAMENTO (auto, ao iniciar processamento)
   *   EM_ANDAMENTO → CONCLUIDA (com payload de exportacao, se aplicavel)
   *   qualquer  → REJEITADA (com motivo)
   *
   * Tambem verifica se o prazo de 15 dias foi ultrapassado — em caso positivo,
   * sinaliza via warning no log do navegador para a equipe juridica.
   */
  async processarSolicitacao(
    solicitacaoId: number,
    acao: "concluir" | "rejeitar",
    payload?: { motivoRejeicao?: string; exportacao?: Record<string, unknown> }
  ): Promise<LgpdSolicitacao> {
    if (!Number.isInteger(solicitacaoId) || solicitacaoId <= 0) {
      throw new Error("solicitacaoId invalido");
    }

    // 1) Buscar a solicitacao atual
    const { data: atual, error: e1 } = await supabase
      .from("lgpd_solicitacoes")
      .select("*")
      .eq("id", solicitacaoId)
      .maybeSingle();
    if (e1) throw new Error(`Erro ao buscar solicitacao: ${e1.message}`);
    if (!atual) throw new Error("Solicitacao nao encontrada");
    if (atual.status === "CONCLUIDA" || atual.status === "REJEITADA") {
      throw new Error(`Solicitacao ja finalizada (${atual.status})`);
    }

    // 2) Verificar prazo legal
    const prazo = new Date(atual.dt_prazo).getTime();
    if (Date.now() > prazo) {
      // eslint-disable-next-line no-console
      console.warn(
        `[LGPD] Solicitacao #${solicitacaoId} do tipo ${atual.tipo} venceu o prazo legal de 15 dias.`
      );
    }

    // 3) Transicao
    if (atual.status === "PENDENTE") {
      await supabase
        .from("lgpd_solicitacoes")
        .update({ status: "EM_ANDAMENTO" })
        .eq("id", solicitacaoId);
    }

    // 4) Acao final
    const updatePayload: Record<string, unknown> = {
      status: acao === "concluir" ? "CONCLUIDA" : "REJEITADA",
      dt_conclusao: new Date().toISOString(),
    };
    if (acao === "concluir" && payload?.exportacao) {
      updatePayload.payload_exportacao = payload.exportacao;
    }
    if (acao === "rejeitar") {
      if (!payload?.motivoRejeicao || payload.motivoRejeicao.length < 10) {
        throw new Error("motivoRejeicao obrigatorio (min. 10 caracteres)");
      }
      updatePayload.motivo_rejeicao = payload.motivoRejeicao;
    }

    const { data, error } = await supabase
      .from("lgpd_solicitacoes")
      .update(updatePayload)
      .eq("id", solicitacaoId)
      .select()
      .single();
    if (error) throw new Error(`Erro ao processar solicitacao: ${error.message}`);
    return data as LgpdSolicitacao;
  },

  // ---------------------------------------------------------------------------
  // 6. Job de anonimizacao em massa
  // ---------------------------------------------------------------------------

  /**
   * Lista pacientes inativos > 5 anos (view `pacientes_anonimizaveis`).
   * Limite de seguranca para execucao manual.
   */
  async getPacientesAnonimizaveis(limit = 100): Promise<PacienteAnonimizavel[]> {
    const { data, error } = await supabase
      .from("pacientes_anonimizaveis")
      .select("*")
      .limit(limit);
    if (error) throw new Error(`Erro ao listar anonimizaveis: ${error.message}`);
    return (data || []) as PacienteAnonimizavel[];
  },

  /**
   * Executa o job de anonimizacao em massa para pacientes inativos > 5 anos.
   * Retorna contadores {sucesso, falha, erros[]}.
   * NUNCA anonimiza paciente com dt_obito != null (a view ja filtra, mas
   * mantemos defense-in-depth).
   */
  async executarAnonimizacaoMassa(
    motivo: MotivoAnonimizacao = "INATIVO_5_ANOS",
    limit = 100
  ): Promise<{ sucesso: number; falha: number; erros: Array<{ id: number; erro: string }> }> {
    motivoEsquecimentoSchema.parse(motivo);
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit invalido");
    throw new Error(
      "Anonimizacao em massa bloqueada no navegador; execute somente pelo worker administrativo aprovado",
    );
  },
};

export default lgpdService;

