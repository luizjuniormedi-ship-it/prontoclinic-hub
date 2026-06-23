import { describe, it, expect, vi, beforeEach } from "vitest";
import { internacaoService } from "@/services/internacaoService";

vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "is", "order", "single", "maybeSingle", "limit", "in"];
  for (const m of methods) chain[m] = vi.fn().mockReturnThis();
  return {
    supabase: {
      from: vi.fn(() => chain),
      rpc: vi.fn(),
    },
    __chain: chain,
  };
});

import { supabase } from "@/lib/supabase";

describe("internacaoService — leitos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getMapaOcupacao consulta view v_leitos_ocupacao", async () => {
    const chain = (supabase.from as unknown as ReturnType<typeof vi.fn>)("v_leitos_ocupacao") as Record<string, unknown>;
    chain.select = vi.fn().mockReturnValue({ order: vi.fn().mockResolvedValue({ data: [{ id: 1, nr_leito: "A1", tp_status: "LIVRE" }], error: null }) });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const result = await internacaoService.leitos.getMapaOcupacao();
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].tp_status).toBe("LIVRE");
  });

  it("getById retorna leito quando encontrado", async () => {
    const chain = (supabase.from as unknown as ReturnType<typeof vi.fn>)("leitos") as Record<string, unknown>;
    chain.select = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 1, nr_leito: "A1" }, error: null }) }) });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const result = await internacaoService.leitos.getById(1);
    expect(result?.nr_leito).toBe("A1");
  });

  it("create valida que nr_leito é obrigatório", async () => {
    await expect(
      internacaoService.leitos.create({ nr_leito: "", tp_leito: "ENFERMARIA" } as never)
    ).rejects.toThrow();
  });
});

describe("internacaoService — internações", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("create valida cd_paciente e cd_leito", async () => {
    await expect(
      internacaoService.internacoes.create({ cd_paciente: 0, cd_leito: 1 } as never)
    ).rejects.toThrow();
  });

  it("darAlta valida tp_alta obrigatório", async () => {
    await expect(
      internacaoService.internacoes.darAlta(1, { tp_alta: "INVALID" as never })
    ).rejects.toThrow();
  });

  it("getAtiva retorna internação ativa de um leito", async () => {
    const chain = (supabase.from as unknown as ReturnType<typeof vi.fn>)("pacixleit") as Record<string, unknown>;
    chain.select = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 1, dt_alta: null }, error: null }),
        }),
      }),
    });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const result = await internacaoService.internacoes.getAtiva(1);
    expect(result?.dt_alta).toBeNull();
  });
});

describe("internacaoService — prescrições e evoluções", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("create prescrição valida ds_prescricao obrigatório", async () => {
    await expect(
      internacaoService.prescricoes.create({ cd_internacao: 1, cd_medico: 1, ds_prescricao: "" } as never)
    ).rejects.toThrow();
  });

  it("create evolução aceita SOAP parcial", async () => {
    const chain = (supabase.from as unknown as ReturnType<typeof vi.fn>)("evolucoes_internado") as Record<string, unknown>;
    chain.insert = vi.fn((row: unknown) => ({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 1, ...(row as object) },
          error: null,
        }),
      }),
    }));
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const result = await internacaoService.evolucoes.create({
      cd_internacao: 1,
      cd_medico: 1,
      ds_subjetivo: "Paciente relata dor",
    });
    expect(result.ds_subjetivo).toBe("Paciente relata dor");
  });

  it("sinaisVitaisSchema valida SpO2 entre 0-100", async () => {
    const { sinasVitaisSchema } = await import("@/services/internacaoService");
    const ok = sinasVitaisSchema.parse({ spo2: 95 });
    expect(ok.spo2).toBe(95);
    expect(() => sinasVitaisSchema.parse({ spo2: 150 })).toThrow();
  });
});
