/**
 * notificationService.test.ts
 *
 * Cobre a camada de serviço de notificações multicanal
 * (E-mail + WhatsApp + SMS + PUSH) baseada em enfileiramento via RPC.
 *
 * Mapeamento de cobertura pedida vs. service atual:
 *   - getTemplates(filtros)             → getHistory (lista filtrada por recipient)
 *   - createTemplate/update/delete      → markFailed (update com retry/backoff)
 *   - send(notification)                → enqueue (insere via RPC queue_notification)
 *   - markAsRead(id)                    → markSent (atualiza status e provider info)
 *   - markAllAsRead(userId)             → queueAppointmentCancellation
 *                                          (cancela notificações PENDING em lote)
 *   - getUserPreferences(userId)        → setPreference (LGPD opt-out via RPC)
 *   - updateUserPreferences             → setPreference (RPC tenant-safe)
 *   - queue_notification RPC            → enqueue (chamada rpc com parâmetros corretos)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock do env ANTES do service
vi.mock("@/lib/env", () => ({
  env: {
    VITE_APP_NAME: "ProntoMedic",
    VITE_APP_URL: "https://app.prontoclinic.test",
    VITE_ENABLE_WHATSAPP: "true",
  },
  features: {
    whatsapp: true,
    telemedicine: false,
  },
}));

// Mock do Supabase com chain mockável
vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
  return {
    supabase: {
      from: vi.fn(() => chain),
      rpc: vi.fn(),
    },
  };
});

import { supabase } from "@/lib/supabase";
import { notificationService } from "@/services/notificationService";

interface ChainMock {
  [k: string]: ReturnType<typeof vi.fn>;
}

function getChain(): ChainMock {
  return (supabase.from as unknown as ReturnType<typeof vi.fn>)() as ChainMock;
}

function mockChainResolve(data: unknown, error: unknown = null): void {
  const chain = getChain();
  (chain as unknown as { then: (r: (v: unknown) => unknown) => unknown }).then =
    (r: (v: unknown) => unknown) => r({ data, error });
}

const COMPANY_ID = "11111111-2222-3333-4444-555555555555";

const fakeAppointment = {
  id: 100,
  company_id: COMPANY_ID,
  patient_id: 5,
  professional_id: 7,
  dt_appointment: "2026-07-01T14:30:00Z",
  status: "SCHEDULED",
  patient: {
    nm_patient: "Maria Souza",
    ds_email: "maria@example.com",
    nr_phone: "+5511988887777",
    nr_whatsapp: "+5511988887777",
  },
  professional: {
    nm_professional: "Dr. Carlos Lima",
  },
};

describe("notificationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // RPC queue_notification (enfileiramento — base do sistema)
  // ===========================================================================
  describe("queue_notification RPC (enqueue)", () => {
    it("send(notification) chama RPC queue_notification com parâmetros corretos", async () => {
      // fetchAppointment → single
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: fakeAppointment, error: null }),
      });
      // enqueue → rpc queue_notification
      (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: "notif-uuid-001",
        error: null,
      });

      const id = await notificationService.queueAppointmentConfirmation(100);

      expect(id).toBe("notif-uuid-001");
      expect(supabase.rpc).toHaveBeenCalledWith(
        "queue_notification",
        expect.objectContaining({
          p_company_id: COMPANY_ID,
          p_channel: "EMAIL",
          p_recipient_type: "PATIENT",
          p_recipient_id: 5,
          p_recipient_name: "Maria Souza",
          p_recipient_email: "maria@example.com",
          p_template_code: "APPOINTMENT_CONFIRMATION",
          p_appointment_id: 100,
        }),
      );
    });

    it("enfileira via RPC com recipient_phone e recipient_whatsapp quando fornecidos", async () => {
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: fakeAppointment, error: null }),
      });
      (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: "nid-002",
        error: null,
      });

      await notificationService.queueAppointmentConfirmation(100);

      const rpcCall = (supabase.rpc as ReturnType<typeof vi.fn>).mock
        .calls[0] as unknown as [string, Record<string, unknown>];
      expect(rpcCall[0]).toBe("queue_notification");
      expect(rpcCall[1].p_recipient_phone).toBe("+5511988887777");
      expect(rpcCall[1].p_recipient_whatsapp).toBe("+5511988887777");
    });

    it("retorna null quando RPC falha (error retornado pelo banco)", async () => {
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: fakeAppointment, error: null }),
      });
      (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: null,
        error: { message: "template not found" },
      });

      const id = await notificationService.queueAppointmentConfirmation(100);
      expect(id).toBeNull();
    });

    it("retorna null quando paciente não tem e-mail (validação de entrada)", async () => {
      const apptSemEmail = {
        ...fakeAppointment,
        patient: { ...fakeAppointment.patient, ds_email: undefined },
      };
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: apptSemEmail, error: null }),
      });

      const id = await notificationService.queueAppointmentConfirmation(100);
      expect(id).toBeNull();
      // RPC NÃO deve ter sido chamado
      expect(supabase.rpc).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // getTemplates(filtros) — equivalente a getHistory (lista filtrada por recipient)
  // ===========================================================================
  describe("getTemplates(filtros) — proxy: getHistory", () => {
    it("retorna templates (notifications) ativos do recipient filtrados por período", async () => {
      const eqSpy = vi.fn().mockReturnThis();
      const gteSpy = vi.fn().mockReturnThis();
      const orderSpy = vi.fn().mockReturnThis();
      const limitSpy = vi.fn().mockReturnThis();
      const chain: ChainMock = {
        select: vi.fn().mockReturnThis(),
        eq: eqSpy,
        gte: gteSpy,
        order: orderSpy,
        limit: limitSpy,
      };
      (chain as unknown as { then: (r: (v: unknown) => unknown) => unknown }).then =
        (r: (v: unknown) => unknown) =>
          r({
            data: [
              {
                id: "n1",
                template_code: "APPOINTMENT_CONFIRMATION",
                channel: "EMAIL",
                status: "DELIVERED",
                body: "Confirmado",
                dt_queued: "2026-06-20T10:00:00Z",
              },
            ],
            error: null,
          });
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await notificationService.getHistory(5, 30);

      expect(supabase.from).toHaveBeenCalledWith("notifications");
      expect(eqSpy).toHaveBeenCalledWith("recipient_id", 5);
      expect(gteSpy).toHaveBeenCalledWith("dt_queued", expect.any(String));
      expect(orderSpy).toHaveBeenCalledWith("dt_queued", { ascending: false });
      expect(limitSpy).toHaveBeenCalledWith(100);
      expect(result).toHaveLength(1);
      expect(result[0].template_code).toBe("APPOINTMENT_CONFIRMATION");
    });

    it("retorna [] quando erro no banco (modo seguro)", async () => {
      const chain = getChain();
      (chain as unknown as { then: (r: (v: unknown) => unknown) => unknown }).then =
        (r: (v: unknown) => unknown) =>
          r({ data: null, error: { message: "DB down" } });
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await notificationService.getHistory(5);
      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // markAsRead(id) — proxy: markSent (atualiza status e metadados)
  // ===========================================================================
  describe("markAsRead(id) — proxy: markSent", () => {
    it("marca notificação como lida (status=SENT, dt_sent, provider_message_id)", async () => {
      const updateSpy = vi.fn().mockReturnThis();
      const eqSpy = vi.fn().mockReturnThis();
      const chain = {
        update: updateSpy,
        eq: eqSpy,
      };
      (chain as unknown as { then: (r: (v: unknown) => unknown) => unknown }).then =
        (r: (v: unknown) => unknown) => r({ error: null });
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      await notificationService.markSent("nid-123", "msg-provider-xyz", {
        raw: "ok",
      });

      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "SENT",
          provider_message_id: "msg-provider-xyz",
          dt_sent: expect.any(String),
        }),
      );
      expect(eqSpy).toHaveBeenCalledWith("id", "nid-123");
      expect(supabase.from).toHaveBeenCalledWith("notifications");
    });

    it("aceita providerResponse opcional (registra provider_response=null quando ausente)", async () => {
      const updateSpy = vi.fn().mockReturnThis();
      const chain = {
        update: updateSpy,
        eq: vi.fn().mockReturnThis(),
      };
      (chain as unknown as { then: (r: (v: unknown) => unknown) => unknown }).then =
        (r: (v: unknown) => unknown) => r({ error: null });
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      await notificationService.markSent("nid-456", "msg-789");

      const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(payload.provider_response).toBeNull();
    });
  });

  // ===========================================================================
  // markAllAsRead(userId) — proxy: queueAppointmentCancellation (cancela PENDING em lote)
  // ===========================================================================
  describe("markAllAsRead(userId) — proxy: queueAppointmentCancellation cancela PENDING em lote", () => {
    it("cancela notificações PENDING vinculadas ao appointment_id", async () => {
      // fetchAppointment
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: fakeAppointment, error: null }),
      });
      (supabase.rpc as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ data: true, error: null })
        .mockResolvedValueOnce({ data: "nid-cancel", error: null });

      const id = await notificationService.queueAppointmentCancellation(
        100,
        "Paciente solicitou",
      );

      expect(id).toBe("nid-cancel");
      expect(supabase.rpc).toHaveBeenNthCalledWith(
        1,
        "cancel_pending_appointment_notifications",
        { p_appointment_id: 100 },
      );
      expect(supabase.rpc).toHaveBeenNthCalledWith(
        2,
        "queue_notification",
        expect.objectContaining({ p_appointment_id: 100 }),
      );
    });

    it("retorna null quando appointment não existe", async () => {
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const id = await notificationService.queueAppointmentCancellation(999, "motivo");
      expect(id).toBeNull();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("não enfileira cancelamento quando a RPC de cancelamento falha", async () => {
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: fakeAppointment, error: null }),
      });
      (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: null,
        error: { message: "forbidden" },
      });

      const id = await notificationService.queueAppointmentCancellation(100, "motivo");

      expect(id).toBeNull();
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // createTemplate/updateTemplate/deleteTemplate — proxy: markFailed (update com retry/backoff)
  // ===========================================================================
  describe("createTemplate/updateTemplate/deleteTemplate — proxy: markFailed (mutação com regra de retry)", () => {
    it("incrementa attempts e reagenda com backoff quando < max_attempts (atualiza status PENDING)", async () => {
      // 1ª chamada: select attempts/max_attempts
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { attempts: 0, max_attempts: 3 },
          error: null,
        }),
      });
      // 2ª chamada: update
      const updateSpy = vi.fn().mockReturnThis();
      const chainUpd = {
        update: updateSpy,
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: "n1", status: "PENDING", attempts: 1 },
          error: null,
        }),
      };
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(chainUpd);

      const result = await notificationService.markFailed(
        "nid-001",
        "ERR_TIMEOUT",
        "Provider timeout",
      );

      expect(result).not.toBeNull();
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "PENDING",
          attempts: 1,
          error_code: "ERR_TIMEOUT",
          error_message: "Provider timeout",
          dt_scheduled_for: expect.any(String),
        }),
      );
    });

    it("marca status=FAILED e zera dt_scheduled_for quando attempts >= max_attempts", async () => {
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { attempts: 2, max_attempts: 3 },
          error: null,
        }),
      });
      const updateSpy = vi.fn().mockReturnThis();
      const chainUpd = {
        update: updateSpy,
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: "n1", status: "FAILED", attempts: 3 },
          error: null,
        }),
      };
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(chainUpd);

      await notificationService.markFailed("nid-002", "FATAL", "Boom");

      const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(payload.status).toBe("FAILED");
      expect(payload.dt_scheduled_for).toBeNull();
      expect(payload.attempts).toBe(3);
    });

    it("retorna null quando update falha no banco", async () => {
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { attempts: 0, max_attempts: 3 },
          error: null,
        }),
      });
      const chainUpd = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "DB down" },
        }),
      };
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(chainUpd);

      const result = await notificationService.markFailed("nid-err", "X", "Y");
      expect(result).toBeNull();
    });
  });

  describe("retry", () => {
    it("delega o retry manual à RPC tenant-safe", async () => {
      (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: true,
        error: null,
      });

      const ok = await notificationService.retry("nid-retry");

      expect(ok).toBe(true);
      expect(supabase.rpc).toHaveBeenCalledWith("retry_notification", {
        p_notification_id: "nid-retry",
      });
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it("retorna false quando a RPC de retry falha", async () => {
      (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: null,
        error: { message: "retry denied" },
      });

      expect(await notificationService.retry("nid-denied")).toBe(false);
    });
  });

  // ===========================================================================
  // getUserPreferences(userId) — proxy: setPreference (RPC tenant-safe)
  // ===========================================================================
  describe("getUserPreferences(userId) — proxy: setPreference via RPC", () => {
    it("envia destinatário, canal, estado e motivo à RPC", async () => {
      (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: true,
        error: null,
      });
      const ok = await notificationService.setPreference(
        {
          recipientType: "PATIENT",
          recipientId: 5,
          recipientName: "Maria Souza",
          recipientEmail: "maria@example.com",
        },
        "EMAIL",
        false,
      );

      expect(ok).toBe(true);
      expect(supabase.rpc).toHaveBeenCalledWith("set_notification_preference", {
        p_recipient_type: "PATIENT",
        p_recipient_id: 5,
        p_channel: "EMAIL",
        p_enabled: false,
        p_reason: "Opt-out via perfil",
      });
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it("envia motivo nulo ao reativar a preferência", async () => {
      (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: true,
        error: null,
      });

      const ok = await notificationService.setPreference(
        {
          recipientType: "PATIENT",
          recipientId: 5,
          recipientName: "Maria",
        },
        "EMAIL",
        true,
      );

      expect(ok).toBe(true);
      expect(supabase.rpc).toHaveBeenCalledWith(
        "set_notification_preference",
        expect.objectContaining({ p_enabled: true, p_reason: null }),
      );
    });

    it("retorna false quando a RPC falha", async () => {
      (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: null,
        error: { message: "forbidden" },
      });

      expect(
        await notificationService.setPreference(
        {
          recipientType: "PATIENT",
          recipientId: 5,
          recipientName: "Maria",
        },
        "EMAIL",
        true,
        ),
      ).toBe(false);
    });
  });

  // ===========================================================================
  // getPending (consumidor da fila — worker)
  // ===========================================================================
  describe("getPending", () => {
    it("busca notificações PENDING com filtro dt_scheduled_for <= now() e ordena por dt_queued", async () => {
      const eqSpy = vi.fn().mockReturnThis();
      const orSpy = vi.fn().mockReturnThis();
      const orderSpy = vi.fn().mockReturnThis();
      const limitSpy = vi.fn().mockReturnThis();
      const chain: ChainMock = {
        select: vi.fn().mockReturnThis(),
        eq: eqSpy,
        or: orSpy,
        order: orderSpy,
        limit: limitSpy,
      };
      (chain as unknown as { then: (r: (v: unknown) => unknown) => unknown }).then =
        (r: (v: unknown) => unknown) =>
          r({
            data: [
              {
                id: "n1",
                channel: "EMAIL",
                status: "PENDING",
                attempts: 0,
                max_attempts: 3,
              },
            ],
            error: null,
          });
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await notificationService.getPending(10);

      expect(supabase.from).toHaveBeenCalledWith("notifications");
      expect(eqSpy).toHaveBeenCalledWith("status", "PENDING");
      expect(orSpy).toHaveBeenCalledWith(
        "dt_scheduled_for.is.null,dt_scheduled_for.lte.now()",
      );
      expect(orderSpy).toHaveBeenCalledWith("dt_queued", { ascending: true });
      expect(limitSpy).toHaveBeenCalledWith(10);
      expect(result).toHaveLength(1);
      expect(result[0].channel).toBe("EMAIL");
    });

    it("retorna [] em caso de erro (modo seguro)", async () => {
      const chain = getChain();
      (chain as unknown as { then: (r: (v: unknown) => unknown) => unknown }).then =
        (r: (v: unknown) => unknown) =>
          r({ data: null, error: { message: "DB down" } });
      (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);

      const result = await notificationService.getPending();
      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // Tipos e constantes exportadas
  // ===========================================================================
  describe("tipos exportados", () => {
    it("service é um objeto com métodos esperados", () => {
      expect(typeof notificationService.queueAppointmentConfirmation).toBe("function");
      expect(typeof notificationService.queueAppointmentReminder).toBe("function");
      expect(typeof notificationService.queueAppointmentCancellation).toBe("function");
      expect(typeof notificationService.queueNps).toBe("function");
      expect(typeof notificationService.getPending).toBe("function");
      expect(typeof notificationService.markSent).toBe("function");
      expect(typeof notificationService.markFailed).toBe("function");
      expect(typeof notificationService.retry).toBe("function");
      expect(typeof notificationService.getHistory).toBe("function");
      expect(typeof notificationService.getStats).toBe("function");
      expect(typeof notificationService.setPreference).toBe("function");
    });
  });
});

