/**
 * notificationService.ts
 *
 * Camada de serviço para o sistema de notificações multicanal
 * (E-mail + WhatsApp + SMS). Substitui o SMTP quebrado do SIGH.
 *
 * Padrão: enfileira via RPC `queue_notification` (resolve template no banco)
 * e o worker Python (ou Supabase Edge Function) consome a tabela `notifications`.
 *
 * Vantagens:
 *  - Templates versionados e auditáveis (não hardcoded)
 *  - LGPD: opt-out por canal em `notification_preferences`
 *  - Retry automático com backoff (até max_attempts)
 *  - Rate limiting controlado pelo worker
 *  - Logs estruturados em `notification_logs`
 */

import { supabase } from "@/lib/supabase";
import { env } from "@/lib/env";

// =============================================================================
// Tipos
// =============================================================================

export type NotificationChannel = "EMAIL" | "SMS" | "WHATSAPP" | "PUSH";
export type RecipientType = "PATIENT" | "PROFESSIONAL" | "STAFF";

export type NotificationStatus =
  | "PENDING"
  | "PROCESSING"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED"
  | "CANCELLED";

export interface NotificationRecipient {
  recipientType: RecipientType;
  recipientId: number;
  recipientName: string;
  recipientEmail?: string;
  recipientPhone?: string;     // formato E.164: +5511999999999
  recipientWhatsapp?: string;  // formato E.164
}

export interface NotificationRecord {
  id: string;
  company_id: string;
  recipient_type: RecipientType;
  recipient_id: number | null;
  recipient_name: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  recipient_whatsapp: string | null;
  channel: NotificationChannel;
  template_code: string | null;
  subject: string | null;
  body: string;
  variables: Record<string, unknown>;
  status: NotificationStatus;
  attempts: number;
  max_attempts: number;
  dt_queued: string;
  dt_scheduled_for: string | null;
  dt_sent: string | null;
  dt_delivered: string | null;
  error_code: string | null;
  error_message: string | null;
  provider_message_id: string | null;
  appointment_id: number | null;
}

export interface AppointmentLite {
  id: number;
  company_id: string;
  patient_id: number;
  professional_id: number;
  dt_appointment: string;  // ISO
  status: string;
  patient?: {
    nm_patient: string;
    ds_email?: string;
    nr_phone?: string;
    nr_whatsapp?: string;
  };
  professional?: {
    nm_professional: string;
  };
}

export interface NotificationStats {
  channel: NotificationChannel;
  total: number;
  sent: number;
  failed: number;
  cancelled: number;
  pending: number;
  delivered: number;
  taxa_sucesso_pct: number;
}

// =============================================================================
// Helper: formatar data/hora em pt-BR
// =============================================================================
function formatDateBR(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatTimeBR(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

// =============================================================================
// Service principal
// =============================================================================
export const notificationService = {
  // ---------------------------------------------------------------------------
  // 1. Confirmação de consulta
  // ---------------------------------------------------------------------------
  async queueAppointmentConfirmation(appointmentId: number): Promise<string | null> {
    const { data: appointment, error } = await this.fetchAppointment(appointmentId);
    if (error || !appointment) {
      console.error("[notifications] falha ao buscar appointment", appointmentId, error);
      return null;
    }

    if (!appointment.patient?.ds_email) {
      console.warn("[notifications] paciente sem e-mail", appointment.patient_id);
      return null;
    }

    return this.enqueue({
      p_company_id: appointment.company_id,
      p_channel: "EMAIL",
      p_recipient_type: "PATIENT",
      p_recipient_id: appointment.patient_id,
      p_recipient_name: appointment.patient.nm_patient,
      p_recipient_email: appointment.patient.ds_email,
      p_recipient_phone: appointment.patient.nr_phone ?? undefined,
      p_recipient_whatsapp: appointment.patient.nr_whatsapp ?? undefined,
      p_template_code: "APPOINTMENT_CONFIRMATION",
      p_variables: {
        nome_paciente: appointment.patient.nm_patient,
        nome_medico: appointment.professional?.nm_professional ?? "",
        data: formatDateBR(appointment.dt_appointment),
        hora: formatTimeBR(appointment.dt_appointment),
        clinica: env.VITE_APP_NAME,
        endereco: "",
        telefone_clinica: "",
        email_clinica: "",
        link_reagendar: `${env.VITE_APP_URL ?? ""}/appointments/${appointment.id}/reschedule`,
      },
      p_appointment_id: appointment.id,
    });
  },

  // ---------------------------------------------------------------------------
  // 2. Lembrete de consulta (24h ou 1h)
  // ---------------------------------------------------------------------------
  async queueAppointmentReminder(
    appointmentId: number,
    hoursBefore: 24 | 1,
  ): Promise<string | null> {
    const { data: appointment, error } = await this.fetchAppointment(appointmentId);
    if (error || !appointment) {
      console.error("[notifications] falha ao buscar appointment", appointmentId, error);
      return null;
    }

    const code =
      hoursBefore === 24 ? "APPOINTMENT_REMINDER_24H" : "APPOINTMENT_REMINDER_1H";

    // Canal preferido: WhatsApp se habilitado, senão e-mail (24h),
    // SMS para 1h (última milha, mais invasivo)
    const channel: NotificationChannel =
      hoursBefore === 1
        ? appointment.patient?.nr_phone
          ? "SMS"
          : "EMAIL"
        : env.VITE_ENABLE_WHATSAPP && appointment.patient?.nr_whatsapp
          ? "WHATSAPP"
          : "EMAIL";

    const dtAppointment = new Date(appointment.dt_appointment);
    const dtScheduled = new Date(
      dtAppointment.getTime() - hoursBefore * 60 * 60 * 1000,
    );

    const baseVariables = {
      nome_paciente: appointment.patient?.nm_patient ?? "",
      nome_medico: appointment.professional?.nm_professional ?? "",
      data: formatDateBR(appointment.dt_appointment),
      hora: formatTimeBR(appointment.dt_appointment),
      clinica: env.VITE_APP_NAME,
      link_confirmar: `${env.VITE_APP_URL ?? ""}/appointments/${appointment.id}/confirm`,
      link_curto: `${env.VITE_APP_URL ?? ""}/a/${appointment.id}`,
    };

    return this.enqueue({
      p_company_id: appointment.company_id,
      p_channel: channel,
      p_recipient_type: "PATIENT",
      p_recipient_id: appointment.patient_id,
      p_recipient_name: appointment.patient?.nm_patient ?? "",
      p_recipient_email: appointment.patient?.ds_email ?? undefined,
      p_recipient_phone: appointment.patient?.nr_phone ?? undefined,
      p_recipient_whatsapp: appointment.patient?.nr_whatsapp ?? undefined,
      p_template_code: code,
      p_variables: baseVariables,
      p_appointment_id: appointment.id,
      p_dt_scheduled_for: dtScheduled.toISOString(),
    });
  },

  // ---------------------------------------------------------------------------
  // 3. Cancelamento de consulta
  // ---------------------------------------------------------------------------
  async queueAppointmentCancellation(
    appointmentId: number,
    motivo: string,
  ): Promise<string | null> {
    const { data: appointment, error } = await this.fetchAppointment(appointmentId);
    if (error || !appointment) {
      console.error("[notifications] falha ao buscar appointment", appointmentId, error);
      return null;
    }

    // Cancelar lembretes pendentes anteriores
    const { error: cancelError } = await supabase.rpc(
      "cancel_pending_appointment_notifications",
      { p_appointment_id: appointment.id },
    );

    if (cancelError) {
      console.error(
        "[notifications] falha ao cancelar lembretes pendentes",
        appointment.id,
        cancelError,
      );
      return null;
    }

    return this.enqueue({
      p_company_id: appointment.company_id,
      p_channel: "EMAIL",
      p_recipient_type: "PATIENT",
      p_recipient_id: appointment.patient_id,
      p_recipient_name: appointment.patient?.nm_patient ?? "",
      p_recipient_email: appointment.patient?.ds_email ?? undefined,
      p_template_code: "APPOINTMENT_CANCELLED",
      p_variables: {
        nome_paciente: appointment.patient?.nm_patient ?? "",
        nome_medico: appointment.professional?.nm_professional ?? "",
        data: formatDateBR(appointment.dt_appointment),
        hora: formatTimeBR(appointment.dt_appointment),
        motivo,
        clinica: env.VITE_APP_NAME,
        link_agendar: `${env.VITE_APP_URL ?? ""}/appointments/new`,
        telefone_clinica: "",
      },
      p_appointment_id: appointment.id,
    });
  },

  // ---------------------------------------------------------------------------
  // 4. NPS pós-consulta (envia 2h após o término)
  // ---------------------------------------------------------------------------
  async queueNps(appointmentId: number): Promise<string | null> {
    const { data: appointment, error } = await this.fetchAppointment(appointmentId);
    if (error || !appointment) {
      console.error("[notifications] falha ao buscar appointment", appointmentId, error);
      return null;
    }

    const dtEnd = new Date(appointment.dt_appointment);
    dtEnd.setHours(dtEnd.getHours() + 2); // 2h após a consulta
    const channel: NotificationChannel =
      env.VITE_ENABLE_WHATSAPP && appointment.patient?.nr_whatsapp ? "WHATSAPP" : "EMAIL";

    return this.enqueue({
      p_company_id: appointment.company_id,
      p_channel: channel,
      p_recipient_type: "PATIENT",
      p_recipient_id: appointment.patient_id,
      p_recipient_name: appointment.patient?.nm_patient ?? "",
      p_recipient_email: appointment.patient?.ds_email ?? undefined,
      p_recipient_whatsapp: appointment.patient?.nr_whatsapp ?? undefined,
      p_template_code: "NPS_POST_VISIT",
      p_variables: {
        nome_paciente: appointment.patient?.nm_patient ?? "",
        clinica: env.VITE_APP_NAME,
        link_nps: `${env.VITE_APP_URL ?? ""}/nps/${appointment.id}`,
      },
      p_appointment_id: appointment.id,
      p_dt_scheduled_for: dtEnd.toISOString(),
    });
  },

  // ---------------------------------------------------------------------------
  // 5. Consumir fila (usado pelo worker via service_role key)
  // ---------------------------------------------------------------------------
  async getPending(limit = 10): Promise<NotificationRecord[]> {
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("status", "PENDING")
      .or("dt_scheduled_for.is.null,dt_scheduled_for.lte.now()")
      .order("dt_queued", { ascending: true })
      .limit(limit);

    if (error) {
      console.error("[notifications] getPending falhou", error);
      return [];
    }
    return (data ?? []) as NotificationRecord[];
  },

  // ---------------------------------------------------------------------------
  // 6. Marcar como enviado (chamado pelo worker após sucesso)
  // ---------------------------------------------------------------------------
  async markSent(
    id: string,
    providerMessageId: string,
    providerResponse?: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await supabase
      .from("notifications")
      .update({
        status: "SENT",
        provider_message_id: providerMessageId,
        provider_response: providerResponse ?? null,
        dt_sent: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      console.error("[notifications] markSent falhou", id, error);
    }
  },

  // ---------------------------------------------------------------------------
  // 7. Marcar como falha (chamado pelo worker)
  // ---------------------------------------------------------------------------
  async markFailed(
    id: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<NotificationRecord | null> {
    // Buscar tentativas atuais
    const { data: current } = await supabase
      .from("notifications")
      .select("attempts, max_attempts")
      .eq("id", id)
      .single();

    const nextAttempts = (current?.attempts ?? 0) + 1;
    const exhausted = nextAttempts >= (current?.max_attempts ?? 3);

    const { data, error } = await supabase
      .from("notifications")
      .update({
        status: exhausted ? "FAILED" : "PENDING",
        attempts: nextAttempts,
        error_code: errorCode,
        error_message: errorMessage,
        // Reagendar com backoff exponencial: 1min, 5min, 30min
        dt_scheduled_for: exhausted
          ? null
          : new Date(Date.now() + Math.pow(5, nextAttempts) * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[notifications] markFailed falhou", id, error);
      return null;
    }
    return data as NotificationRecord;
  },

  // ---------------------------------------------------------------------------
  // 8. Retry manual (admin) — só se tentativas < max
  // ---------------------------------------------------------------------------
  async retry(id: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("retry_notification", {
      p_notification_id: id,
    });

    if (error) {
      console.error("[notifications] retry falhou", id, error);
      return false;
    }

    return data === true;
  },

  // ---------------------------------------------------------------------------
  // 9. Histórico do destinatário (para tela "minhas notificações")
  // ---------------------------------------------------------------------------
  async getHistory(
    recipientId: number,
    days = 30,
  ): Promise<NotificationRecord[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("recipient_id", recipientId)
      .gte("dt_queued", since)
      .order("dt_queued", { ascending: false })
      .limit(100);

    if (error) {
      console.error("[notifications] getHistory falhou", error);
      return [];
    }
    return (data ?? []) as NotificationRecord[];
  },

  // ---------------------------------------------------------------------------
  // 10. Estatísticas agregadas (dashboard admin)
  // ---------------------------------------------------------------------------
  async getStats(days = 30): Promise<NotificationStats[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("v_notifications_stats")
      .select("*")
      .gte("dia", since)
      .order("dia", { ascending: false });

    if (error) {
      console.error("[notifications] getStats falhou", error);
      return [];
    }

    type Row = {
      channel: NotificationChannel;
      enviadas: number;
      falhas: number;
      canceladas: number;
      pendentes: number;
      entregues: number;
      taxa_sucesso_pct: number;
    };

    // Agregar por canal (somando todos os dias)
    const byChannel = new Map<NotificationChannel, Row>();
    for (const row of data ?? []) {
      const r = row as unknown as Row;
      const acc = byChannel.get(r.channel) ?? {
        channel: r.channel,
        enviadas: 0,
        falhas: 0,
        canceladas: 0,
        pendentes: 0,
        entregues: 0,
        taxa_sucesso_pct: 0,
      };
      acc.enviadas += r.enviadas;
      acc.falhas += r.falhas;
      acc.canceladas += r.canceladas;
      acc.pendentes += r.pendentes;
      acc.entregues += r.entregues;
      byChannel.set(r.channel, acc);
    }

    return Array.from(byChannel.values()).map((r) => ({
      channel: r.channel,
      sent: r.enviadas,
      failed: r.falhas,
      cancelled: r.canceladas,
      pending: r.pendentes,
      delivered: r.entregues,
      total: r.enviadas + r.falhas + r.canceladas + r.pendentes + r.entregues,
      taxa_sucesso_pct:
        r.enviadas + r.falhas === 0
          ? 0
          : Number(((r.enviadas / (r.enviadas + r.falhas)) * 100).toFixed(2)),
    }));
  },

  // ---------------------------------------------------------------------------
  // 11. Preferências (LGPD opt-out)
  // ---------------------------------------------------------------------------
  async setPreference(
    recipient: NotificationRecipient,
    channel: NotificationChannel,
    enabled: boolean,
  ): Promise<boolean> {
    const { data, error } = await supabase.rpc("set_notification_preference", {
      p_recipient_type: recipient.recipientType,
      p_recipient_id: recipient.recipientId,
      p_channel: channel,
      p_enabled: enabled,
      p_reason: enabled ? null : "Opt-out via perfil",
    });

    if (error) {
      console.error("[notifications] setPreference falhou", error);
      return false;
    }

    return data === true;
  },

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  async fetchAppointment(
    appointmentId: number,
  ): Promise<{ data: AppointmentLite | null; error: unknown }> {
    const { data, error } = await supabase
      .from("appointments")
      .select(
        `
        id, company_id, patient_id, professional_id, dt_appointment, status,
        patient:patients(nm_patient, ds_email, nr_phone, nr_whatsapp),
        professional:professionals(nm_professional)
      `,
      )
      .eq("id", appointmentId)
      .single();

    if (error) return { data: null, error };
    return { data: data as unknown as AppointmentLite, error: null };
  },

  async enqueue(params: {
    p_company_id: string;
    p_channel: NotificationChannel;
    p_recipient_type: RecipientType;
    p_recipient_id: number;
    p_recipient_name: string;
    p_recipient_email?: string;
    p_recipient_phone?: string;
    p_recipient_whatsapp?: string;
    p_template_code: string;
    p_variables: Record<string, unknown>;
    p_appointment_id?: number;
    p_dt_scheduled_for?: string;
  }): Promise<string | null> {
    const { data, error } = await supabase.rpc("queue_notification", {
      p_company_id: params.p_company_id,
      p_channel: params.p_channel,
      p_recipient_type: params.p_recipient_type,
      p_recipient_id: params.p_recipient_id,
      p_recipient_name: params.p_recipient_name,
      p_recipient_email: params.p_recipient_email ?? null,
      p_recipient_phone: params.p_recipient_phone ?? null,
      p_recipient_whatsapp: params.p_recipient_whatsapp ?? null,
      p_template_code: params.p_template_code,
      p_variables: params.p_variables,
      p_appointment_id: params.p_appointment_id ?? null,
      p_dt_scheduled_for: params.p_dt_scheduled_for ?? null,
    });

    if (error) {
      console.error("[notifications] enqueue falhou", params.p_template_code, error);
      return null;
    }
    console.info(
      `[notifications] enfileirado: ${params.p_template_code}/${params.p_channel}`,
      data,
    );
    return data as string;
  },
};

export default notificationService;

