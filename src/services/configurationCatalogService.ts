import { supabase } from "@/lib/supabase";

export type ConfigurationStatus = "active" | "inactive";

export interface NumberingSequence {
  id: number;
  company_id: string;
  unit_id: number | null;
  document_type: string;
  prefix: string;
  next_value: number;
  padding: number;
  reset_period: "never" | "year" | "month";
  status: ConfigurationStatus;
}

export interface DocumentTemplate {
  id: number;
  company_id: string;
  unit_id: number | null;
  template_key: string;
  name: string;
  format: "html" | "text" | "json";
  content: string;
  version: number;
  status: "draft" | "published" | "inactive";
}

export interface SlaRule {
  id: number;
  company_id: string;
  unit_id: number | null;
  process_key: string;
  name: string;
  target_minutes: number;
  warning_minutes: number | null;
  escalation_role: string | null;
  status: ConfigurationStatus;
}

export interface WorkflowRule {
  id: number;
  company_id: string;
  unit_id: number | null;
  rule_type: "return" | "cancellation";
  name: string;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
  priority: number;
  status: ConfigurationStatus;
}

export interface NotificationSetting {
  id: number;
  company_id: string;
  unit_id: number | null;
  event_key: string;
  channel: "in_app" | "email" | "sms" | "whatsapp";
  template_key: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface IntegrationSetting {
  id: number;
  company_id: string;
  unit_id: number | null;
  integration_key: string;
  provider: string;
  base_url: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
  status: "active" | "inactive" | "pending";
}

async function scoped<T>(table: string, companyId: string, unitId?: number | null): Promise<T[]> {
  const base = supabase.from(table).select("*").eq("company_id", companyId);
  if (unitId == null) {
    const { data, error } = await base.order("updated_at", { ascending: false });
    if (error) throw new Error(`Erro ao carregar ${table}: ${error.message}`);
    return (data ?? []) as T[];
  }

  const [globalResult, unitResult] = await Promise.all([
    base.is("unit_id", null),
    base.eq("unit_id", unitId),
  ]);
  if (globalResult.error || unitResult.error) {
    throw new Error(`Erro ao carregar ${table}: ${globalResult.error?.message ?? unitResult.error?.message}`);
  }
  return [...((globalResult.data ?? []) as T[]), ...((unitResult.data ?? []) as T[])].sort((a, b) => {
    const aDate = String((a as { updated_at?: string }).updated_at ?? "");
    const bDate = String((b as { updated_at?: string }).updated_at ?? "");
    return bDate.localeCompare(aDate);
  });
}

async function save<T>(table: string, payload: Record<string, unknown>, uniqueKeys: string[]): Promise<T> {
  let lookup = supabase.from(table).select("id").eq("company_id", payload.company_id as string);
  for (const key of uniqueKeys) {
    const value = payload[key];
    lookup = value == null ? lookup.is(key, null) : lookup.eq(key, value);
  }
  const { data: existing, error: lookupError } = await lookup.maybeSingle();
  if (lookupError) throw new Error(`Erro ao localizar ${table}: ${lookupError.message}`);
  if (existing?.id) {
    const { data, error } = await supabase.from(table).update(payload).eq("id", existing.id).select("*").single();
    if (error) throw new Error(`Erro ao atualizar ${table}: ${error.message}`);
    return data as T;
  }
  const { data, error } = await supabase.from(table).insert(payload).select("*").single();
  if (error) throw new Error(`Erro ao criar ${table}: ${error.message}`);
  return data as T;
}

export const configurationCatalogService = {
  listNumbering(companyId: string, unitId?: number | null) {
    return scoped<NumberingSequence>("numbering_sequences", companyId, unitId);
  },
  saveNumbering(input: Omit<NumberingSequence, "id" | "status"> & { status?: ConfigurationStatus }) {
    return save<NumberingSequence>("numbering_sequences", { ...input, status: input.status ?? "active" }, ["unit_id", "document_type"]);
  },
  listTemplates(companyId: string, unitId?: number | null) {
    return scoped<DocumentTemplate>("document_templates", companyId, unitId);
  },
  saveTemplate(input: Omit<DocumentTemplate, "id" | "status"> & { status?: DocumentTemplate["status"] }) {
    return save<DocumentTemplate>("document_templates", { ...input, status: input.status ?? "draft" }, ["unit_id", "template_key", "version"]);
  },
  listSlas(companyId: string, unitId?: number | null) {
    return scoped<SlaRule>("sla_rules", companyId, unitId);
  },
  saveSla(input: Omit<SlaRule, "id" | "status"> & { status?: ConfigurationStatus }) {
    return save<SlaRule>("sla_rules", { ...input, status: input.status ?? "active" }, ["unit_id", "process_key"]);
  },
  listWorkflowRules(companyId: string, unitId?: number | null) {
    return scoped<WorkflowRule>("workflow_rules", companyId, unitId);
  },
  saveWorkflowRule(input: Omit<WorkflowRule, "id" | "status"> & { status?: ConfigurationStatus }) {
    return save<WorkflowRule>("workflow_rules", { ...input, status: input.status ?? "active" }, ["unit_id", "rule_type", "name"]);
  },
  listNotifications(companyId: string, unitId?: number | null) {
    return scoped<NotificationSetting>("notification_settings", companyId, unitId);
  },
  saveNotification(input: Omit<NotificationSetting, "id">) {
    return save<NotificationSetting>("notification_settings", input, ["unit_id", "event_key", "channel"]);
  },
  listIntegrations(companyId: string, unitId?: number | null) {
    return scoped<IntegrationSetting>("integration_settings", companyId, unitId);
  },
  saveIntegration(input: Omit<IntegrationSetting, "id">) {
    return save<IntegrationSetting>("integration_settings", input, ["unit_id", "integration_key"]);
  },
};
