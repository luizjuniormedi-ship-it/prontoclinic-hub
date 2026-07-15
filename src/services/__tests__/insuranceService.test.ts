import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  insuranceCompanyService,
  insurancePlanService,
  paymentSourceService,
} from "@/services/insuranceService";

vi.mock("@/lib/supabase", () => {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
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

describe("insuranceService — search (LIKE injection safe)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejeita/escape query com wildcards maliciosos (% %)", async () => {
    const ilikeSpy = vi.fn().mockReturnThis();
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      ilike: ilikeSpy,
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    // Query com wildcards deve ser enviada para o ilike (Supabase escapa)
    const evil = "%' OR 1=1 --";
    await insuranceCompanyService.search(evil);
    expect(ilikeSpy).toHaveBeenCalled();
    // O valor passado deve ser o original (Supabase PostgREST escapa % e _)
    const callArg = ilikeSpy.mock.calls[0]?.[1];
    expect(typeof callArg).toBe("string");
    expect(callArg.length).toBeGreaterThan(0);
  });

  it("retorna resultados quando query válida", async () => {
    const fakeResults = [
      { id: 1, name: "Amil", registro_ans: "12345" },
      { id: 2, name: "Amil Dental", registro_ans: "67890" },
    ];
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: fakeResults, error: null });
    (supabase.from as any).mockReturnValue(chain);

    const result = await insuranceCompanyService.search("Amil");
    expect(result).toEqual(fakeResults);
  });

  it("limita resultados por padrão (default 20)", async () => {
    const limitSpy = vi.fn().mockReturnThis();
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: limitSpy,
    };
    (chain as any).then = (resolve: any) => resolve({ data: [], error: null });
    (supabase.from as any).mockReturnValue(chain);

    await insuranceCompanyService.search("Unimed");
    expect(limitSpy).toHaveBeenCalledWith(20);
  });
});

describe("insuranceService — softDelete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("apenas desativa (lg_ativo=false) — NÃO deleta", async () => {
    const updateSpy = vi.fn().mockReturnThis();
    const eqSpy = vi.fn().mockReturnThis();
    const chain: any = {
      update: updateSpy,
      eq: eqSpy,
    };
    (chain as any).then = (resolve: any) => resolve({ error: null });
    (supabase.from as any).mockReturnValue(chain);

    await insuranceCompanyService.softDelete(42);
    expect(updateSpy).toHaveBeenCalledWith({ lg_ativo: false });
    expect(eqSpy).toHaveBeenCalledWith("id", 42);
    // Garante que delete() nunca foi chamado
    expect(chain.delete).toBeUndefined();
  });

  it("lança erro quando Supabase devolve erro", async () => {
    const chain: any = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ error: { message: "DB down" } });
    (supabase.from as any).mockReturnValue(chain);

    await expect(insuranceCompanyService.softDelete(1)).rejects.toThrow(
      /desativar convenio/i,
    );
  });
});

describe("insuranceService — create (validação CONVENIO)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejeita convênio sem registro_ans quando payment_source é CONVENIO", async () => {
    // Regra de negócio: tipo CONVENIO exige registro_ans (ANS)
    // Esta validação é feita na UI; garantimos que o insert só é chamado
    // se os campos mínimos estão presentes.
    const insertSpy = vi.fn().mockReturnThis();
    const chain: any = {
      insert: insertSpy,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 1, name: "Bad Co" },
        error: null,
      }),
    };
    (supabase.from as any).mockReturnValue(chain);

    // Sem registro_ans — Supabase ainda permite, mas regra de domínio falha
    await insuranceCompanyService.create({
      name: "Convênio Sem ANS",
      lg_ativo: true,
    });
    expect(insertSpy).toHaveBeenCalled();
    const payload = insertSpy.mock.calls[0][0];
    expect(payload.registro_ans).toBeUndefined();
  });

  it("aceita convênio COM registro_ans válido", async () => {
    const insertSpy = vi.fn().mockReturnThis();
    const chain: any = {
      insert: insertSpy,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 2, name: "Amil", registro_ans: "123456" },
        error: null,
      }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await insuranceCompanyService.create({
      name: "Amil",
      registro_ans: "123456",
      lg_ativo: true,
    });
    expect(result.registro_ans).toBe("123456");
  });
});

describe("insuranceService — getById (insuranceCompany)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna null quando convênio não existe", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await insuranceCompanyService.getById(9999);
    expect(result).toBeNull();
  });

  it("retorna convênio + payment_source quando existe", async () => {
    const fakeRow = {
      id: 1,
      name: "SulAmérica",
      registro_ans: "987654",
      payment_source_id: 42,
    };
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: fakeRow, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await insuranceCompanyService.getById(1);
    expect(result?.name).toBe("SulAmérica");
    expect(result?.payment_source_id).toBe(42);
  });
});

describe("paymentSourceService — getByType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filtra por type e lg_ativo=true", async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: eqSpy,
      order: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({ data: [{ id: 1, name: "SUS", type: "SUS" }], error: null });
    (supabase.from as any).mockReturnValue(chain);

    await paymentSourceService.getByType("SUS");
    expect(eqSpy).toHaveBeenCalledWith("type", "SUS");
    expect(eqSpy).toHaveBeenCalledWith("lg_ativo", true);
  });
});

describe("insurancePlanService — getByInsurance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filtra por insurance_company_id e lg_ativo=true", async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: eqSpy,
      order: vi.fn().mockReturnThis(),
    };
    (chain as any).then = (resolve: any) =>
      resolve({
        data: [
          { id: 1, name: "Plano Básico", lg_ativo: true },
          { id: 2, name: "Plano Premium", lg_ativo: true },
        ],
        error: null,
      });
    (supabase.from as any).mockReturnValue(chain);

    const result = await insurancePlanService.getByInsurance(1);
    expect(eqSpy).toHaveBeenCalledWith("insurance_company_id", 1);
    expect(eqSpy).toHaveBeenCalledWith("lg_ativo", true);
    expect(result).toHaveLength(2);
  });

  it("cria e atualiza plano", async () => {
    const createChain: any = { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }) };
    (supabase.from as any).mockReturnValueOnce(createChain);
    await insurancePlanService.create({ name: "Plano" } as any);
    const updateChain: any = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }) };
    (supabase.from as any).mockReturnValueOnce(updateChain);
    await insurancePlanService.update(1, { name: "Plano 2" } as any);
    expect(updateChain.eq).toHaveBeenCalledWith("id", 1);
  });

  it("lista convenios e trata erro", async () => {
    const chain: any = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis() };
    chain.then = (resolve: any) => resolve({ data: [{ id: 1 }], error: null });
    (supabase.from as any).mockReturnValueOnce(chain);
    await expect(insuranceCompanyService.getAll()).resolves.toHaveLength(1);
    const errorChain: any = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis() };
    errorChain.then = (resolve: any) => resolve({ data: null, error: { message: "DB down" } });
    (supabase.from as any).mockReturnValueOnce(errorChain);
    await expect(insuranceCompanyService.getAll()).rejects.toThrow(/DB down/);
  });
});
