/**
 * telemedicinaService.test.ts
 *
 * Testes unitários do módulo de Telemedicina.
 *
 * Cobre:
 *   - criarSala usa o backend seguro e falha fechado
 *   - entrarSala recebe token emitido pelo backend
 *   - finalizar chama RPC com métricas
 *   - enviarMensagem insere no banco
 *   - getRelatorio agrega corretamente
 *   - isConfigured reflete o feature flag, sem segredo no navegador
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock do Supabase — chain genérico e rpc
vi.mock("@/lib/supabase", () => {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn(),
  };
  return {
    supabase: {
      from: vi.fn(() => chain),
      rpc: vi.fn(),
      functions: {
        invoke: vi.fn(),
      },
    },
  };
});

// Mock da env — apenas o feature flag fica disponível no navegador
vi.mock("@/lib/env", () => ({
  env: {
    VITE_SUPABASE_URL: "https://test.supabase.co",
    VITE_SUPABASE_ANON_KEY: "sb_test_key_1234567890",
    VITE_APP_NAME: "Test",
    VITE_ENABLE_TELEMEDICINE: true,
  },
}));

import { supabase } from "@/lib/supabase";
import { telemedicinaService, type TelemedSala } from "@/services/telemedicinaService";

const salaFake: TelemedSala = {
  id: "sala-uuid-1",
  company_id: "company-uuid-1",
  cd_appointment: 1,
  cd_paciente: 10,
  cd_medico: 20,
  ds_token_acesso: "tok-abc",
  dt_criacao: "2026-06-22T10:00:00Z",
  dt_inicio: null,
  dt_fim: null,
  ds_url_daily: null,
  ds_sala_daily: "pm-1",
  duracao_segundos: null,
  tp_status: "AGUARDANDO",
  lg_gravacao_habilitada: false,
  ds_url_gravacao: null,
  lg_consentimento_gravacao: false,
  dt_consentimento: null,
  vl_bitrate_medio: null,
  vl_latencia_media: null,
  vl_packet_loss: null,
  created_at: "2026-06-22T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("telemedicinaService.criarSala", () => {
  it("retorna somente sala provisionada pelo backend seguro", async () => {
    const provisioned = {
      ...salaFake,
      ds_url_daily: "https://test.daily.co/pm-1",
    };
    (supabase.functions.invoke as any).mockResolvedValueOnce({
      data: { sala: provisioned },
      error: null,
    });

    const result = await telemedicinaService.criarSala(1);
    expect(result).toEqual(provisioned);
    expect(supabase.functions.invoke).toHaveBeenCalledWith("telemedicina-daily", {
      body: { action: "create-room", appointmentId: 1 },
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("falha fechado quando o backend não provisiona a sala remota", async () => {
    (supabase.functions.invoke as any).mockResolvedValueOnce({
      data: null,
      error: { message: "FunctionsHttpError" },
    });
    await expect(telemedicinaService.criarSala(999)).rejects.toThrow(
      "Telemedicina indisponível",
    );
  });

  it("rejeita resposta parcial sem URL remota", async () => {
    (supabase.functions.invoke as any).mockResolvedValueOnce({
      data: { sala: salaFake },
      error: null,
    });
    await expect(telemedicinaService.criarSala(1)).rejects.toThrow(
      "sala remota não foi provisionada",
    );
  });
});

describe("telemedicinaService.entrarSala", () => {
  it("valida token e retorna meeting token", async () => {
    const sala = {
      ...salaFake,
      ds_url_daily: "https://test.daily.co/pm-1",
      tp_status: "EM_ANDAMENTO" as const,
    };
    (supabase.functions.invoke as any).mockResolvedValueOnce({
      data: {
        sala,
        meetingToken: "meeting-jwt-token",
        meetingUrl: sala.ds_url_daily,
      },
      error: null,
    });

    const result = await telemedicinaService.entrarSala("tok-abc", {
      userId: "user-1",
      nome: "Dr. Teste",
      role: "MEDICO",
    });

    expect(result.meetingToken).toBe("meeting-jwt-token");
    expect(result.sala.tp_status).toBe("EM_ANDAMENTO");
    expect(supabase.functions.invoke).toHaveBeenCalledWith("telemedicina-daily", {
      body: {
        action: "join-room",
        accessToken: "tok-abc",
        participant: { nome: "Dr. Teste", role: "MEDICO" },
        userAgent: expect.any(String),
      },
    });
  });

  it("rejeita token inválido", async () => {
    (supabase.functions.invoke as any).mockResolvedValueOnce({
      data: null,
      error: { message: "Token inválido" },
    });
    await expect(
      telemedicinaService.entrarSala("invalid", { userId: "u", nome: "x", role: "MEDICO" }),
    ).rejects.toThrow("Telemedicina indisponível");
  });
});

describe("telemedicinaService.finalizar", () => {
  it("chama RPC com métricas de duração e qualidade", async () => {
    (supabase.rpc as any).mockResolvedValueOnce({ data: null, error: null });
    await telemedicinaService.finalizar("sala-uuid-1", "user-1", {
      duracaoSegundos: 1800,
      qualidade: { bitrateMedio: 800, latenciaMedia: 80, packetLoss: 0.5 },
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "finalizar_sala_telemedicina",
      expect.objectContaining({
        p_sala_id: "sala-uuid-1",
        p_duracao_segundos: 1800,
        p_bitrate_medio: 800,
        p_latencia_media: 80,
        p_packet_loss: 0.5,
      }),
    );
  });
});

describe("telemedicinaService.enviarMensagem", () => {
  it("insere mensagem no banco e retorna registro criado", async () => {
    const msg = {
      id: 1,
      cd_sala: "sala-uuid-1",
      cd_usuario: "user-1",
      nm_remetente: "Dr. Teste",
      ds_mensagem: "Olá",
      tp_mensagem: "TEXTO",
      dt_envio: "2026-06-22T10:05:00Z",
    };
    const chain: any = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: msg, error: null }),
    };
    (supabase.from as any).mockReturnValueOnce(chain);

    const result = await telemedicinaService.enviarMensagem("sala-uuid-1", "Olá", "user-1", "Dr. Teste");
    expect(result.ds_mensagem).toBe("Olá");
    expect(result.tp_mensagem).toBe("TEXTO");
  });
});

describe("telemedicinaService.getRelatorioTelemedicina", () => {
  it("agrega corretamente total, duração média, latência e packet loss", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      then: (resolve: any) =>
        resolve({
          data: [
            { tp_status: "FINALIZADA", duracao_segundos: 1200, vl_latencia_media: 80, vl_packet_loss: 0.5 },
            { tp_status: "FINALIZADA", duracao_segundos: 1800, vl_latencia_media: 100, vl_packet_loss: 1.5 },
            { tp_status: "CANCELADA", duracao_segundos: null, vl_latencia_media: null, vl_packet_loss: null },
          ],
          error: null,
        }),
    };
    (supabase.from as any).mockReturnValueOnce(chain);

    const rel = await telemedicinaService.getRelatorioTelemedicina("company-uuid-1", {
      inicio: "2026-06-01",
      fim: "2026-06-30",
    });

    expect(rel.totalConsultas).toBe(3);
    expect(rel.duracaoMedia).toBe(1500); // (1200+1800)/2
    expect(rel.qualidadeMedia.latencia).toBe(90); // (80+100)/2
    expect(rel.qualidadeMedia.packetLoss).toBe(1.0); // (0.5+1.5)/2
    expect(rel.taxaConclusao).toBeCloseTo(0.667, 2);
  });

  it("retorna zeros quando não há dados", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    (supabase.from as any).mockReturnValueOnce(chain);

    const rel = await telemedicinaService.getRelatorioTelemedicina("company-x", {
      inicio: "2026-06-01",
      fim: "2026-06-30",
    });

    expect(rel.totalConsultas).toBe(0);
    expect(rel.duracaoMedia).toBe(0);
    expect(rel.taxaConclusao).toBe(0);
  });
});

describe("telemedicinaService.isConfigured", () => {
  it("retorna true pelo feature flag sem depender de segredo Daily no cliente", () => {
    expect(telemedicinaService.isConfigured()).toBe(true);
  });
});
