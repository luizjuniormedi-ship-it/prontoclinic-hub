/**
 * reportsService — Módulo de Laudos (Fase 1, tabela `reports`)
 *
 * Consome a tabela enterprise `reports` migrada do SIGH (7.715 laudos reais).
 * Campos estruturados: technique / findings / conclusion / recommendation.
 * Ciclo de status conforme spec; regras de negócio (bloqueio pós-assinatura,
 * status_history, versionamento) são garantidas por triggers no Postgres.
 *
 * O proxy REST local não faz embedding do PostgREST, então nomes de paciente
 * e tipo são resolvidos em queries auxiliares (mesmo padrão de Pacientes/Agenda).
 */
import { supabase } from "@/lib/supabase";

export type ReportStatus =
  | "solicitado" | "aguardando_execucao" | "exame_realizado" | "aguardando_laudo"
  | "em_digitacao" | "em_revisao" | "aguardando_assinatura" | "assinado" | "liberado"
  | "entregue" | "retificado" | "cancelado" | "bloqueado" | "reaberto"
  | "pendente_imagem" | "pendente_dados" | "pendente_pagamento" | "pendente_autorizacao";

export type ReportPriority = "urgente" | "prioritario" | "rotina";

export interface ReportType {
  id: number;
  code: string;
  name: string;
  category: string;
  sla_minutes: number | null;
  requires_images: boolean;
}

export interface Report {
  id: string;
  company_id: string | null;
  unit_id: number | null;
  patient_id: number | null;
  medical_record_id: number | null;
  report_type_id: number | null;
  cd_servico_sigh: number | null;
  status: ReportStatus;
  priority: ReportPriority;
  title: string | null;
  clinical_indication: string | null;
  technique: string | null;
  findings: string | null;
  conclusion: string | null;
  recommendation: string | null;
  cid_principal: string | null;
  signed_at: string | null;
  released_at: string | null;
  delivered_at: string | null;
  signed_by_name: string | null;
  signed_by_crm: string | null;
  executor_professional_id: number | null;
  executor_name: string | null;
  executor_crm: string | null;
  requester_professional_id: number | null;
  requester_name: string | null;
  has_critical_finding: boolean;
  is_rectified: boolean;
  previous_report_id: string | null;
  version: number;
  validation_code: string | null;
  created_at: string;
  updated_at: string;
  // joined
  patient_name?: string;
  type_name?: string;
  type_category?: string;
}

export const STATUS_LABELS: Record<ReportStatus, string> = {
  solicitado: "Solicitado", aguardando_execucao: "Aguardando execução",
  exame_realizado: "Exame realizado", aguardando_laudo: "Aguardando laudo",
  em_digitacao: "Em digitação", em_revisao: "Em revisão",
  aguardando_assinatura: "Aguardando assinatura", assinado: "Assinado",
  liberado: "Liberado", entregue: "Entregue", retificado: "Retificado",
  cancelado: "Cancelado", bloqueado: "Bloqueado", reaberto: "Reaberto",
  pendente_imagem: "Pendente de imagem", pendente_dados: "Pendente de dados",
  pendente_pagamento: "Pendente de pagamento", pendente_autorizacao: "Pendente de autorização",
};

export const STATUS_COLORS: Record<ReportStatus, string> = {
  aguardando_laudo: "bg-warning/10 text-warning", em_digitacao: "bg-primary/10 text-primary",
  em_revisao: "bg-secondary/10 text-secondary", aguardando_assinatura: "bg-warning/10 text-warning",
  assinado: "bg-success/10 text-success", liberado: "bg-success/10 text-success",
  entregue: "bg-success/20 text-success", cancelado: "bg-destructive/10 text-destructive",
  retificado: "bg-primary/10 text-primary", bloqueado: "bg-destructive/10 text-destructive",
  solicitado: "bg-muted text-muted-foreground", aguardando_execucao: "bg-muted text-muted-foreground",
  exame_realizado: "bg-muted text-muted-foreground", reaberto: "bg-warning/10 text-warning",
  pendente_imagem: "bg-warning/10 text-warning", pendente_dados: "bg-warning/10 text-warning",
  pendente_pagamento: "bg-warning/10 text-warning", pendente_autorizacao: "bg-warning/10 text-warning",
};

export const reportsService = {
  async listTypes(): Promise<ReportType[]> {
    const { data, error } = await supabase.from("report_types").select("*").order("name");
    if (error) throw new Error(error.message);
    return (data || []) as unknown as ReportType[];
  },

  async list(filters?: { status?: string; priority?: string; type_id?: number; critical?: boolean }): Promise<Report[]> {
    let q = supabase.from("reports").select("*").is("deleted_at", null)
      .order("updated_at", { ascending: false }).limit(300);
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.priority) q = q.eq("priority", filters.priority);
    if (filters?.type_id) q = q.eq("report_type_id", filters.type_id);
    if (filters?.critical) q = q.eq("has_critical_finding", true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data || []) as unknown as Report[];

    // resolver nomes de paciente
    const pids = [...new Set(rows.map((r) => r.patient_id).filter(Boolean))];
    const nameById: Record<string, string> = {};
    if (pids.length > 0) {
      const { data: pats } = await supabase.from("patients").select("id, full_name").in("id", pids as number[]);
      for (const p of (pats || []) as Array<{ id: number; full_name: string }>) nameById[String(p.id)] = p.full_name;
    }
    // resolver tipos
    const types = await reportsService.listTypes();
    const typeById: Record<number, ReportType> = {};
    for (const t of types) typeById[t.id] = t;

    return rows.map((r) => ({
      ...r,
      patient_name: r.patient_id ? nameById[String(r.patient_id)] : undefined,
      type_name: r.report_type_id ? typeById[r.report_type_id]?.name : undefined,
      type_category: r.report_type_id ? typeById[r.report_type_id]?.category : undefined,
    }));
  },

  async update(id: string, updates: Partial<Report>): Promise<void> {
    const { error } = await supabase.from("reports").update(updates).eq("id", id);
    if (error) throw new Error(error.message);
  },

  /** Salva conteúdo do laudo e move para em_revisão. */
  async saveDraft(id: string, content: { technique?: string; findings?: string; conclusion?: string; recommendation?: string }): Promise<void> {
    await reportsService.update(id, { ...content, status: "em_revisao" });
  },

  /**
   * Assina e libera atomicamente. Nome, CRM e vínculo profissional são
   * resolvidos no banco a partir de auth.uid(); o cliente não pode forjá-los.
   */
  async signAndRelease(id: string): Promise<Report> {
    const { data, error } = await supabase.rpc("sign_and_release_radiology_report", { p_report_id: id });
    if (error) throw new Error(error.message);
    return data as unknown as Report;
  },

  /** Retificação: snapshot da versão atual + reabre para edição. */
  async rectify(report: Report, motivo: string): Promise<void> {
    const { error } = await supabase.rpc("rectify_radiology_report", {
      p_report_id: report.id,
      p_motivo: motivo,
    });
    if (error) throw new Error(error.message);
  },

  async flagCritical(id: string, descricao: string, canal: string): Promise<void> {
    await supabase.from("reports").update({ has_critical_finding: true }).eq("id", id);
    await supabase.from("report_critical_findings").insert({ report_id: id, descricao, canal });
  },

  async logDelivery(id: string, canal: string, destinatario: string): Promise<void> {
    const { error } = await supabase.rpc("deliver_radiology_report", {
      p_report_id: id,
      p_canal: canal,
      p_destinatario: destinatario,
    });
    if (error) throw new Error(error.message);
  },

  async validateByCode(code: string): Promise<Report | null> {
    const { data, error } = await supabase.from("reports").select("*").eq("validation_code", code).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as Report) || null;
  },

  async stats(): Promise<{ total: number; pendentes: number; liberados: number; criticos: number; atrasados: number }> {
    const all = await reportsService.list();
    let atrasados = 0;
    try {
      const { data } = await supabase.from("v_reports_sla").select("atrasado").eq("atrasado", true).limit(10000);
      atrasados = (data || []).length;
    } catch { /* view opcional */ }
    return {
      total: all.length,
      pendentes: all.filter((r) => ["aguardando_laudo", "em_digitacao", "em_revisao", "aguardando_assinatura"].includes(r.status)).length,
      liberados: all.filter((r) => ["liberado", "entregue"].includes(r.status)).length,
      criticos: all.filter((r) => r.has_critical_finding).length,
      atrasados,
    };
  },

  async produtividade(): Promise<Array<{ medico: string; total_assinados: number; retificados: number; criticos: number; horas_medias_ate_assinatura: number | null }>> {
    const { data, error } = await supabase.from("v_reports_produtividade").select("*").limit(50);
    if (error) throw new Error(error.message);
    return (data || []) as unknown as Array<{ medico: string; total_assinados: number; retificados: number; criticos: number; horas_medias_ate_assinatura: number | null }>;
  },

  /** Modelos rápidos ("laudo normal") para um tipo de exame. */
  async quickTemplates(reportTypeId: number): Promise<Array<{ id: number; nome: string; technique: string | null; findings: string | null; conclusion: string | null }>> {
    const { data, error } = await supabase.from("report_quick_templates")
      .select("id, nome, technique, findings, conclusion").eq("report_type_id", reportTypeId).eq("lg_ativo", true);
    if (error) throw new Error(error.message);
    return (data || []) as unknown as Array<{ id: number; nome: string; technique: string | null; findings: string | null; conclusion: string | null }>;
  },

  /** Campos estruturados (BI-RADS/TI-RADS) definidos para um tipo. */
  async structuredFields(reportTypeId: number): Promise<Array<{ field_key: string; field_label: string; field_type: string; options: string[] | null; obrigatorio: boolean }>> {
    const { data, error } = await supabase.from("report_structured_fields")
      .select("field_key, field_label, field_type, options, obrigatorio, ordem").eq("report_type_id", reportTypeId).order("ordem");
    if (error) throw new Error(error.message);
    return (data || []) as unknown as Array<{ field_key: string; field_label: string; field_type: string; options: string[] | null; obrigatorio: boolean }>;
  },

  async getStructuredValues(reportId: string): Promise<Record<string, string>> {
    const { data } = await supabase.from("report_structured_values").select("field_key, value").eq("report_id", reportId);
    const out: Record<string, string> = {};
    for (const r of (data || []) as Array<{ field_key: string; value: string }>) out[r.field_key] = r.value;
    return out;
  },

  async saveStructuredValues(reportId: string, values: Record<string, string>): Promise<void> {
    for (const [field_key, value] of Object.entries(values)) {
      if (value == null || value === "") continue;
      // upsert manual (proxy nao suporta on_conflict)
      const { data } = await supabase.from("report_structured_values").select("id").eq("report_id", reportId).eq("field_key", field_key).maybeSingle();
      if (data?.id) {
        await supabase.from("report_structured_values").update({ value }).eq("id", data.id);
      } else {
        await supabase.from("report_structured_values").insert({ report_id: reportId, field_key, value });
      }
    }
  },
};
