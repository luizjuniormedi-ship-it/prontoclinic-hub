/**
 * billingAccountsService — Módulo de Faturamento (Fase 1)
 *
 * Conta por atendimento (billing_accounts) agregando os lançamentos reais.
 * Glosa preventiva via função billing_check_pending(); competência com
 * fechamento/bloqueio garantido por trigger no Postgres.
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
  opened_at: string;
  paid_at: string | null;
  patient_name?: string;
}

export interface PendingIssue {
  id: number;
  billing_account_id: string;
  issue_code: string;
  issue_label: string;
  severity: string;
  resolved: boolean;
}

export interface Competency {
  id: number;
  competence_month: string;
  status: string;
  receita_prevista: number;
  receita_realizada: number;
  total_glosado: number;
  total_pendente: number;
  closed_at: string | null;
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
    let q = supabase.from("billing_accounts").select("*").is("deleted_at", null)
      .order("opened_at", { ascending: false }).limit(300);
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.billing_type) q = q.eq("billing_type", filters.billing_type);
    if (filters?.competence) q = q.eq("competence_month", filters.competence);
    if (filters?.onlyPending) q = q.eq("has_pending_issues", true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data || []) as unknown as BillingAccount[];
    const pids = [...new Set(rows.map((r) => r.patient_id).filter(Boolean))];
    const nameById: Record<string, string> = {};
    if (pids.length > 0) {
      const { data: pats } = await supabase.from("patients").select("id, full_name").in("id", pids as number[]);
      for (const p of (pats || []) as Array<{ id: number; full_name: string }>) nameById[String(p.id)] = p.full_name;
    }
    return rows.map((r) => ({ ...r, patient_name: r.patient_id ? nameById[String(r.patient_id)] : undefined }));
  },

  async pendingIssues(accountId: string): Promise<PendingIssue[]> {
    const { data, error } = await supabase.from("billing_pending_issues").select("*")
      .eq("billing_account_id", accountId).eq("resolved", false);
    if (error) throw new Error(error.message);
    return (data || []) as unknown as PendingIssue[];
  },

  /** Roda a glosa preventiva na conta (recalcula pendências via função SQL). */
  async checkPending(accountId: string): Promise<number> {
    const { data, error } = await supabase.rpc("billing_check_pending", { p_account_id: accountId });
    if (error) throw new Error(error.message);
    return (data as number) ?? 0;
  },

  async resolveIssue(issueId: number): Promise<void> {
    const { error } = await supabase.from("billing_pending_issues")
      .update({ resolved: true, resolved_at: new Date().toISOString() }).eq("id", issueId);
    if (error) throw new Error(error.message);
  },

  async update(id: string, updates: Partial<BillingAccount>): Promise<void> {
    const { error } = await supabase.from("billing_accounts").update(updates).eq("id", id);
    if (error) throw new Error(error.message);
  },

  async reopen(id: string, reason: string): Promise<void> {
    const { error } = await supabase.from("billing_accounts")
      .update({ status: "reaberta", is_reopened: true, reopened_reason: reason }).eq("id", id);
    if (error) throw new Error(error.message);
  },

  async listCompetencies(): Promise<Competency[]> {
    const { data, error } = await supabase.from("billing_competencies").select("*").order("competence_month", { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []) as unknown as Competency[];
  },

  async closeCompetency(month: string): Promise<void> {
    const { data } = await supabase.from("billing_competencies").select("id").eq("competence_month", month).maybeSingle();
    if (data?.id) {
      const { error } = await supabase.from("billing_competencies")
        .update({ status: "fechada", closed_at: new Date().toISOString() }).eq("id", data.id);
      if (error) throw new Error(error.message);
    }
  },

  async stats(): Promise<{ total: number; abertas: number; prontas: number; comPendencia: number; enviadas: number; pagas: number }> {
    const all = await billingAccountsService.list();
    return {
      total: all.length,
      abertas: all.filter((a) => a.status === "aberta").length,
      prontas: all.filter((a) => a.status === "aberta" && !a.has_pending_issues).length,
      comPendencia: all.filter((a) => a.has_pending_issues).length,
      enviadas: all.filter((a) => a.status === "enviada").length,
      pagas: all.filter((a) => ["paga", "parcialmente_paga", "particular_paga"].includes(a.status)).length,
    };
  },

  /** Dashboard gerencial: receita por convênio (view). */
  async receitaPorConvenio(): Promise<Array<{ convenio: string; contas: number; valor_faturado: number; valor_recebido: number; valor_aberto: number }>> {
    const { data, error } = await supabase.from("v_billing_receita_convenio").select("*").limit(30);
    if (error) throw new Error(error.message);
    return (data || []) as unknown as Array<{ convenio: string; contas: number; valor_faturado: number; valor_recebido: number; valor_aberto: number }>;
  },

  async receitaMensal(): Promise<Array<{ competence_month: string; contas: number; faturado: number; recebido: number; glosado: number; pct_recebido: number | null }>> {
    const { data, error } = await supabase.from("v_billing_receita_mensal").select("*").limit(24);
    if (error) throw new Error(error.message);
    return (data || []) as unknown as Array<{ competence_month: string; contas: number; faturado: number; recebido: number; glosado: number; pct_recebido: number | null }>;
  },

  async indicadores(): Promise<Record<string, number>> {
    const { data, error } = await supabase.from("v_billing_indicadores").select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return (data || {}) as Record<string, number>;
  },
};
