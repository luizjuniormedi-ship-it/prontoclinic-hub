import { supabase } from "@/lib/supabase";
import type { ReceptionCheckoutSummary } from "@/services/receptionCheckoutService";

export interface CheckinIssue {
  type: string;
  severity: "warning" | "blocking";
  description: string;
}

export interface CheckinReadiness {
  appointment_id: number;
  patient_id: number;
  ready: boolean;
  issues: CheckinIssue[];
  has_authorization_pending: boolean;
  has_document_pending: boolean;
  has_payment_pending?: boolean;
  has_tiss_pending?: boolean;
  checkout?: ReceptionCheckoutSummary;
}

export interface CheckinResult {
  checkin_id: number;
  ticket_id: number;
  ticket: string;
  billing_account_id?: number | null;
  tiss_guide_id?: number | null;
  released_by_exception: boolean;
  issues: CheckinIssue[];
}

export interface ReceptionPendingItem {
  id: string;
  kind: "authorization" | "eligibility";
  appointment_id: number | null;
  patient_id: number | null;
  status: string;
  protocol_number: string | null;
  description: string | null;
  created_at: string;
  patient_name?: string;
}

export const receptionService = {
  async getReadiness(appointmentId: string): Promise<CheckinReadiness> {
    const { data, error } = await supabase.rpc("get_reception_checkin_readiness", {
      p_appointment_id: Number(appointmentId),
    });
    if (error) throw new Error(`Erro ao validar check-in: ${error.message}`);
    return data as CheckinReadiness;
  },

  async checkin(
    appointmentId: string,
    priority: "normal" | "legal" | "urgent",
    exceptionReason?: string,
  ): Promise<CheckinResult> {
    const { data, error } = await supabase.rpc("perform_reception_checkin_secure", {
      p_appointment_id: Number(appointmentId),
      p_priority: priority,
      p_exception_reason: exceptionReason || null,
    });
    if (error) throw new Error(`Erro ao realizar check-in: ${error.message}`);
    return data as CheckinResult;
  },

  async listPending(): Promise<ReceptionPendingItem[]> {
    const [authorizations, eligibility] = await Promise.all([
      supabase
        .from("reception_authorizations")
        .select("id,appointment_id,patient_id,status,protocol_number,procedure_desc,created_at")
        .in("status", ["pendente", "solicitada", "em_analise", "negada", "reenviada"])
        .order("created_at")
        .limit(200),
      supabase
        .from("reception_eligibility_checks")
        .select("id,appointment_id,patient_id,status,protocol_number,result_detail,created_at")
        .in("status", ["pendente", "em_analise", "nao_elegivel", "portal_indisponivel"])
        .order("created_at")
        .limit(200),
    ]);

    if (authorizations.error) throw new Error(`Erro ao listar autorizações: ${authorizations.error.message}`);
    if (eligibility.error) throw new Error(`Erro ao listar elegibilidades: ${eligibility.error.message}`);

    const rows: ReceptionPendingItem[] = [
      ...(authorizations.data || []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        kind: "authorization" as const,
        appointment_id: row.appointment_id == null ? null : Number(row.appointment_id),
        patient_id: row.patient_id == null ? null : Number(row.patient_id),
        status: String(row.status || "pendente"),
        protocol_number: row.protocol_number ? String(row.protocol_number) : null,
        description: row.procedure_desc ? String(row.procedure_desc) : null,
        created_at: String(row.created_at || ""),
      })),
      ...(eligibility.data || []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        kind: "eligibility" as const,
        appointment_id: row.appointment_id == null ? null : Number(row.appointment_id),
        patient_id: row.patient_id == null ? null : Number(row.patient_id),
        status: String(row.status || "pendente"),
        protocol_number: row.protocol_number ? String(row.protocol_number) : null,
        description: row.result_detail ? String(row.result_detail) : null,
        created_at: String(row.created_at || ""),
      })),
    ];

    const patientIds = [...new Set(rows.map((row) => row.patient_id).filter(Boolean))] as number[];
    const patientRows = patientIds.length
      ? await supabase.from("patients").select("id,full_name").in("id", patientIds)
      : { data: [] as Array<{ id: number; full_name: string }> };
    const patientNames = new Map(
      (patientRows.data || []).map((row) => [Number(row.id), row.full_name]),
    );

    return rows.map((row) => ({
      ...row,
      patient_name: row.patient_id ? patientNames.get(Number(row.patient_id)) : undefined,
    }));
  },

  async updateAuthorization(
    id: string,
    input: {
      status: string;
      protocol?: string;
      authorizationNumber?: string;
      password?: string;
      validUntil?: string;
      quantity?: number;
      reason?: string;
    },
  ): Promise<void> {
    const { error } = await supabase.rpc("update_reception_authorization_secure", {
      p_authorization_id: id,
      p_status: input.status,
      p_protocol_number: input.protocol || null,
      p_authorization_number: input.authorizationNumber || null,
      p_password_number: input.password || null,
      p_valid_until: input.validUntil || null,
      p_quantity_authorized: input.quantity || null,
      p_reason: input.reason || null,
    });
    if (error) throw new Error(`Erro ao atualizar autorização: ${error.message}`);
  },

  async updateEligibility(
    id: string,
    input: { status: string; protocol?: string; detail?: string },
  ): Promise<void> {
    const { error } = await supabase.rpc("update_reception_eligibility_secure", {
      p_eligibility_id: id,
      p_status: input.status,
      p_protocol_number: input.protocol || null,
      p_result_detail: input.detail || null,
    });
    if (error) throw new Error(`Erro ao atualizar elegibilidade: ${error.message}`);
  },
};
