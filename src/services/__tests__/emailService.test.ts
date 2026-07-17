/**
 * emailService.test.ts
 *
 * Cobre o wrapper de e-mails (Resend API + fallback console).
 * Mock do fetch global para não depender de rede.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock env module antes de importar o service
vi.mock("@/lib/env", () => ({
  env: {
    VITE_RESEND_API_KEY: "re_test_key",
    VITE_EMAIL_FROM: "noreply@test.com",
    VITE_EMAIL_REPLY_TO: "suporte@test.com",
    VITE_APP_NAME: "TestApp",
    VITE_APP_ENV: "development",
  },
}));

import { emailService } from "@/services/emailService";

describe("emailService", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("sendEmail", () => {
    it("envia payload válido para a Resend API", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "msg_abc123" }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await emailService.sendEmail({
        to: "user@example.com",
        subject: "Olá",
        html: "<p>Oi</p>",
      });

      expect(result.id).toBe("msg_abc123");
      expect(result.provider).toBe("resend");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.resend.com/emails");
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer re_test_key");
    });

    it("lança erro com status HTTP quando Resend falha", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => "validation_error",
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      await expect(
        emailService.sendEmail({
          to: "user@example.com",
          subject: "Olá",
          html: "<p>Oi</p>",
        }),
      ).rejects.toThrow(/Resend HTTP 422/);
    });

    it("suporta múltiplos destinatários como array", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "msg_multi" }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      await emailService.sendEmail({
        to: ["a@example.com", "b@example.com"],
        subject: "Test",
        html: "<p>Hi</p>",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.to).toEqual(["a@example.com", "b@example.com"]);
    });

    it("respeita campos opcionais explícitos e normaliza resposta sem id", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await emailService.sendEmail({
        to: "user@example.com",
        subject: "Campos opcionais",
        html: "<p>HTML ignorado no texto</p>",
        text: "Texto explícito",
        from: "custom@example.com",
        replyTo: "reply@example.com",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toMatchObject({
        from: "custom@example.com",
        reply_to: "reply@example.com",
        text: "Texto explícito",
      });
      expect(result).toEqual({ id: "unknown", provider: "resend" });
    });

    it("converte AbortError em mensagem de timeout", async () => {
      const abortError = new Error("aborted");
      abortError.name = "AbortError";
      global.fetch = vi.fn().mockRejectedValue(abortError) as unknown as typeof fetch;

      await expect(
        emailService.sendEmail({
          to: "user@example.com",
          subject: "Timeout",
          html: "<p>Oi</p>",
        }),
      ).rejects.toThrow("Timeout ao enviar e-mail (10s)");
    });
  });

  describe("sendPreCadastroConfirmation", () => {
    it("inclui link de confirmação no HTML e subject correto", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "msg_pre" }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const link = "https://app.test/confirmar?token=xyz";
      await emailService.sendPreCadastroConfirmation({
        to: "novo@example.com",
        nome: "Maria Silva",
        linkConfirmacao: link,
        dtExp: "2026-12-31T23:59:59Z",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.to).toEqual(["novo@example.com"]);
      expect(body.subject).toMatch(/Confirme seu pré-cadastro/);
      expect(body.html).toContain(link);
      expect(body.html).toContain("Maria Silva");
      expect(body.tags).toContainEqual({ name: "category", value: "pre_cadastro" });
    });
  });

  describe("sendWelcome", () => {
    it("envia boas-vindas com nome do paciente", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "msg_welcome" }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      await emailService.sendWelcome("user@example.com", "João");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.subject).toMatch(/Bem-vindo/);
      expect(body.html).toContain("João");
    });
  });

  describe("sendPasswordReset", () => {
    it("envia link de reset válido", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "msg_reset" }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const link = "https://app.test/reset?token=abc";
      await emailService.sendPasswordReset("user@example.com", link);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.subject).toMatch(/Redefinição de senha/);
      expect(body.html).toContain(link);
      expect(body.tags).toContainEqual({ name: "category", value: "auth" });
    });
  });

  describe("fallback dev mode", () => {
    it("falha de forma segura em produção quando não há API key", async () => {
      vi.resetModules();
      vi.doMock("@/lib/env", () => ({
        env: {
          VITE_RESEND_API_KEY: undefined,
          VITE_APP_ENV: "production",
        },
      }));
      const { emailService: svc } = await import("@/services/emailService");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      await expect(
        svc.sendEmail({
          to: "user@example.com",
          subject: "Produção",
          html: "<p>Não enviar</p>",
        }),
      ).rejects.toThrow("Servico de e-mail nao configurado");
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("VITE_RESEND_API_KEY ausente"),
        expect.objectContaining({ to: "user@example.com" }),
      );
      errorSpy.mockRestore();
    });

    it("retorna provider console quando não há API key", async () => {
      vi.resetModules();
      vi.doMock("@/lib/env", () => ({
        env: {
          VITE_RESEND_API_KEY: undefined,
          VITE_APP_ENV: "development",
          VITE_EMAIL_FROM: "noreply@test.com",
          VITE_EMAIL_REPLY_TO: "suporte@test.com",
          VITE_APP_NAME: "TestApp",
        },
      }));
      const { emailService: svc } = await import("@/services/emailService");

      const mockFetch = vi.fn();
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await svc.sendEmail({
        to: "user@example.com",
        subject: "Test",
        html: "<p>Hi</p>",
      });

      expect(result.provider).toBe("console");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("usa remetente, reply-to e user-agent padrão quando não configurados", async () => {
      vi.resetModules();
      vi.doMock("@/lib/env", () => ({
        env: {
          VITE_RESEND_API_KEY: "re_defaults",
          VITE_APP_ENV: "development",
        },
      }));
      const { emailService: svc } = await import("@/services/emailService");
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "msg_defaults" }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      await svc.sendEmail({
        to: "user@example.com",
        subject: "Padrões",
        html: "<p>Oi</p>",
      });

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.from).toBe(
        "ProntoClinic Hub <nao-responda@prontoclinic.com.br>",
      );
      expect(body.reply_to).toBe("suporte@prontoclinic.com.br");
      expect(init.headers["User-Agent"]).toBe("ProntoMedic/1.0");
    });
  });
});
