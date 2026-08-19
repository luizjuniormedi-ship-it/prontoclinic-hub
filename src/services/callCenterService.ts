import { supabase } from "@/lib/supabase";

export type CallCenterChannel = "telefone" | "whatsapp" | "email" | "portal" | "presencial" | "campanha" | "instagram" | "google" | "site" | "convenio" | "indicacao";
export type CallCenterDirection = "inbound" | "outbound";
export type CallCenterResult = "agendado" | "confirmado" | "cancelado" | "remarcado" | "nao_atendeu" | "recado" | "sem_interesse" | "numero_invalido" | "retornar_depois";
export type CallCenterTaskStatus = "pending" | "in_progress" | "done" | "cancelled";
export type CallCenterTaskPriority = "low" | "normal" | "high" | "urgent";

export interface CallCenterContactLog {
  id: number;
  company_id: string | null;
  patient_id: number | null;
  appointment_id: number | null;
  operator_id: string | null;
  channel: CallCenterChannel;
  direction: CallCenterDirection;
  contact_reason: string;
  result: CallCenterResult;
  notes: string | null;
  next_action: string | null;
  next_action_at: string | null;
  created_at: string;
  updated_at: string;
  patient_name?: string | null;
  patient_cpf?: string | null;
  patient_phone?: string | null;
}

export interface CallCenterTask {
  id: number;
  company_id: string | null;
  patient_id: number | null;
  appointment_id: number | null;
  contact_log_id: number | null;
  assigned_to: string | null;
  task_type: string;
  priority: CallCenterTaskPriority;
  status: CallCenterTaskStatus;
  due_at: string | null;
  description: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateContactLogInput {
  patient_id?: string | number | null;
  appointment_id?: string | number | null;
  channel: CallCenterChannel;
  direction: CallCenterDirection;
  contact_reason: string;
  result: CallCenterResult;
  notes?: string | null;
  next_action?: string | null;
  next_action_at?: string | null;
  create_task?: boolean;
}

export interface ConfirmationQueueItem {
  id: number;
  appointment_id: number;
  patient_id: number | null;
  due_at: string;
  status: "pending" | "contacting" | "confirmed" | "cancelled" | "no_response" | "expired";
  attempt_count: number;
  last_attempt_at: string | null;
  patient_name?: string;
  patient_phone?: string;
}

const CALL_CENTER_CHANNELS: readonly CallCenterChannel[] = ["telefone", "whatsapp", "email", "portal", "presencial", "campanha", "instagram", "google", "site", "convenio", "indicacao"];
const CALL_CENTER_DIRECTIONS: readonly CallCenterDirection[] = ["inbound", "outbound"];
const CALL_CENTER_RESULTS: readonly CallCenterResult[] = ["agendado", "confirmado", "cancelado", "remarcado", "nao_atendeu", "recado", "sem_interesse", "numero_invalido", "retornar_depois"];
const TASK_STATUSES: readonly CallCenterTaskStatus[] = ["pending", "in_progress", "done", "cancelled"];
const TASK_PRIORITIES: readonly CallCenterTaskPriority[] = ["low", "normal", "high", "urgent"];
const CONFIRMATION_STATUSES: readonly ConfirmationQueueItem["status"][] = ["pending", "contacting", "confirmed", "cancelled", "no_response", "expired"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredStringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Contrato do Call Center inválido em ${field}.`);
  return value;
}

function nullableStringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("Contrato do Call Center contém texto inválido.");
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Contrato do Call Center inválido em ${field}.`);
  return parsed;
}

function nullablePositiveInteger(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : positiveInteger(value, field);
}

function nonNegativeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Contrato do Call Center inválido em ${field}.`);
  return parsed;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`Contrato do Call Center inválido em ${field}.`);
  return value as T;
}

function decodePatient(value: unknown): { id: number; full_name: string | null; phone: string | null } {
  if (!isRecord(value)) throw new Error("Contrato do Call Center inválido em patients.");
  return {
    id: positiveInteger(value.id, "patients.id"),
    full_name: nullableStringValue(value.full_name),
    phone: nullableStringValue(value.phone),
  };
}

function decodeConfirmation(value: unknown): ConfirmationQueueItem {
  if (!isRecord(value)) throw new Error("Contrato da fila de confirmação inválido.");
  return {
    id: positiveInteger(value.id, "confirmation.id"),
    appointment_id: positiveInteger(value.appointment_id, "confirmation.appointment_id"),
    patient_id: nullablePositiveInteger(value.patient_id, "confirmation.patient_id"),
    due_at: requiredStringValue(value.due_at, "confirmation.due_at"),
    status: enumValue(value.status, CONFIRMATION_STATUSES, "confirmation.status"),
    attempt_count: nonNegativeInteger(value.attempt_count, "confirmation.attempt_count"),
    last_attempt_at: nullableStringValue(value.last_attempt_at),
  };
}

function decodeContact(value: unknown): CallCenterContactLog {
  if (!isRecord(value)) throw new Error("Contrato de contato do Call Center inválido.");
  if (value.patients !== null && value.patients !== undefined && !isRecord(value.patients)) {
    throw new Error("Contrato do Call Center inválido em contact.patients.");
  }
  const patientRelation = isRecord(value.patients) ? value.patients : null;
  return {
    id: positiveInteger(value.id, "contact.id"),
    company_id: nullableStringValue(value.company_id),
    patient_id: nullablePositiveInteger(value.patient_id, "contact.patient_id"),
    appointment_id: nullablePositiveInteger(value.appointment_id, "contact.appointment_id"),
    operator_id: nullableStringValue(value.operator_id),
    channel: enumValue(value.channel, CALL_CENTER_CHANNELS, "contact.channel"),
    direction: enumValue(value.direction, CALL_CENTER_DIRECTIONS, "contact.direction"),
    contact_reason: requiredStringValue(value.contact_reason, "contact.contact_reason"),
    result: enumValue(value.result, CALL_CENTER_RESULTS, "contact.result"),
    notes: nullableStringValue(value.notes),
    next_action: nullableStringValue(value.next_action),
    next_action_at: nullableStringValue(value.next_action_at),
    created_at: requiredStringValue(value.created_at, "contact.created_at"),
    updated_at: requiredStringValue(value.updated_at, "contact.updated_at"),
    patient_name: nullableStringValue(patientRelation?.full_name),
    patient_cpf: nullableStringValue(patientRelation?.cpf),
    patient_phone: nullableStringValue(patientRelation?.phone),
  };
}

function decodeTask(value: unknown): CallCenterTask {
  if (!isRecord(value)) throw new Error("Contrato de tarefa do Call Center inválido.");
  return {
    id: positiveInteger(value.id, "task.id"), company_id: nullableStringValue(value.company_id),
    patient_id: nullablePositiveInteger(value.patient_id, "task.patient_id"), appointment_id: nullablePositiveInteger(value.appointment_id, "task.appointment_id"),
    contact_log_id: nullablePositiveInteger(value.contact_log_id, "task.contact_log_id"), assigned_to: nullableStringValue(value.assigned_to),
    task_type: requiredStringValue(value.task_type, "task.task_type"), priority: enumValue(value.priority, TASK_PRIORITIES, "task.priority"),
    status: enumValue(value.status, TASK_STATUSES, "task.status"), due_at: nullableStringValue(value.due_at),
    description: requiredStringValue(value.description, "task.description"), completed_at: nullableStringValue(value.completed_at),
    created_at: requiredStringValue(value.created_at, "task.created_at"), updated_at: requiredStringValue(value.updated_at, "task.updated_at"),
  };
}

function nullableNumber(value: string | number | null | undefined, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} inválido.`);
  return parsed;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} é obrigatório.`);
  return normalized;
}

export const callCenterService = {
  async materializeConfirmationQueue(daysAhead = 3): Promise<number> {
    const { data, error } = await supabase.rpc("refresh_confirmation_queue_secure", { p_days_ahead: daysAhead });
    if (error) throw new Error(`Erro ao atualizar fila de confirmação: ${error.message}`);
    const affectedRows = typeof data === "number" ? data : Number(data);
    if (!Number.isSafeInteger(affectedRows) || affectedRows < 0) {
      throw new Error("Fila de confirmação retornou quantidade inválida.");
    }
    return affectedRows;
  },

  async listConfirmationQueue(): Promise<ConfirmationQueueItem[]> {
    const { data, error } = await supabase.from("scheduling_confirmation_queue").select("*").in("status", ["pending", "contacting", "no_response"]).order("due_at").limit(300);
    if (error) throw new Error(`Erro ao listar confirmações: ${error.message}`);
    if (!Array.isArray(data)) throw new Error("Fila de confirmação retornou resposta inválida.");
    const rows = data.map(decodeConfirmation);
    const ids = [...new Set(rows.map((row) => row.patient_id).filter(Boolean))] as number[];
    const patientsResult = ids.length
      ? await supabase.from("patients").select("id, full_name, phone").in("id", ids)
      : { data: [], error: null };
    if (patientsResult.error) throw new Error(`Erro ao carregar pacientes da fila de confirmação: ${patientsResult.error.message}`);
    if (!Array.isArray(patientsResult.data)) throw new Error("Consulta de pacientes retornou resposta inválida.");
    const map = new Map(patientsResult.data.map(decodePatient).map((row) => [row.id, row]));
    return rows.map((row) => ({ ...row, patient_name: row.patient_id ? map.get(Number(row.patient_id))?.full_name : undefined, patient_phone: row.patient_id ? map.get(Number(row.patient_id))?.phone : undefined }));
  },

  async recordConfirmation(id: number, outcome: "confirmed" | "cancelled" | "no_answer" | "message_sent" | "invalid_number" | "callback_requested", notes?: string): Promise<void> {
    const { error } = await supabase.rpc("record_confirmation_attempt_secure", { p_queue_id: id, p_channel: "telefone", p_outcome: outcome, p_notes: notes || null });
    if (error) throw new Error(`Erro ao registrar confirmação: ${error.message}`);
  },

  async listContacts(limit = 100): Promise<CallCenterContactLog[]> {
    const { data, error } = await supabase
      .from("scheduling_contact_logs")
      .select("id, company_id, patient_id, appointment_id, operator_id, channel, direction, contact_reason, result, notes, next_action, next_action_at, created_at, updated_at, patients:patient_id(full_name, cpf, phone)")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Erro ao listar contatos do call center: ${error.message}`);

    if (!Array.isArray(data)) throw new Error("Lista de contatos retornou resposta inválida.");
    return data.map(decodeContact);
  },

  async listTasks(status?: CallCenterTaskStatus): Promise<CallCenterTask[]> {
    let query = supabase
      .from("scheduling_call_center_tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw new Error(`Erro ao listar tarefas do call center: ${error.message}`);
    if (!Array.isArray(data)) throw new Error("Lista de tarefas retornou resposta inválida.");
    return data.map(decodeTask);
  },

  async createContact(input: CreateContactLogInput): Promise<CallCenterContactLog> {
    const patientId = nullableNumber(input.patient_id, "Paciente");
    const appointmentId = nullableNumber(input.appointment_id, "Agendamento");
    const contactReason = requireText(input.contact_reason, "Motivo do contato");
    const notes = input.notes?.trim() || null;
    const nextAction = input.next_action?.trim() || null;

    const { data, error } = await supabase.rpc("record_call_center_contact_secure", {
      p_patient_id: patientId,
      p_appointment_id: appointmentId,
      p_channel: input.channel,
      p_direction: input.direction,
      p_contact_reason: contactReason,
      p_result: input.result,
      p_notes: notes,
      p_next_action: nextAction,
      p_next_action_at: input.next_action_at || null,
      p_create_task: Boolean(input.create_task),
    });

    if (error) throw new Error(`Erro ao registrar contato do call center: ${error.message}`);
    return decodeContact(data);
  },

  async completeTask(id: string | number): Promise<void> {
    const taskId = nullableNumber(id, "Tarefa");
    if (taskId === null) throw new Error("Tarefa é obrigatória.");

    const { error } = await supabase.rpc("complete_call_center_task_secure", {
      p_task_id: taskId,
    });

    if (error) throw new Error(`Erro ao concluir tarefa do call center: ${error.message}`);
  },
};
