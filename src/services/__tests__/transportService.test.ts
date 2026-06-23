import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  veiculosService,
  equipeService,
  remocoesService,
  transportReportsService,
  veiculoSchema,
  remocaoSchema,
} from "@/services/transportService";

vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
  (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
    r({ data: [], error: null });
  return {
    supabase: {
      from: vi.fn(() => chain),
      rpc: vi.fn(),
    },
  };
});

import { supabase } from "@/lib/supabase";

describe("transportService — veiculoSchema (Zod)", () => {
  it("aceita placa Mercosul válida", () => {
    const r = veiculoSchema.safeParse({ nr_placa: "ABC1D23", ds_modelo: "Sprinter" });
    expect(r.success).toBe(true);
  });

  it("aceita placa antiga (AAA-9999)", () => {
    const r = veiculoSchema.safeParse({ nr_placa: "ABC1234" });
    expect(r.success).toBe(true);
  });

  it("rejeita placa com tamanho errado", () => {
    const r = veiculoSchema.safeParse({ nr_placa: "AB" });
    expect(r.success).toBe(false);
  });
});

describe("transportService — remocaoSchema (Zod)", () => {
  it("rejeita sem origem/destino", () => {
    const r = remocaoSchema.safeParse({
      tp_tipo: "REMOCAO_SIMPLES",
      tp_urgencia: "MEDIA",
    });
    expect(r.success).toBe(false);
  });

  it("aceita remoção simples completa", () => {
    const r = remocaoSchema.safeParse({
      tp_tipo: "REMOCAO_SIMPLES",
      tp_urgencia: "MEDIA",
      ds_origem: "Hospital X",
      ds_destino: "Hospital Y",
    });
    expect(r.success).toBe(true);
  });
});

describe("veiculosService — getAll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filtra por lg_ativo=true por padrão", async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const orderSpy = vi.fn().mockReturnThis();
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: eqSpy,
      order: orderSpy,
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: [{ id: 1, nr_placa: "ABC1D23" }], error: null });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const result = await veiculosService.getAll();
    expect(eqSpy).toHaveBeenCalledWith("lg_ativo", true);
    expect(result).toHaveLength(1);
  });
});

describe("equipeService — getCNHVencendo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filtra por função MOTORISTA e validade CNH", async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const lteSpy = vi.fn().mockReturnThis();
    const gteSpy = vi.fn().mockReturnThis();
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: eqSpy,
      lte: lteSpy,
      gte: gteSpy,
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: [], error: null });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    await equipeService.getCNHVencendo(30);
    expect(eqSpy).toHaveBeenCalledWith("tp_funcao", "MOTORISTA");
    expect(lteSpy).toHaveBeenCalled();
    expect(gteSpy).toHaveBeenCalled();
  });
});

describe("remocoesService — iniciar/finalizar/cancelar", () => {
  beforeEach(() => vi.clearAllMocks());

  it("iniciar registra km_inicial e muda status para EM_ANDAMENTO", async () => {
    const chain: Record<string, unknown> = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 1, tp_status: "EM_ANDAMENTO", vl_km_inicial: 100 }, error: null }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const result = await remocoesService.iniciar(1, 100);
    expect(result.tp_status).toBe("EM_ANDAMENTO");
    expect(result.vl_km_inicial).toBe(100);
  });

  it("iniciar rejeita km negativa", async () => {
    await expect(remocoesService.iniciar(1, -5)).rejects.toThrow(/positiva/);
  });

  it("cancelar exige motivo", async () => {
    await expect(remocoesService.cancelar(1, "")).rejects.toThrow(/obrigatório/);
  });
});

describe("transportReportsService — getKmTotal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calcula km = vl_km_final - vl_km_inicial para concluídas", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({
        data: [
          { vl_km_inicial: 100, vl_km_final: 150 },
          { vl_km_inicial: 0, vl_km_final: 30 },
        ],
        error: null,
      });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const km = await transportReportsService.getKmTotal("2026-01-01", "2026-12-31");
    expect(km).toBe(80);
  });
});