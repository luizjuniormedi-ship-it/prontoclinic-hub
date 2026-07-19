import { describe, it, expect, vi, beforeEach } from "vitest";
import { billingsService, financialService } from "@/services/financialService";

// Mock do Supabase
vi.mock("@/lib/supabase", () => {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
  return {
    supabase: {
      from: vi.fn(() => chain),
      auth: { getUser: vi.fn() },
      rpc: vi.fn(),
    },
  };
});

import { supabase } from "@/lib/supabase";

describe("billingsService — getAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna lista de faturamentos ordenada por created_at desc", async () => {
    const rows = [
      {
        id: "b-1",
        company_id: "company-uuid",
        unit_id: "unit-uuid",
        patient_id: "patient-uuid",
        professional_id: null,
        appointment_id: null,
        billing_type: "consulta",
        insurance_company_id: null,
        amount: 300,
        total: 250,
        gross_amount: 300,
        discount: 50,
        net_amount: 250,
        status: "em_aberto",
        notes: null,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "b-2",
        company_id: "company-uuid",
        unit_id: "unit-uuid",
        patient_id: "patient-uuid-2",
        professional_id: "prof-uuid",
        appointment_id: null,
        billing_type: "exame",
        insurance_company_id: "insurance-uuid",
        amount: 500,
        total: 500,
        gross_amount: 500,
        discount: 0,
        net_amount: 500,
        status: "pago",
        notes: "Exame de sangue",
        created_at: "2026-01-02T00:00:00Z",
      },
    ];

    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await billingsService.getAll();

    expect(supabase.from).toHaveBeenCalledWith("billings");
    expect(chain.select).toHaveBeenCalledWith("id, company_id, patient_id, amount, status, created_at");
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("b-1");
    expect(result[0].net_amount).toBe(250);
    expect(result[1].status).toBe("pago");
  });

  it("retorna array vazio quando não há dados", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await billingsService.getAll();
    expect(result).toEqual([]);
  });

  it("lança erro quando supabase retorna error", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
    };
    (supabase.from as any).mockReturnValue(chain);

    await expect(billingsService.getAll()).rejects.toThrow(/Erro ao buscar faturamentos/);
  });
});

describe("billingsService — create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cria faturamento com status padrão 'em_aberto' e discount=0", async () => {
    const inserted: any = { id: "b-99" };
    const chain: any = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: inserted, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await billingsService.create({
      patient_id: "patient-uuid",
      gross_amount: 200,
      net_amount: 200,
    });

    expect(supabase.from).toHaveBeenCalledWith("billings");
    expect(chain.insert).toHaveBeenCalledTimes(1);
    const insertedArg = chain.insert.mock.calls[0][0];
    expect(insertedArg.status).toBe("em_aberto");
    expect(insertedArg.discount).toBe(0);
    expect(insertedArg.patient_id).toBe("patient-uuid");
    expect(result.id).toBe(inserted.id);
    expect(result.gross_amount).toBe(0);
    expect(result.net_amount).toBe(0);
  });

  it("preserva status e discount quando fornecidos", async () => {
    const inserted: any = { id: "b-100" };
    const chain: any = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: inserted, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    await billingsService.create({
      patient_id: "patient-uuid",
      gross_amount: 300,
      discount: 30,
      net_amount: 270,
      status: "pago",
    });

    const insertedArg = chain.insert.mock.calls[0][0];
    expect(insertedArg.status).toBe("pago");
    expect(insertedArg.discount).toBe(30);
  });

  it("lança erro quando supabase retorna error", async () => {
    const chain: any = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "fk fail" } }),
    };
    (supabase.from as any).mockReturnValue(chain);

    await expect(
      billingsService.create({
        patient_id: "patient-uuid",
        gross_amount: 100,
        net_amount: 100,
      })
    ).rejects.toThrow(/Erro ao criar faturamento/);
  });
});

describe("billingsService — updateStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("atualiza status do faturamento", async () => {
    const updated = { id: "b-1", status: "pago" };
    const chain: any = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: updated, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await billingsService.updateStatus("b-1", "pago");

    expect(supabase.from).toHaveBeenCalledWith("billings");
    expect(chain.update).toHaveBeenCalledWith({ status: "pago" });
    expect(chain.eq).toHaveBeenCalledWith("id", "b-1");
    expect(result).toEqual(updated);
  });

  it("lança erro quando supabase retorna error", async () => {
    const chain: any = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "db err" } }),
    };
    (supabase.from as any).mockReturnValue(chain);

    await expect(billingsService.updateStatus("b-1", "cancelado")).rejects.toThrow(
      /Erro ao atualizar faturamento/
    );
  });
});

describe("billingsService — idempotência por atendimento", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reutiliza cobrança existente e não insere uma segunda", async () => {
    const existing = { id: "b-1", appointment_id: "a-1", company_id: "c-1", status: "em_aberto", amount: 100, total: 100 };
    const lookup = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
    };
    (supabase.from as any).mockReturnValue(lookup);

    const result = await billingsService.createForAppointment({ appointment_id: "a-1", company_id: "c-1", patient_id: "p-1", gross_amount: 100, net_amount: 100 });

    expect(result.id).toBe("b-1");
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("persiste appointment_id quando não há cobrança anterior", async () => {
    const lookup = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const insert = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "b-2", appointment_id: "a-2", amount: 100, total: 100 }, error: null }),
    };
    (supabase.from as any).mockReturnValueOnce(lookup).mockReturnValueOnce(insert);

    await billingsService.createForAppointment({ appointment_id: "a-2", patient_id: "p-1", gross_amount: 100, net_amount: 100 });

    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({ appointment_id: "a-2" }));
  });

  it("deduplica chamadas concorrentes para o mesmo atendimento na sessão", async () => {
    const lookup = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "b-3", appointment_id: "a-3", status: "em_aberto", amount: 100, total: 100 }, error: null }),
    };
    (supabase.from as any).mockReturnValue(lookup);

    const [first, second] = await Promise.all([
      billingsService.createForAppointment({ appointment_id: "a-3", patient_id: "p-1", gross_amount: 100, net_amount: 100 }),
      billingsService.createForAppointment({ appointment_id: "a-3", patient_id: "p-1", gross_amount: 100, net_amount: 100 }),
    ]);

    expect(first.id).toBe("b-3");
    expect(second.id).toBe("b-3");
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});

describe("financialService — getAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna lista de transações financeiras", async () => {
    const rows = [
      {
        id: "t-1",
        company_id: null,
        unit_id: null,
        patient_id: "patient-uuid",
        billing_id: "b-1",
        professional_id: null,
        appointment_id: null,
        amount: 250,
        discount: 0,
        payment_method: "pix",
        status: "pago",
        due_date: "2026-01-15",
        payment_date: "2026-01-15",
        notes: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];

    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await financialService.getAll();

    expect(supabase.from).toHaveBeenCalledWith("financial_transactions");
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(250);
    expect(result[0].payment_method).toBe("pix");
  });

  it("retorna array vazio quando data=null", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await financialService.getAll();
    expect(result).toEqual([]);
  });

  it("lança erro quando supabase retorna error", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: { message: "x" } }),
    };
    (supabase.from as any).mockReturnValue(chain);

    await expect(financialService.getAll()).rejects.toThrow(/Erro ao buscar transações/);
  });
});

describe("financialService — create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cria transação com status padrão 'pendente' e discount=0", async () => {
    const inserted: any = { id: "t-99" };
    const chain: any = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: inserted, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await financialService.create({
      patient_id: "patient-uuid",
      amount: 100,
    });

    expect(supabase.from).toHaveBeenCalledWith("financial_transactions");
    const insertedArg = chain.insert.mock.calls[0][0];
    expect(insertedArg.status).toBe("pendente");
    expect(insertedArg.discount).toBe(0);
    expect(insertedArg.patient_id).toBe("patient-uuid");
    expect(result).toEqual(inserted);
  });

  it("preserva status e discount fornecidos", async () => {
    const inserted: any = { id: "t-100" };
    const chain: any = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: inserted, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    await financialService.create({
      patient_id: "patient-uuid",
      amount: 200,
      discount: 20,
      status: "pago",
      payment_method: "cartao",
    });

    const insertedArg = chain.insert.mock.calls[0][0];
    expect(insertedArg.status).toBe("pago");
    expect(insertedArg.discount).toBe(20);
    expect(insertedArg.payment_method).toBe("cartao");
  });

  it("lança erro quando supabase retorna error", async () => {
    const chain: any = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "fail" } }),
    };
    (supabase.from as any).mockReturnValue(chain);

    await expect(
      financialService.create({
        patient_id: "patient-uuid",
        amount: 100,
      })
    ).rejects.toThrow(/Erro ao criar transação/);
  });
});

describe("financialService — markPaid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marca transação como paga com método e data atual", async () => {
    const updated = { id: "t-1", status: "pago" };
    const chain: any = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: updated, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await financialService.markPaid("t-1", "pix");

    expect(supabase.from).toHaveBeenCalledWith("financial_transactions");
    const updateArg = chain.update.mock.calls[0][0];
    expect(updateArg.status).toBe("pago");
    expect(updateArg.payment_method).toBe("pix");
    expect(updateArg.payment_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(chain.eq).toHaveBeenCalledWith("id", "t-1");
    expect(result).toEqual(updated);
  });

  it("lança erro quando supabase retorna error", async () => {
    const chain: any = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "x" } }),
    };
    (supabase.from as any).mockReturnValue(chain);

    await expect(financialService.markPaid("t-1", "dinheiro")).rejects.toThrow(
      /Erro ao registrar pagamento/
    );
  });
});

describe("financialService — updateStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("atualiza status da transação", async () => {
    const updated = { id: "t-1", status: "cancelado" };
    const chain: any = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: updated, error: null }),
    };
    (supabase.from as any).mockReturnValue(chain);

    const result = await financialService.updateStatus("t-1", "cancelado");

    expect(supabase.from).toHaveBeenCalledWith("financial_transactions");
    expect(chain.update).toHaveBeenCalledWith({ status: "cancelado" });
    expect(chain.eq).toHaveBeenCalledWith("id", "t-1");
    expect(result).toEqual(updated);
  });

  it("lança erro quando supabase retorna error", async () => {
    const chain: any = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "y" } }),
    };
    (supabase.from as any).mockReturnValue(chain);

    await expect(financialService.updateStatus("t-1", "x")).rejects.toThrow(
      /Erro ao atualizar transação/
    );
  });
});
