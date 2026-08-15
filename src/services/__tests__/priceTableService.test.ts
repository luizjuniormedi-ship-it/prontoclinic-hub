import { describe, it, expect, vi, beforeEach } from "vitest";
import { priceTableService } from "@/services/priceTableService";

// Mock do Supabase
vi.mock("@/lib/supabase", () => {
  const chain = {
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

type QueryResult = { data: unknown; error: unknown };
type QueryResolver = (value: QueryResult) => unknown;
const rpcMock = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

describe("priceTableService — findPrice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normaliza o registro composto retornado pelo PostgREST", async () => {
    rpcMock.mockResolvedValue({
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
    rpcMock.mockResolvedValue({
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
    rpcMock.mockResolvedValue({
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
    rpcMock.mockResolvedValue({
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
    rpcMock.mockResolvedValue({
      data: [
        {
          vl_particular: "200.10",
          vl_convenio: "150,25",
          vl_material: null,
          vl_medicamento: "0",
          vl_taxa: "0",
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
    rpcMock.mockResolvedValue({
      data: [{
        vl_particular: 0,
        vl_convenio: 0,
        vl_material: 0,
        vl_medicamento: 0,
        vl_taxa: 0,
        vl_diaria: 0,
        vl_gases: 0,
        found: false,
      }],
      error: null,
    });

    const result = await priceTableService.findPrice(999, 999, 999);
    expect(result.found).toBe(false);
    expect(result.vl_particular).toBe(0);
    expect(result.vl_convenio).toBe(0);
  });

  it("falha fechado quando a resposta da RPC não respeita o contrato", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    await expect(priceTableService.findPrice(999, 999, 999)).rejects.toThrow(
      "Resposta inválida de find_price",
    );
  });

  it("falha fechado quando a RPC find_price retorna erro", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "RPC indisponível" },
    });

    await expect(priceTableService.findPrice(1, 2, 7)).rejects.toThrow(
      "Erro ao consultar preço: RPC indisponível",
    );
  });
});

describe("priceTableService — getAll com filtros", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aplica filtro serviceId", async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const chain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      eq: eqSpy,
      then: (resolve: QueryResolver) => resolve({ data: [], error: null }),
    };
    vi.mocked(supabase.from).mockReturnValue(chain as never);

    await priceTableService.getAll({ serviceId: 5 });
    expect(eqSpy).toHaveBeenCalledWith("service_id", 5);
  });

  it("normaliza todas as colunas monetárias antes de entregar dados à UI", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: (resolve: QueryResolver) => resolve({
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
      }),
    };
    vi.mocked(supabase.from).mockReturnValue(chain as never);

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
    const chain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: (resolve: QueryResolver) => resolve({
        data: [{ id: 10, vl_particular: "inválido" }],
        error: null,
      }),
    };
    vi.mocked(supabase.from).mockReturnValue(chain as never);

    await expect(priceTableService.getAll()).rejects.toThrow(
      "Contrato inválido em price_tables.vl_particular",
    );
  });

  it("aplica filtro planId null com .is (particular)", async () => {
    const isSpy = vi.fn().mockReturnThis();
    const chain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      is: isSpy,
      then: (resolve: QueryResolver) => resolve({ data: [], error: null }),
    };
    vi.mocked(supabase.from).mockReturnValue(chain as never);

    await priceTableService.getAll({ planId: null });
    expect(isSpy).toHaveBeenCalledWith("insurance_plan_id", null);
  });

  it("aplica filtro active=false", async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const chain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      eq: eqSpy,
      then: (resolve: QueryResolver) => resolve({ data: [], error: null }),
    };
    vi.mocked(supabase.from).mockReturnValue(chain as never);

    await priceTableService.getAll({ active: false });
    expect(eqSpy).toHaveBeenCalledWith("active", false);
  });

  it("lança erro quando Supabase devolve erro", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: (resolve: QueryResolver) =>
        resolve({ data: null, error: { message: "DB down" } }),
    };
    vi.mocked(supabase.from).mockReturnValue(chain as never);

    await expect(priceTableService.getAll()).rejects.toThrow(/DB down/);
  });
});
