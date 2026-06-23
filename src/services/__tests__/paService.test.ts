import { describe, it, expect, vi, beforeEach } from "vitest";
import { paService, TEMPO_MAX_ESPERA_MIN, tempoLimiteExcedido } from "@/services/paService";

vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "is", "order", "single", "maybeSingle", "limit"];
  for (const m of methods) chain[m] = vi.fn().mockReturnThis();
  return {
    supabase: {
      from: vi.fn(() => chain),
      rpc: vi.fn(),
    },
  };
});

import { supabase } from "@/lib/supabase";

describe("paService — tempoLimiteExcedido", () => {
  it("VERMELHO tem tempo máximo 0 min (emergência)", () => {
    expect(TEMPO_MAX_ESPERA_MIN.VERMELHO).toBe(0);
  });

  it("AZUL tem tempo máximo 240 min", () => {
    expect(TEMPO_MAX_ESPERA_MIN.AZUL).toBe(240);
  });

  it("tempoLimiteExcedido retorna true se minutos > limite", () => {
    expect(tempoLimiteExcedido("AMARELO", 90)).toBe(true);
    expect(tempoLimiteExcedido("AMARELO", 30)).toBe(false);
  });

  it("tempoLimiteExcedido retorna false para cor null", () => {
    expect(tempoLimiteExcedido(null, 1000)).toBe(false);
  });
});

describe("paService — getFila e operações", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getFila consulta view v_pa_fila ordenada por prioridade", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) => resolve({ data: [{ id: 1, nr_prioridade: 1 }], error: null });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const result = await paService.getFila();
    expect(result[0].nr_prioridade).toBe(1);
  });

  it("create valida cd_paciente obrigatório", async () => {
    await expect(
      paService.create({ cd_paciente: 0 } as never)
    ).rejects.toThrow();
  });

  it("darAlta valida tp_destino obrigatório", async () => {
    await expect(
      paService.darAlta(1, { tp_destino: "INVALID" as never })
    ).rejects.toThrow();
  });
});

describe("paService — getEstatisticas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("conta atendimentos por status corretamente", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({
        data: [
          { tp_status: "AGUARDANDO" },
          { tp_status: "AGUARDANDO" },
          { tp_status: "EM_ATENDIMENTO" },
        ],
        error: null,
      });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const result = await paService.getEstatisticas();
    expect(result.aguardando).toBe(2);
    expect(result.emAtendimento).toBe(1);
    expect(result.alta).toBe(0);
  });
});
