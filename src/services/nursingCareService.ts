/**
 * nursingCareService - Enfermagem Fase 1 (assistencial)
 *
 * Leituras usam tabelas protegidas por RLS. Escritas clinicas passam somente
 * pelas RPCs seguras, que resolvem empresa e ator a partir da sessao autenticada.
 */
import { supabase } from "@/lib/supabase";

export type MedAdminStatus = "pendente" | "em_preparo" | "administrado" | "recusado" | "suspenso" | "atrasado" | "cancelado";

export interface MedAdmin {
  id: number; patient_id: number; medication: string; dose: string | null; via: string | null;
  scheduled_at: string | null; administered_at: string | null; status: MedAdminStatus;
  bedside_check_ok: boolean; refusal_reason: string | null; patient_name?: string;
}
export interface NursingIncident {
  id: number; patient_id: number; incident_type: string; severity: string;
  description: string; medico_notificado: boolean; created_at: string; patient_name?: string;
}
export interface NursingProcedure { id: number; patient_id: number; procedure_type: string; description: string | null; performed_at: string; faturavel: boolean; }

export interface CreateMedicationInput {
  patient_id: number;
  medication: string;
  dose?: string;
  via?: string;
  scheduled_at?: string;
  idempotencyKey: string;
}

export interface CreateIncidentInput {
  patient_id: number;
  incident_type: string;
  severity: string;
  description: string;
  idempotencyKey: string;
}

export interface CreateProcedureInput {
  patient_id: number;
  procedure_type: string;
  description?: string;
  faturavel?: boolean;
  idempotencyKey: string;
}

export interface CreateHandoffInput {
  shift_date: string;
  shift_type: string;
  summary: string;
  pending_items?: unknown;
  critical_patients?: unknown;
  notes?: string;
  idempotencyKey: string;
}

const forbiddenClientFields = new Set([
  "company_id", "companyId", "actor_id", "actorId", "user_id", "userId",
  "prepared_by", "preparedBy", "administered_by", "administeredBy",
  "reported_by", "reportedBy", "performed_by", "performedBy", "created_by", "createdBy",
]);

function assertNoServerOwnedFields(input: object): void {
  const forbidden = Object.keys(input).find((key) => forbiddenClientFields.has(key));
  if (forbidden) throw new Error(`Campo controlado pelo servidor nao permitido: ${forbidden}`);
}

function positiveId(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} deve ser um inteiro positivo`);
  return value;
}

function requiredText(value: string, field: string, maxLength = 4_000): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${field} obrigatorio`);
  if (normalized.length > maxLength) throw new Error(`${field} excede ${maxLength} caracteres`);
  return normalized;
}

function optionalText(value: string | undefined, field: string, maxLength: number): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${field} excede ${maxLength} caracteres`);
  return normalized || null;
}

function optionalIsoDate(value: string | undefined, field: string): string | null {
  if (value === undefined) return null;
  const normalized = requiredText(value, field, 64);
  if (Number.isNaN(Date.parse(normalized))) throw new Error(`${field} deve ser uma data valida`);
  return normalized;
}

function idempotencyKey(value: string): string {
  return requiredText(value, "idempotencyKey", 200);
}

function singleRpcRow<T>(data: unknown, operation: string): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") throw new Error(`Resposta invalida ao ${operation}`);
  return row as T;
}

async function withNames<T extends { patient_id: number }>(rows: T[]): Promise<(T & { patient_name?: string })[]> {
  const pids = [...new Set(rows.map((r) => r.patient_id).filter(Boolean))];
  const byId: Record<string, string> = {};
  if (pids.length > 0) {
    const { data } = await supabase.from("patients").select("id, full_name").in("id", pids);
    for (const p of (data || []) as Array<{ id: number; full_name: string }>) byId[String(p.id)] = p.full_name;
  }
  return rows.map((r) => ({ ...r, patient_name: byId[String(r.patient_id)] }));
}

export const nursingCareService = {
  async medications(status?: string): Promise<MedAdmin[]> {
    let q = supabase.from("nursing_medication_administrations").select("*").order("id", { ascending: false }).limit(100);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return withNames((data || []) as unknown as MedAdmin[]);
  },

  async createMedication(input: CreateMedicationInput): Promise<MedAdmin> {
    assertNoServerOwnedFields(input);
    const { data, error } = await supabase.rpc("create_nursing_medication_secure", {
      p_patient_id: positiveId(input.patient_id, "patient_id"),
      p_medication: requiredText(input.medication, "medication", 255),
      p_dose: optionalText(input.dose, "dose", 100),
      p_via: optionalText(input.via, "via", 100),
      p_scheduled_at: optionalIsoDate(input.scheduled_at, "scheduled_at"),
      p_idempotency_key: idempotencyKey(input.idempotencyKey),
    });
    if (error) throw new Error(error.message);
    return singleRpcRow<MedAdmin>(data, "criar medicacao");
  },

  async bedsideCheck(adminId: number, patientId: number): Promise<Array<{ certo: string; ok: boolean }>> {
    const { data, error } = await supabase.rpc("bedside_check", {
      p_admin_id: positiveId(adminId, "adminId"),
      p_patient_confirmado: positiveId(patientId, "patientId"),
    });
    if (error) throw new Error(error.message);
    const raw = data as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.map((x) => {
      if (typeof x === "object" && x !== null) return x as { certo: string; ok: boolean };
      const s = String(x).replace(/^\(|\)$/g, "").split(",");
      return { certo: s[0], ok: s[1] === "t" || s[1] === "true" };
    });
  },

  async administer(adminId: number, patientConfirmedId: number, key: string): Promise<void> {
    const { error } = await supabase.rpc("administer_nursing_medication_secure", {
      p_admin_id: positiveId(adminId, "adminId"),
      p_patient_confirmed_id: positiveId(patientConfirmedId, "patientConfirmedId"),
      p_idempotency_key: idempotencyKey(key),
    });
    if (error) throw new Error(error.message);
  },

  async refuse(adminId: number, reason: string, key: string): Promise<void> {
    const { error } = await supabase.rpc("refuse_nursing_medication_secure", {
      p_admin_id: positiveId(adminId, "adminId"),
      p_reason: requiredText(reason, "reason", 1_000),
      p_idempotency_key: idempotencyKey(key),
    });
    if (error) throw new Error(error.message);
  },

  async incidents(): Promise<NursingIncident[]> {
    const { data, error } = await supabase.from("nursing_incidents").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    return withNames((data || []) as unknown as NursingIncident[]);
  },

  async createIncident(input: CreateIncidentInput): Promise<NursingIncident> {
    assertNoServerOwnedFields(input);
    const { data, error } = await supabase.rpc("report_nursing_incident_secure", {
      p_patient_id: positiveId(input.patient_id, "patient_id"),
      p_incident_type: requiredText(input.incident_type, "incident_type", 100),
      p_severity: requiredText(input.severity, "severity", 30),
      p_description: requiredText(input.description, "description"),
      p_idempotency_key: idempotencyKey(input.idempotencyKey),
    });
    if (error) throw new Error(error.message);
    return singleRpcRow<NursingIncident>(data, "registrar intercorrencia");
  },

  async procedures(): Promise<NursingProcedure[]> {
    const { data, error } = await supabase.from("nursing_procedures").select("*").order("performed_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    return (data || []) as unknown as NursingProcedure[];
  },

  async createProcedure(input: CreateProcedureInput): Promise<void> {
    assertNoServerOwnedFields(input);
    const { error } = await supabase.rpc("record_nursing_procedure_secure", {
      p_patient_id: positiveId(input.patient_id, "patient_id"),
      p_procedure_type: requiredText(input.procedure_type, "procedure_type", 150),
      p_description: optionalText(input.description, "description", 4_000),
      p_faturavel: input.faturavel ?? false,
      p_idempotency_key: idempotencyKey(input.idempotencyKey),
    });
    if (error) throw new Error(error.message);
  },

  async createHandoff(input: CreateHandoffInput): Promise<void> {
    assertNoServerOwnedFields(input);
    const { error } = await supabase.rpc("create_nursing_shift_handoff_secure", {
      p_shift_date: optionalIsoDate(input.shift_date, "shift_date"),
      p_shift_type: requiredText(input.shift_type, "shift_type", 50),
      p_summary: requiredText(input.summary, "summary"),
      p_pending_items: input.pending_items ?? null,
      p_critical_patients: input.critical_patients ?? null,
      p_notes: optionalText(input.notes, "notes", 4_000),
      p_idempotency_key: idempotencyKey(input.idempotencyKey),
    });
    if (error) throw new Error(error.message);
  },

  async stats(): Promise<{ medPendentes: number; medAdministradas: number; incidentesGraves: number; procedimentos: number }> {
    const [meds, incs, procs] = await Promise.all([this.medications(), this.incidents(), this.procedures()]);
    return {
      medPendentes: meds.filter((m) => ["pendente", "em_preparo"].includes(m.status)).length,
      medAdministradas: meds.filter((m) => m.status === "administrado").length,
      incidentesGraves: incs.filter((i) => ["grave", "critica"].includes(i.severity)).length,
      procedimentos: procs.length,
    };
  },
};

