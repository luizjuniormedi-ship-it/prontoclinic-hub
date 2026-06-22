import { describe, it, expect, vi, beforeEach } from "vitest";
import { priceTableService } from "@/services/priceTableService";

// Mock do Supabase
vi.mock("@/lib/supabase", () => {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  };
  return {
    supabase: {
      from: vi.fn(() => chain),
      rpc: vi.fn(),
    },
  };
});

import { supabase } from "@/lib/supabase";

describe("priceTableService — findPrice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna preço específico do convênio (RPC find_price)", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          vl_particular: 200,
          vl_convenio: 150,
          vl_material: 0,
          vl_medicamento: 0,
          vl_taxa: 0,
          vl_diaria: 0,
          vl_gases: 0,
          found: true,
        },
      ],
      error: null,
    });

    const result = await priceTableService.findPrice(1, 2, 7);
    expect(supabase.rpc).toHaveBeenCalledWith("find_price", {
      p_company_id: null,
      p_service_id: 1,
      p_appointment_type_id: 2,
      p_insurance_plan_id: 7,
    });
    expect(result.found).toBe(true);
    expect(result.vl_convenio).toBe(150);
    expect(result.vl_particular).toBe(200);
  });

  it("cai no fallback particular quando convênio não tem preço", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          vl_particular: 200,
          vl_convenio: 200, // mesmo valor — fallback particular
          vl_material: 0,
          vl_medicamento: 0,
          vl_taxa: 0,
          vl_diaria: 0,
          vl_gases: 0,
          found: true,
        },
      ],
      error: null,
    });

    const result = await priceTableService.findPrice(1, 2, 7);
    expect(result.vl_particular).toBe(result.vl_convenio);
  });

  it("cai no fallback services_catalog quando nenhum preço cadastrado", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          vl_particular: 100,
          vl_convenio: 100,
          vl_material: 0,
          vl_medicamento: 0,
          vl_taxa: 0,
          vl_diaria: 0,
          vl_gases: 0,
          found: true,
        },
      ],
      error: null,
    });

    const result = await priceTableService.findPrice(99, 99, null);
    expect(result.found).toBe(true);
  });

  it("retorna {found: false, zeros} quando nada encontrado e sem erro", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await priceTableService.findPrice(999, 999, 999);
    expect(result.found).toBe(false);
    expect(result.vl_particular).toBe(0);
    expect(result.vl_convenio).toBe(0);
  });

  it("retorna zeros quando RPC find_price falha (warn log)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { message: "RPC indisponível" },
    });

    const result = await priceTableService.findPrice(1, 2, 7);
    expect(result.found).toBe(false);
    expect(result.vl_particular).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("priceTableService — getAll com filtros", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aplica filtro serviceId", async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      eq: eqSpy,
    };
    (chain as any).then = (resolve: any) => resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    await priceTableService.getAll({ serviceId: 5 });
    expect(eqSpy).toHaveBeenCalledWith("service_id", 5);
  });

  it("aplica filtro planId null com .is (particular)", async () => {
    const isSpy = vi.fn().mockReturnThis();
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      is: isSpy,
    };
    (chain as any).then = (resolve: any) => resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    await priceTableService.getAll({ planId: null });
    expect(isSpy).toHaveBeenCalledWith("insurance_plan_id", null);
  });

  it("aplica filtro active=false", async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      eq: eqSpy,
    };
    (chain as any).then = (resolve: any) => resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    await priceTableService.getAll({ active: false });
    expect(eqSpy).toHaveBeenCalledWith("active", false);
  });

  it("lança erro quando Supabase devolve erro", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: null, error: { message: "DB down" } });
    (supabase.from as any).mockReturnValue(chain);

    await expect(priceTableService.getAll()).rejects.toThrow(/DB down/);
  });
});