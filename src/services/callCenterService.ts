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
  company_id?: string | null;
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

async function currentActor() {
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id ?? null;
  if (!userId) return { userId: null, companyId: null };

  const { data } = await supabase
    .from("user_profiles")
    .select("id, company_id")
    .eq("id", userId)
    .maybeSingle();

  return { userId, companyId: data?.company_id ?? null };
}

export const callCenterService = {
  async refreshConfirmationQueue(daysAhead = 3): Promise<number> {
    const { data, error } = await supabase.rpc("refresh_confirmation_queue_secure", { p_days_ahead: daysAhead });
    if (error) throw new Error(`Erro ao atualizar fila de confirmação: ${error.message}`);
    return Number(data || 0);
  },

  async listConfirmationQueue(): Promise<ConfirmationQueueItem[]> {
    const { data, error } = await supabase.from("scheduling_confirmation_queue").select("*").in("status", ["pending", "contacting", "no_response"]).order("due_at").limit(300);
    if (error) throw new Error(`Erro ao listar confirmações: ${error.message}`);
    const rows = (data || []) as ConfirmationQueueItem[];
    const ids = [...new Set(rows.map((row) => row.patient_id).filter(Boolean))] as number[];
    const patients = ids.length ? await supabase.from("patients").select("id, full_name, phone").in("id", ids) : { data: [] as any[] };
    const map = new Map((patients.data || []).map((row: any) => [Number(row.id), row]));
    return rows.map((row) => ({ ...row, patient_name: row.patient_id ? map.get(Number(row.patient_id))?.full_name : undefined, patient_phone: row.patient_id ? map.get(Number(row.patient_id))?.phone : undefined }));
  },

  async recordConfirmation(id: number, outcome: "confirmed" | "cancelled" | "no_answer" | "message_sent" | "invalid_number" | "callback_requested", notes?: string): Promise<void> {
    const { error } = await supabase.rpc("record_confirmation_attempt_secure", { p_queue_id: id, p_channel: "telefone", p_outcome: outcome, p_notes: notes || null });
    if (error) throw new Error(`Erro ao registrar confirmação: ${error.message}`);
  },

  async listContacts(limit = 100): Promise<CallCenterContactLog[]> {
    const { data, error } = await supabase
      .from("scheduling_contact_logs")
      .select("*, patients:patient_id(full_name, cpf, phone)")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Erro ao listar contatos do call center: ${error.message}`);

    return (data || []).map((row: any) => ({
      ...row,
      patient_name: row.patients?.full_name ?? null,
      patient_cpf: row.patients?.cpf ?? null,
      patient_phone: row.patients?.phone ?? null,
    }));
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
    return (data || []) as CallCenterTask[];
  },

  async createContact(input: CreateContactLogInput): Promise<CallCenterContactLog> {
    const patientId = nullableNumber(input.patient_id, "Paciente");
    const appointmentId = nullableNumber(input.appointment_id, "Agendamento");
    const contactReason = requireText(input.contact_reason, "Motivo do contato");

    const { data, error } = await supabase.rpc("create_call_center_contact_secure", {
      p_patient_id: patientId,
      p_appointment_id: appointmentId,
      p_channel: input.channel,
      p_direction: input.direction,
      p_contact_reason: contactReason,
      p_result: input.result,
      p_notes: input.notes?.trim() || null,
      p_next_action: input.next_action?.trim() || null,
      p_next_action_at: input.next_action_at || null,
      p_create_task: Boolean(input.create_task),
    });

    if (error) throw new Error(`Erro ao registrar contato do call center: ${error.message}`);
    return data as CallCenterContactLog;
  },

  async createTask(input: {
    patient_id?: string | number | null;
    appointment_id?: string | number | null;
    contact_log_id?: string | number | null;
    company_id?: string | null;
    assigned_to?: string | null;
    task_type: string;
    description: string;
    due_at?: string | null;
    priority?: CallCenterTaskPriority;
  }): Promise<CallCenterTask> {
    const description = requireText(input.description, "Descrição da tarefa");

    const { data, error } = await supabase.rpc("create_call_center_task_secure", {
      p_patient_id: nullableNumber(input.patient_id, "Paciente"),
      p_appointment_id: nullableNumber(input.appointment_id, "Agendamento"),
      p_contact_log_id: nullableNumber(input.contact_log_id, "Contato"),
      p_assigned_to: input.assigned_to || null,
      p_task_type: requireText(input.task_type, "Tipo da tarefa"),
      p_description: description,
      p_due_at: input.due_at || null,
      p_priority: input.priority || "normal",
    });

    if (error) throw new Error(`Erro ao criar tarefa do call center: ${error.message}`);
    return data as CallCenterTask;
  },

  async completeTask(id: string | number): Promise<void> {
    const taskId = nullableNumber(id, "Tarefa");
    if (taskId === null) throw new Error("Tarefa é obrigatória.");

    const { error } = await supabase.rpc("complete_call_center_task_secure", {
      p_task_id: taskId,
    });

    if (error) throw new Error(`Erro ao concluir tarefa do call center: ${error.message}`);
  }
};
