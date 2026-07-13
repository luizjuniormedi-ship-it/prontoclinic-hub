/**
 * telemedicinaService.test.ts
 *
 * Testes unitários do módulo de Telemedicina.
 *
 * Cobre:
 *   - criarSala retorna UUID e cria sala no Daily (best-effort)
 *   - entrarSala valida token e gera meeting token
 *   - finalizar chama RPC com métricas
 *   - enviarMensagem insere no banco
 *   - getRelatorio agrega corretamente
 *   - isConfigured reflete estado das env vars
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
    },
  };
});

// Mock da env — habilita Daily.co para os testes
vi.mock("@/lib/env", () => ({
  env: {
    VITE_SUPABASE_URL: "https://test.supabase.co",
    VITE_SUPABASE_ANON_KEY: "sb_test_key_1234567890",
    VITE_APP_NAME: "Test",
    VITE_DAILY_API_KEY: "test-daily-key",
    VITE_DAILY_DOMAIN: "test.daily.co",
    VITE_DAILY_WEBHOOK_SECRET: "whsec_test",
  },
}));

// Mock do fetch (chamadas Daily.co REST API)
const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

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
  it("retorna UUID da sala criada via RPC", async () => {
    // RPC retorna o UUID
    (supabase.rpc as any).mockResolvedValueOnce({ data: "sala-uuid-1", error: null });

    // select após insert retorna a sala
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: salaFake, error: null }),
      update: vi.fn().mockReturnThis(),
    };
    (supabase.from as any).mockReturnValueOnce(chain);

    // Mock fetch para Daily.co (criar room)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: async () => "",
      json: async () => ({ id: "daily-room-1", name: "pm-1", url: "https://test.daily.co/pm-1" }),
    });

    const result = await telemedicinaService.criarSala(1);
    expect(result).toBeDefined();
    expect(supabase.rpc).toHaveBeenCalledWith("criar_sala_telemedicina", { p_appointment_id: 1 });
  });

  it("lança erro se RPC falhar", async () => {
    (supabase.rpc as any).mockResolvedValueOnce({ data: null, error: { message: "Appointment not found" } });
    await expect(telemedicinaService.criarSala(999)).rejects.toThrow("Appointment not found");
  });
});

describe("telemedicinaService.entrarSala", () => {
  it("valida token e retorna meeting token", async () => {
    const sala = { ...salaFake, ds_url_daily: "https://test.daily.co/pm-1" };
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: sala, error: null }),
      update: vi.fn().mockReturnThis(),
    };
    (supabase.from as any).mockReturnValueOnce(chain); // select
    (supabase.from as any).mockReturnValueOnce(chain); // update
    (supabase.from as any).mockReturnValueOnce(chain); // insert participante

    // Daily.co meeting token
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ token: "meeting-jwt-token" }),
    });

    const result = await telemedicinaService.entrarSala("tok-abc", {
      userId: "user-1",
      nome: "Dr. Teste",
      role: "MEDICO",
    });

    expect(result.meetingToken).toBe("meeting-jwt-token");
    expect(result.sala.tp_status).toBe("EM_ANDAMENTO");
  });

  it("rejeita token inválido", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    };
    (supabase.from as any).mockReturnValueOnce(chain);
    await expect(
      telemedicinaService.entrarSala("invalid", { userId: "u", nome: "x", role: "MEDICO" }),
    ).rejects.toThrow("Token inválido");
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

describe("telemedicinaService.assinarPrescricao", () => {
  it("falha fechado sem marcar ou criar receita sem PDF/Storage real", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 7, cd_paciente: 10, cd_medico: 20 },
        error: null,
      }),
    };
    (supabase.from as any).mockReturnValue(chain);

    await expect(
      telemedicinaService.assinarPrescricao(7, "hash", "certificado"),
    ).rejects.toThrow("armazenamento real do PDF ainda não está configurado");

    expect(chain.update).not.toHaveBeenCalled();
    expect(chain.insert).not.toHaveBeenCalled();
  });
});

describe("telemedicinaService.habilitarGravacao", () => {
  it("falha fechado sem registrar consentimento como gravação ativa", async () => {
    await expect(
      telemedicinaService.habilitarGravacao("sala-uuid-1", true),
    ).rejects.toThrow("integração real de gravação ainda não está configurada");

    expect(supabase.rpc).not.toHaveBeenCalled();
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
  it("retorna true quando VITE_DAILY_API_KEY e VITE_DAILY_DOMAIN estão definidos", () => {
    expect(telemedicinaService.isConfigured()).toBe(true);
  });
});
