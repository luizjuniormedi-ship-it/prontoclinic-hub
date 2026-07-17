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
      limit: vi.fn().mockReturnThis(),
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

  it("aplica planId numérico junto com os demais filtros", async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      eq: eqSpy,
      then: (resolve: any) => resolve({ data: [{ id: 1 }], error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await priceTableService.getAll({ serviceId: 5, planId: 7, active: true });

    expect(eqSpy).toHaveBeenCalledWith("service_id", 5);
    expect(eqSpy).toHaveBeenCalledWith("insurance_plan_id", 7);
    expect(eqSpy).toHaveBeenCalledWith("active", true);
    expect(result).toEqual([{ id: 1 }]);
  });
});

describe("priceTableService — operações de persistência", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("conta registros e preserva zero quando a contagem é nula", async () => {
    const chain: any = {
      select: vi.fn()
        .mockResolvedValueOnce({ count: 12, error: null })
        .mockResolvedValueOnce({ count: null, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    await expect(priceTableService.count()).resolves.toBe(12);
    await expect(priceTableService.count()).resolves.toBe(0);
  });

  it("cria uma regra de preço e devolve o registro persistido", async () => {
    const persisted = { id: 10, description: "Consulta" };
    const insertSpy = vi.fn().mockReturnThis();
    const chain: any = {
      insert: insertSpy,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: persisted, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    await expect(priceTableService.create({ description: "Consulta" })).resolves.toEqual(persisted);
    expect(insertSpy).toHaveBeenCalledWith({ description: "Consulta" });
  });

  it("lança erro descritivo quando a criação falha", async () => {
    const chain: any = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "sem permissão" } }),
    };
    (supabase.from as any).mockReturnValue(chain);

    await expect(priceTableService.create({ description: "Consulta" })).rejects.toThrow(
      "Erro ao criar preco: sem permissão",
    );
  });

  it("insere preços em lote e normaliza resposta nula", async () => {
    const selectSpy = vi.fn()
      .mockResolvedValueOnce({ data: [{ id: 1 }, { id: 2 }], error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const chain: any = { insert: vi.fn().mockReturnThis(), select: selectSpy };
    (supabase.from as any).mockReturnValue(chain);

    await expect(priceTableService.bulkCreate([{ description: "A" }, { description: "B" }])).resolves.toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    await expect(priceTableService.bulkCreate([])).resolves.toEqual([]);
  });
});