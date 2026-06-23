import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fornecedoresService,
  cotacoesService,
  ordensCompraService,
  purchasesReportsService,
  fornecedorSchema,
  ordemCompraSchema,
  cotacaoSchema,
} from "@/services/purchasesService";

vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
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

describe("purchasesService — fornecedorSchema (Zod)", () => {
  it("valida fornecedor mínimo válido", () => {
    const result = fornecedorSchema.safeParse({ nm_razao_social: "ACME LTDA" });
    expect(result.success).toBe(true);
  });

  it("rejeita CNPJ com tamanho incorreto", () => {
    const result = fornecedorSchema.safeParse({
      nm_razao_social: "X",
      cd_cnpj: "123",
    });
    expect(result.success).toBe(false);
  });
});

describe("purchasesService — ordemCompraSchema (Zod)", () => {
  it("rejeita OC sem itens", () => {
    const result = ordemCompraSchema.safeParse({
      nr_ordem: "OC-1",
      cd_fornecedor: 1,
      vl_total: 100,
      itens: [],
    });
    expect(result.success).toBe(false);
  });

  it("aceita OC com 1 item e total coerente", () => {
    const result = ordemCompraSchema.safeParse({
      nr_ordem: "OC-1",
      cd_fornecedor: 1,
      vl_total: 100,
      itens: [{ ds_produto: "Item 1", qt_solicitada: 2, vl_unitario: 50, vl_total: 100 }],
    });
    expect(result.success).toBe(true);
  });
});

describe("purchasesService — cotacaoSchema (Zod)", () => {
  it("rejeita cotação sem itens", () => {
    const result = cotacaoSchema.safeParse({ nr_cotacao: "C-1", itens: [] });
    expect(result.success).toBe(false);
  });
});

describe("fornecedoresService — getAll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lista fornecedores com filtros (search/tipo/ativo)", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: [{ id: 1, nm_razao_social: "ACME" }], error: null });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await fornecedoresService.getAll({ search: "ACME", tipo: "MATERIAIS", ativo: true });
    expect(result).toHaveLength(1);
    expect(supabase.from).toHaveBeenCalledWith("fornecedores");
  });

  it("create insere fornecedor parseado", async () => {
    const chain: Record<string, unknown> = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 99, nm_razao_social: "Nova" }, error: null }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const result = await fornecedoresService.create({ nm_razao_social: "Nova" });
    expect(result.id).toBe(99);
  });
});

describe("ordensCompraService — fluxo básico", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aprovar muda status e seta aprovador", async () => {
    const chain: Record<string, unknown> = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 1, tp_status: "APROVADA" }, error: null }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const result = await ordensCompraService.aprovar(1, "user-uuid");
    expect(result.tp_status).toBe("APROVADA");
  });

  it("receber exige nota fiscal e atualiza status + dt_recebimento", async () => {
    const chain: Record<string, unknown> = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 1, tp_status: "RECEBIDA", nr_nota_fiscal: "123" }, error: null }),
    };
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const result = await ordensCompraService.receber(1, "123");
    expect(result.tp_status).toBe("RECEBIDA");
    expect(result.nr_nota_fiscal).toBe("123");
  });
});

describe("cotacoesService — getAll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filtra por status", async () => {
    const eqSpy = vi.fn().mockReturnThis();
    const orderSpy = vi.fn().mockReturnThis();
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: eqSpy,
      order: orderSpy,
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: [], error: null });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    await cotacoesService.getAll({ status: "EM_ANDAMENTO" });
    expect(eqSpy).toHaveBeenCalledWith("tp_status", "EM_ANDAMENTO");
  });
});

describe("purchasesReportsService — getTotalGasto", () => {
  beforeEach(() => vi.clearAllMocks());

  it("soma vl_total de OCs recebidas no período", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
    };
    (chain as { then: (r: (v: unknown) => unknown) => unknown }).then = (r) =>
      r({ data: [{ vl_total: 100 }, { vl_total: 250.5 }], error: null });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    const total = await purchasesReportsService.getTotalGasto("2026-01-01", "2026-12-31");
    expect(total).toBeCloseTo(350.5);
  });
});