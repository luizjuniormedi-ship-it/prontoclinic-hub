import { describe, it, expect, vi, beforeEach } from "vitest";
import { insuranceQuotasService } from "@/services/insuranceQuotasService";

// Mock do Supabase com chain mockável completo
vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
  return {
    supabase: {
      from: vi.fn(() => chain),
      rpc: vi.fn(),
    },
  };
});

import { supabase } from "@/lib/supabase";

// ── Fixtures ──

const makeQuota = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  company_id: "company-1",
  insurance_company_id: 10,
  service_id: 100,
  professional_id: 1000,
  quantidade_liberada: 20,
  periodo: "M" as const,
  dt_inicio: "2026-01-01",
  dt_fim: "2026-12-31",
  lg_ativo: true,
  ...overrides,
});

const getFromChain = () =>
  supabase.from as unknown as ReturnType<typeof vi.fn>;

describe("insuranceQuotasService — getAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna todas as cotas sem filtros, ordenadas por dt_inicio desc", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: [makeQuota({ id: 1 }), makeQuota({ id: 2 })], error: null });
    getFromChain().mockReturnValue(chain);

    const result = await insuranceQuotasService.getAll();
    expect(result).toHaveLength(2);
    expect(supabase.from).toHaveBeenCalledWith("insurance_quotas");
  });

  it("retorna lista vazia quando não há cotas", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: null, error: null });
    getFromChain().mockReturnValue(chain);

    const result = await insuranceQuotasService.getAll();
    expect(result).toEqual([]);
  });

  it("aplica filtros insuranceCompanyId, serviceId e active", async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      eq: eqSpy,
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: [], error: null });
    getFromChain().mockReturnValue(chain);

    await insuranceQuotasService.getAll({
      insuranceCompanyId: 10,
      serviceId: 100,
      active: true,
    });
    expect(eqSpy).toHaveBeenCalledWith("insurance_company_id", 10);
    expect(eqSpy).toHaveBeenCalledWith("service_id", 100);
    expect(eqSpy).toHaveBeenCalledWith("lg_ativo", true);
  });

  it("lança erro quando o Supabase retorna erro", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: null, error: { message: "DB offline" } });
    getFromChain().mockReturnValue(chain);

    await expect(insuranceQuotasService.getAll()).rejects.toThrow(/DB offline/);
  });
});

describe("insuranceQuotasService — checkAvailability (dentro_da_cota)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna disponivel/limite/dentro_da_cota quando cota existe e há vagas", async () => {
    // 1ª chamada: insurance_quotas (busca da cota)
    const quotaChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: makeQuota({ quantidade_liberada: 20 }),
        error: null,
      }),
    };
    // 2ª chamada: appointments (count)
    const apptChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
    };
    (apptChain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ count: 5, error: null });

    getFromChain()
      .mockReturnValueOnce(quotaChain)
      .mockReturnValueOnce(apptChain);

    const ref = new Date("2026-06-15T10:00:00Z");
    const result = await insuranceQuotasService.checkAvailability(
      10,
      100,
      1000,
      "M",
      ref
    );
    expect(result.limite).toBe(20);
    expect(result.disponivel).toBe(15);
    expect(result.dentro_da_cota).toBe(true);
    expect(supabase.from).toHaveBeenNthCalledWith(1, "insurance_quotas");
    expect(supabase.from).toHaveBeenNthCalledWith(2, "appointments");
  });

  it("retorna dentro_da_cota=false quando cota esgotada", async () => {
    const quotaChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: makeQuota({ quantidade_liberada: 5 }),
        error: null,
      }),
    };
    const apptChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
    };
    (apptChain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ count: 5, error: null });

    getFromChain()
      .mockReturnValueOnce(quotaChain)
      .mockReturnValueOnce(apptChain);

    const result = await insuranceQuotasService.checkAvailability(
      10,
      100,
      1000,
      "M",
      new Date("2026-06-15T10:00:00Z")
    );
    expect(result.disponivel).toBe(0);
    expect(result.dentro_da_cota).toBe(false);
  });

  it("retorna sentinela (-1) quando não há cota cadastrada para o criterio", async () => {
    const quotaChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    getFromChain().mockReturnValueOnce(quotaChain);

    const result = await insuranceQuotasService.checkAvailability(
      10,
      100,
      1000,
      "D"
    );
    expect(result).toEqual({
      disponivel: -1,
      limite: -1,
      dentro_da_cota: true,
    });
  });

  it("lança erro quando falha ao buscar cota", async () => {
    const quotaChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "quota query failed" },
      }),
    };
    getFromChain().mockReturnValueOnce(quotaChain);

    await expect(
      insuranceQuotasService.checkAvailability(10, 100, 1000, "M")
    ).rejects.toThrow(/quota query failed/);
  });

  it("lança erro quando falha ao contar agendamentos", async () => {
    const quotaChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: makeQuota({ quantidade_liberada: 10 }),
        error: null,
      }),
    };
    const apptChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
    };
    (apptChain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ count: null, error: { message: "appointments broken" } });

    getFromChain()
      .mockReturnValueOnce(quotaChain)
      .mockReturnValueOnce(apptChain);

    await expect(
      insuranceQuotasService.checkAvailability(10, 100, 1000, "M")
    ).rejects.toThrow(/appointments broken/);
  });

  it("considera periodo 'D' (dataInicio == dataFim)", async () => {
    const gteSpy = vi.fn().mockReturnThis();
    const lteSpy = vi.fn().mockReturnThis();
    const quotaChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: makeQuota({ quantidade_liberada: 10, periodo: "D" }),
        error: null,
      }),
    };
    const apptChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: gteSpy,
      lte: lteSpy,
      not: vi.fn().mockReturnThis(),
    };
    (apptChain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ count: 1, error: null });

    getFromChain()
      .mockReturnValueOnce(quotaChain)
      .mockReturnValueOnce(apptChain);

    await insuranceQuotasService.checkAvailability(
      10,
      100,
      1000,
      "D",
      new Date("2026-06-15T10:00:00Z")
    );
    // Para 'D', gte e lte recebem o mesmo dia
    expect(gteSpy).toHaveBeenCalledWith("appointment_date", "2026-06-15");
    expect(lteSpy).toHaveBeenCalledWith("appointment_date", "2026-06-15");
  });
});

describe("insuranceQuotasService — create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cria nova cota e retorna o registro criado", async () => {
    const insertSpy = vi.fn().mockReturnThis();
    const chain: Record<string, unknown> = {
      insert: insertSpy,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: makeQuota({ id: 99 }),
        error: null,
      }),
    };
    getFromChain().mockReturnValue(chain);

    const payload = {
      company_id: "company-1",
      insurance_company_id: 10,
      quantidade_liberada: 50,
      periodo: "M" as const,
      dt_inicio: "2026-07-01",
      lg_ativo: true,
    };
    const result = await insuranceQuotasService.create(payload);
    expect(result.id).toBe(99);
    expect(insertSpy).toHaveBeenCalledWith(payload);
  });

  it("lança erro quando Supabase falha ao inserir", async () => {
    const chain: Record<string, unknown> = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "FK violation" },
      }),
    };
    getFromChain().mockReturnValue(chain);

    await expect(
      insuranceQuotasService.create({
        company_id: "x",
        insurance_company_id: 1,
        quantidade_liberada: 1,
        periodo: "D",
        dt_inicio: "2026-01-01",
        lg_ativo: true,
      })
    ).rejects.toThrow(/FK violation/);
  });
});

describe("insuranceQuotasService — update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("atualiza cota existente e retorna registro atualizado", async () => {
    const updateSpy = vi.fn().mockReturnThis();
    const eqSpy = vi.fn().mockReturnThis();
    const chain: Record<string, unknown> = {
      update: updateSpy,
      eq: eqSpy,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: makeQuota({ quantidade_liberada: 99 }),
        error: null,
      }),
    };
    getFromChain().mockReturnValue(chain);

    const result = await insuranceQuotasService.update(1, {
      quantidade_liberada: 99,
    });
    expect(result.quantidade_liberada).toBe(99);
    expect(updateSpy).toHaveBeenCalledWith({ quantidade_liberada: 99 });
    expect(eqSpy).toHaveBeenCalledWith("id", 1);
  });

  it("lança erro quando Supabase falha ao atualizar", async () => {
    const chain: Record<string, unknown> = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "row not found" },
      }),
    };
    getFromChain().mockReturnValue(chain);

    await expect(
      insuranceQuotasService.update(999, { lg_ativo: false })
    ).rejects.toThrow(/row not found/);
  });
});

describe("insuranceQuotasService — delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deleta cota por id sem erro", async () => {
    const chain: Record<string, unknown> = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    getFromChain().mockReturnValue(chain);

    await expect(insuranceQuotasService.delete(42)).resolves.toBeUndefined();
    expect(chain.delete).toBeDefined();
  });

  it("lança erro quando Supabase falha ao deletar", async () => {
    const chain: Record<string, unknown> = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: { message: "FK constraint" } }),
    };
    getFromChain().mockReturnValue(chain);

    await expect(insuranceQuotasService.delete(1)).rejects.toThrow(
      /FK constraint/
    );
  });
});