/**
 * billingAccountsService — Módulo de Faturamento (Fase 1)
 *
 * Conta por atendimento (billing_accounts) criada pelos comandos transacionais
 * da Recepção e do Financeiro.
 */
import { supabase } from "@/lib/supabase";

export type BillingStatus =
  | "aberta" | "em_montagem" | "aguardando_documentos" | "aguardando_autorizacao"
  | "aguardando_laudo" | "aguardando_assinatura" | "aguardando_conferencia" | "em_auditoria"
  | "com_pendencia" | "pronta_envio" | "enviada" | "em_analise" | "paga" | "parcialmente_paga"
  | "glosada" | "em_recurso" | "recurso_aceito" | "recurso_negado" | "baixada" | "cancelada"
  | "reaberta" | "particular_paga" | "particular_pendente" | "inadimplente";

export interface BillingAccount {
  id: string;
  patient_id: number | null;
  insurance_id: number | null;
  billing_type: string;
  account_type: string;
  status: BillingStatus;
  competence_month: string | null;
  total_gross_amount: number;
  total_net_amount: number;
  total_paid_amount: number;
  total_pending_amount: number;
  authorization_number: string | null;
  guide_number: string | null;
  has_pending_issues: boolean;
  has_denial: boolean;
  is_reopened: boolean;
  created_at?: string;
  opened_at: string;
  paid_at: string | null;
  version: number;
  readiness: BillingReadiness;
  patient_name?: string;
}

export interface BillingReadinessIssue {
  code: string;
  severity: "blocking";
}

export interface BillingReadiness {
  account_id: string;
  version: number;
  status: BillingStatus;
  issues: BillingReadinessIssue[];
  blocking_count: number;
  can_close: boolean;
}

export interface BillingCompetence {
  id: string | null;
  competence_month: string;
  status: "open" | "closed";
  version: number;
  closed_at: string | null;
  close_reason: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
  account_count: number;
  account_ids: string[];
  updated_at: string;
}

export type BillingAuditStatus = "unassigned" | "assigned" | "approved" | "returned" | "escalated";

export interface BillingAuditQueueItem {
  account_id: string;
  patient_name: string | null;
  guide_number: string | null;
  account_status: BillingStatus;
  account_version: number;
  total_net_amount: number;
  readiness: BillingReadiness;
  review_id: string | null;
  review_status: Exclude<BillingAuditStatus, "unassigned"> | null;
  review_version: number | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  deadline_at: string | null;
  decided_at: string | null;
  opinion: string | null;
  evidence: Record<string, unknown> | unknown[] | null;
  sla_overdue: boolean;
}

export interface BillingAuditCommandResult {
  account_id: string;
  account_status: BillingStatus;
  account_version: number;
  review_id: string;
  review_status: Exclude<BillingAuditStatus, "unassigned">;
  review_version: number;
  reviewer_id?: string;
  deadline_at?: string;
  decided_at?: string;
}

export const BILLING_STATUS_LABELS: Partial<Record<BillingStatus, string>> = {
  aberta: "Aberta", em_montagem: "Em montagem", pronta_envio: "Pronta p/ envio",
  enviada: "Enviada", em_analise: "Em análise", paga: "Paga", parcialmente_paga: "Parc. paga",
  glosada: "Glosada", em_recurso: "Em recurso", com_pendencia: "Com pendência",
  cancelada: "Cancelada", particular_paga: "Particular paga", particular_pendente: "Particular pendente",
  inadimplente: "Inadimplente", reaberta: "Reaberta",
};

export const billingAccountsService = {
  async list(filters?: { status?: string; billing_type?: string; competence?: string; onlyPending?: boolean }): Promise<BillingAccount[]> {
    const { data, error } = await supabase.rpc("m39_list_billing_accounts_secure", {
      p_status: filters?.status ?? null,
      p_billing_type: filters?.billing_type ?? null,
      p_competence: filters?.competence ?? null,
      p_only_pending: filters?.onlyPending ?? false,
      p_limit: 300,
    });
    if (error) throw new Error(error.message);
    return ((data || []) as unknown as BillingAccount[]).map((r) => ({
      ...r,
      opened_at: r.opened_at || r.created_at || "",
      authorization_number: r.authorization_number ?? null,
      has_denial: r.has_denial ?? false,
      is_reopened: r.is_reopened ?? r.status === "reaberta",
      paid_at: r.paid_at ?? null,
    }));
  },

  async review(account: BillingAccount): Promise<BillingReadiness> {
    const { data, error } = await supabase.rpc("m39_review_billing_account_secure", {
      p_account_id: account.id,
      p_expected_version: account.version,
      p_operation_id: crypto.randomUUID(),
    });
    if (error) throw new Error(error.message);
    return data as unknown as BillingReadiness;
  },

  async reopen(account: BillingAccount, reason: string): Promise<{ status: BillingStatus; version: number }> {
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new Error("Motivo da reabertura é obrigatório");
    const { data, error } = await supabase.rpc("m39_reopen_billing_account_secure", {
      p_account_id: account.id,
      p_reason: normalizedReason,
      p_expected_version: account.version,
      p_operation_id: crypto.randomUUID(),
    });
    if (error) throw new Error(error.message);
    return data as unknown as { status: BillingStatus; version: number };
  },

  async listCompetences(): Promise<BillingCompetence[]> {
    const { data, error } = await supabase.rpc("m39_list_billing_competences_secure", {
      p_limit: 120,
    });
    if (error) throw new Error(error.message);
    return (data || []) as unknown as BillingCompetence[];
  },

  async closeCompetence(competence: BillingCompetence, reason: string): Promise<BillingCompetence> {
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new Error("Motivo do fechamento é obrigatório");
    const { data, error } = await supabase.rpc("m39_close_billing_competence_secure", {
      p_competence: competence.competence_month,
      p_reason: normalizedReason,
      p_expected_version: competence.version,
      p_operation_id: crypto.randomUUID(),
    });
    if (error) throw new Error(error.message);
    return data as unknown as BillingCompetence;
  },

  async reopenCompetence(competence: BillingCompetence, reason: string): Promise<BillingCompetence> {
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new Error("Motivo da reabertura é obrigatório");
    const { data, error } = await supabase.rpc("m39_reopen_billing_competence_secure", {
      p_competence: competence.competence_month,
      p_reason: normalizedReason,
      p_expected_version: competence.version,
      p_operation_id: crypto.randomUUID(),
    });
    if (error) throw new Error(error.message);
    return data as unknown as BillingCompetence;
  },

  async listAuditQueue(status?: BillingAuditStatus): Promise<BillingAuditQueueItem[]> {
    const { data, error } = await supabase.rpc("m37_list_billing_audit_queue_secure", {
      p_status: status ?? null,
      p_limit: 200,
    });
    if (error) throw new Error(error.message);
    return (data || []) as unknown as BillingAuditQueueItem[];
  },

  async claimAudit(item: BillingAuditQueueItem): Promise<BillingAuditCommandResult> {
    const { data, error } = await supabase.rpc("m37_claim_billing_audit_secure", {
      p_account_id: item.account_id,
      p_expected_account_version: item.account_version,
      p_operation_id: crypto.randomUUID(),
    });
    if (error) throw new Error(error.message);
    return data as unknown as BillingAuditCommandResult;
  },

  async decideAudit(
    item: BillingAuditQueueItem,
    decision: "approved" | "returned" | "escalated",
    opinion: string,
    evidence: string,
  ): Promise<BillingAuditCommandResult> {
    const normalizedOpinion = opinion.trim();
    const normalizedEvidence = evidence.trim();
    if (!item.review_id || item.review_version == null) {
      throw new Error("Auditoria ativa não encontrada");
    }
    if (!normalizedOpinion || !normalizedEvidence) {
      throw new Error("Parecer e evidência são obrigatórios");
    }
    const { data, error } = await supabase.rpc("m37_decide_billing_audit_secure", {
      p_account_id: item.account_id,
      p_review_id: item.review_id,
      p_decision: decision,
      p_opinion: normalizedOpinion,
      p_evidence: { note: normalizedEvidence },
      p_expected_account_version: item.account_version,
      p_expected_review_version: item.review_version,
      p_operation_id: crypto.randomUUID(),
    });
    if (error) throw new Error(error.message);
    return data as unknown as BillingAuditCommandResult;
  },

  stats(all: BillingAccount[]): { total: number; abertas: number; prontas: number; comPendencia: number; enviadas: number; pagas: number } {
    return {
      total: all.length,
      abertas: all.filter((a) => a.status === "aberta").length,
      prontas: all.filter((a) => a.status === "pronta_envio").length,
      comPendencia: all.filter((a) => a.has_pending_issues).length,
      enviadas: all.filter((a) => a.status === "enviada").length,
      pagas: all.filter((a) => ["paga", "parcialmente_paga", "particular_paga"].includes(a.status)).length,
    };
  },
};
