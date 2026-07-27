import { supabase } from "@/lib/supabase";
import { localDateKey } from "@/utils/formatters";
import type { EligibilityStatus } from "@/services/insuranceEligibilityService";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseAppointmentId(value: string): number {
  const appointmentId = Number(value);
  if (!Number.isSafeInteger(appointmentId) || appointmentId <= 0) {
    throw new Error("Identificador do agendamento inválido");
  }
  return appointmentId;
}

export interface CheckinIssue { type: string; severity: "warning" | "blocking"; description: string }
export interface CheckinReadiness { appointment_id: number; patient_id: number; ready: boolean; issues: CheckinIssue[]; has_authorization_pending: boolean; has_document_pending: boolean }
export interface ReceptionExceptionCapability { appointment_id: number; unit_id: number; allowed: boolean }
export interface ReceptionPrecheckinContext { appointment_id: number; patient_id: number | null; unit_id: number | null; ready: boolean; issues: CheckinIssue[]; has_document_pending: boolean; has_consent_pending: boolean; has_insurance_pending?: boolean; has_authorization_pending?: boolean; document_issues: CheckinIssue[]; consent_issues: CheckinIssue[]; insurance_issues?: CheckinIssue[]; authorization_issues?: CheckinIssue[] }
export interface ReceptionPatientAppointment { id: string; appointmentDate: string; startTime: string; endTime: string | null; status: string; unitId: number | null; professionalId: number | null; appointmentTypeId: number | null }
export interface CheckinResult { checkin_id: number; ticket_id: number; ticket: string; released_by_exception: boolean; issues: CheckinIssue[]; idempotent?: boolean }
export interface ReceptionPendingItem { id: string; kind: "authorization" | "eligibility"; appointment_id: number | null; patient_id: number | null; status: string; protocol_number: string | null; description: string | null; created_at: string; patient_name?: string }
export interface ReceptionQueueTicket { id: number; unit_id: number | null; issued_unit_id: number | null; patient_id: number | null; appointment_id: number | null; prefix: string; number: number; priority: string; sector: string; status: string; ticket_date: string; issued_at: string; called_at: string | null; completed_at: string | null; transferred_at: string | null; transferred_to_unit_id: number | null; sla_minutes: number; sla_due_at: string }
export interface ReceptionEligibilityUpdate {
  status: EligibilityStatus;
  protocol?: string;
  resultDetail?: string;
  exceptionReason?: string;
  blockReason?: string;
}

interface AppointmentIdRow {
  id: number | string;
}

interface PendingAuthorizationRow {
  id: string;
  appointment_id: number | null;
  patient_id: number | null;
  status: string;
  protocol_number: string | null;
  procedure_desc: string | null;
  created_at: string;
}

interface PendingEligibilityRow {
  id: string;
  appointment_id: number | null;
  patient_id: number | null;
  status: string;
  protocol_number: string | null;
  result_detail: string | null;
  created_at: string;
}

interface PatientNameRow {
  id: number | string;
  full_name: string;
}

export function formatReceptionQueueTicketLabel(
  ticket: Pick<ReceptionQueueTicket, "prefix" | "number" | "unit_id" | "issued_unit_id">,
  mode: "compact" | "accessible" = "compact",
): string {
  const baseLabel = `${ticket.prefix}${String(ticket.number).padStart(3, "0")}`;
  const hasDifferentOrigin = ticket.unit_id != null
    && ticket.issued_unit_id != null
    && Number(ticket.unit_id) !== Number(ticket.issued_unit_id);

  if (!hasDifferentOrigin) return baseLabel;

  return mode === "accessible"
    ? `${baseLabel}, origem unidade ${ticket.issued_unit_id}`
    : `${baseLabel} · origem U${ticket.issued_unit_id}`;
}

export const receptionService = {
  async getReadiness(appointmentId: string): Promise<CheckinReadiness> {
    const { data, error } = await supabase.rpc("get_reception_checkin_readiness", { p_appointment_id: parseAppointmentId(appointmentId) });
    if (error) throw new Error(`Erro ao validar check-in: ${error.message}`);
    return data as CheckinReadiness;
  },
  async getPrecheckinContext(appointmentId: string): Promise<ReceptionPrecheckinContext> {
    const { data, error } = await supabase.rpc("get_reception_precheckin_context", { p_appointment_id: parseAppointmentId(appointmentId) });
    if (error) throw new Error(`Erro ao validar documentos do check-in: ${error.message}`);
    return data as ReceptionPrecheckinContext;
  },
  async listPatientAppointments(patientId: string, limit = 20): Promise<ReceptionPatientAppointment[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
    const { data, error } = await supabase.rpc("get_reception_patient_appointments_secure", {
      p_patient_id: parseAppointmentId(patientId),
      p_limit: safeLimit,
    });
    if (error) throw new Error(`Erro ao listar agendamentos do paciente: ${error.message}`);
    if (!Array.isArray(data)) {
      throw new Error("Resposta inválida ao listar agendamentos do paciente");
    }
    return data as ReceptionPatientAppointment[];
  },
  async getExceptionCapability(appointmentId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("get_reception_exception_capability", {
      p_appointment_id: parseAppointmentId(appointmentId),
    });
    if (error) throw new Error(`Erro ao validar permissão de exceção: ${error.message}`);
    const capability = (Array.isArray(data) ? data[0] : data) as ReceptionExceptionCapability | null;
    if (!capability || capability.appointment_id !== parseAppointmentId(appointmentId)) {
      throw new Error("Resposta inválida ao validar permissão de exceção");
    }
    return capability.allowed === true;
  },
  async checkin(workflowId: string, appointmentId: string, priority: "normal" | "legal" | "urgent", exceptionReason?: string): Promise<CheckinResult> {
    if (!UUID_PATTERN.test(workflowId)) {
      throw new Error("Identificador do workflow inválido");
    }
    const parsedAppointmentId = parseAppointmentId(appointmentId);
    const { data, error } = await supabase.rpc("perform_reception_checkin_secure", {
      p_workflow_id: workflowId,
      p_appointment_id: parsedAppointmentId,
      p_priority: priority,
      p_exception_reason: exceptionReason || null,
    });
    if (error) throw new Error(`Erro ao realizar check-in: ${error.message}`);
    return data as CheckinResult;
  },
  async listQueue(unitId?: number, date = localDateKey()): Promise<ReceptionQueueTicket[]> {
    let query = supabase
      .from("reception_queue_tickets")
      .select("id,unit_id,issued_unit_id,patient_id,appointment_id,prefix,number,priority,sector,status,ticket_date,issued_at,called_at,completed_at,transferred_at,transferred_to_unit_id,sla_minutes,sla_due_at")
      .eq("ticket_date", date)
      .order("issued_at", { ascending: true })
      .limit(200);
    if (unitId != null) query = query.eq("unit_id", unitId);
    const { data, error } = await query;
    if (error) throw new Error(`Erro ao listar fila de recepção: ${error.message}`);
    return (data || []) as ReceptionQueueTicket[];
  },
  async transitionQueueTicket(ticketId: number, status: ReceptionQueueTicket["status"], reason?: string, destinationUnitId?: number): Promise<void> {
    const { error } = await supabase.rpc("transition_reception_queue_ticket_secure", { p_ticket_id: ticketId, p_to_status: status, p_reason: reason || null, p_destination_unit_id: destinationUnitId ?? null });
    if (error) throw new Error(`Erro ao atualizar fila de recepção: ${error.message}`);
  },
  async listPending(unitId?: number): Promise<ReceptionPendingItem[]> {
    let appointmentIds: number[] | null = null;
    if (unitId != null) {
      const appointments = await supabase
        .from("appointments")
        .select("id")
        .eq("unit_id", unitId);
      if (appointments.error) {
        throw new Error(`Erro ao delimitar pendências por unidade: ${appointments.error.message}`);
      }
      appointmentIds = ((appointments.data || []) as AppointmentIdRow[]).map((row) => Number(row.id));
    }

    let authorizationQuery = supabase
      .from("reception_authorizations")
      .select("id,appointment_id,patient_id,status,protocol_number,procedure_desc,created_at")
      .in("status", ["pendente","solicitada","em_analise","negada","reenviada"])
      .order("created_at")
      .limit(200);
    let eligibilityQuery = supabase
      .from("reception_eligibility_checks")
      .select("id,appointment_id,patient_id,status,protocol_number,result_detail,created_at")
      .in("status", ["pendente","em_analise","nao_elegivel","portal_indisponivel"])
      .order("created_at")
      .limit(200);

    if (appointmentIds != null) {
      if (appointmentIds.length === 0) return [];
      authorizationQuery = authorizationQuery.in("appointment_id", appointmentIds);
      eligibilityQuery = eligibilityQuery.eq("unit_id", unitId);
    }

    const [auth, eligibility] = await Promise.all([
      authorizationQuery,
      eligibilityQuery,
    ]);
    if (auth.error) throw new Error(`Erro ao listar autorizações: ${auth.error.message}`);
    if (eligibility.error) throw new Error(`Erro ao listar elegibilidades: ${eligibility.error.message}`);
    const authorizationRows = (auth.data || []) as PendingAuthorizationRow[];
    const eligibilityRows = (eligibility.data || []) as PendingEligibilityRow[];
    const rows: ReceptionPendingItem[] = [
      ...authorizationRows.map((row) => ({ id: row.id, kind: "authorization" as const, appointment_id: row.appointment_id, patient_id: row.patient_id, status: row.status, protocol_number: row.protocol_number, description: row.procedure_desc, created_at: row.created_at })),
      ...eligibilityRows.map((row) => ({ id: row.id, kind: "eligibility" as const, appointment_id: row.appointment_id, patient_id: row.patient_id, status: row.status, protocol_number: row.protocol_number, description: row.result_detail, created_at: row.created_at })),
    ];
    const ids = [...new Set(rows.map((row) => row.patient_id).filter(Boolean))] as number[];
    let patientRows: PatientNameRow[] = [];
    if (ids.length) {
      const patients = await supabase.from("patients").select("id,full_name").in("id", ids);
      if (patients.error) {
        throw new Error(`Erro ao carregar pacientes das pendências: ${patients.error.message}`);
      }
      patientRows = (patients.data || []) as PatientNameRow[];
    }
    const map = new Map(patientRows.map((row) => [Number(row.id), row.full_name]));
    return rows.map((row) => ({ ...row, patient_name: row.patient_id ? map.get(Number(row.patient_id)) : undefined }));
  },
  async updateAuthorization(id: string, input: { status: string; protocol?: string; authorizationNumber?: string; password?: string; validUntil?: string; quantity?: number; reason?: string }): Promise<void> {
    const { error } = await supabase.rpc("transition_insurance_authorization_secure", {
      p_authorization_id: id,
      p_status: input.status,
      p_protocol_number: input.protocol || null,
      p_authorization_number: input.authorizationNumber || null,
      p_password_number: input.password || null,
      p_valid_until: input.validUntil || null,
      p_quantity_authorized: input.quantity ?? null,
      p_quantity_used: null,
      p_reason: input.reason || null,
    });
    if (error) throw new Error(`Erro ao atualizar autorização: ${error.message}`);
  },
  async updateEligibility(id: string, input: ReceptionEligibilityUpdate): Promise<void> {
    const { error } = await supabase.rpc("update_insurance_eligibility_check_secure", {
      p_eligibility_id: id,
      p_status: input.status,
      p_request_channel: null,
      p_protocol_number: input.protocol || null,
      p_valid_from: null,
      p_valid_until: null,
      p_result_code: null,
      p_result_detail: input.resultDetail || null,
      p_proof_reference: null,
      p_proof_sha256: null,
      p_proof_content_type: null,
      p_exception_reason: input.exceptionReason || null,
      p_block_reason: input.blockReason || null,
    });
    if (error) throw new Error(`Erro ao atualizar elegibilidade: ${error.message}`);
  },
};
