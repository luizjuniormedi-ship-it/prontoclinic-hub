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
    limit: vi.fn().mockReturnThis(),
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

  it("normaliza o registro composto retornado pelo PostgREST", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: "(150.00,0.00,12.50,3.25,1.00,0.00,0.00,t)",
      error: null,
    });

    await expect(
      priceTableService.findPrice(
        91001,
        91001,
        null,
        "eeeeeeee-1000-4000-8000-000000000001",
      ),
    ).resolves.toEqual({
      vl_particular: 150,
      vl_convenio: 0,
      vl_material: 12.5,
      vl_medicamento: 3.25,
      vl_taxa: 1,
      vl_diaria: 0,
      vl_gases: 0,
      found: true,
    });
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

  it("normaliza valores monetários retornados pelo Postgres como texto", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [
        {
          vl_particular: "200.10",
          vl_convenio: "150,25",
          vl_material: null,
          vl_medicamento: "inválido",
          vl_taxa: "-5",
          vl_diaria: "10",
          vl_gases: 2.345,
          found: "true",
        },
      ],
      error: null,
    });

    const result = await priceTableService.findPrice(1, 2, 7);

    expect(result).toEqual({
      vl_particular: 200.1,
      vl_convenio: 150.25,
      vl_material: 0,
      vl_medicamento: 0,
      vl_taxa: 0,
      vl_diaria: 10,
      vl_gases: 2.35,
      found: true,
    });
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
      limit: vi.fn().mockReturnThis(),
      eq: eqSpy,
    };
    (chain as any).then = (resolve: any) => resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    await priceTableService.getAll({ serviceId: 5 });
    expect(eqSpy).toHaveBeenCalledWith("service_id", 5);
  });

  it("normaliza todas as colunas monetárias antes de entregar dados à UI", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({
        data: [
          {
            id: 10,
            vl_particular: "120.50",
            vl_convenio: "99,90",
            vl_material: null,
            vl_medicamento: "0",
            vl_taxa: "1.25",
            vl_diaria: "10",
            vl_gases: 2.345,
            percentual_acrescimo: "7.555",
          },
        ],
        error: null,
      });
    (supabase.from as any).mockReturnValue(chain);

    const [result] = await priceTableService.getAll();

    expect(result).toMatchObject({
      id: 10,
      vl_particular: 120.5,
      vl_convenio: 99.9,
      vl_material: 0,
      vl_medicamento: 0,
      vl_taxa: 1.25,
      vl_diaria: 10,
      vl_gases: 2.35,
      percentual_acrescimo: 7.56,
    });
    expect(() => result.vl_particular.toFixed(2)).not.toThrow();
  });

  it("falha fechado quando preço persistido é inválido", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({
        data: [{ id: 10, vl_particular: "inválido" }],
        error: null,
      });
    (supabase.from as any).mockReturnValue(chain);

    await expect(priceTableService.getAll()).rejects.toThrow(
      "Contrato inválido em price_tables.vl_particular",
    );
  });

  it("aplica filtro planId null com .is (particular)", async () => {
    const isSpy = vi.fn().mockReturnThis();
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
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
      limit: vi.fn().mockReturnThis(),
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
      limit: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: null, error: { message: "DB down" } });
    (supabase.from as any).mockReturnValue(chain);

    await expect(priceTableService.getAll()).rejects.toThrow(/DB down/);
  });
});
