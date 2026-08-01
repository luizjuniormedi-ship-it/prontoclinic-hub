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
    limit: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
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
        amount: 300,
        discount: 50,
        total: 250,
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
        amount: 500,
        discount: 0,
        total: 500,
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

  it("cria faturamento pelo comando seguro sem aceitar contexto do navegador", async () => {
    const inserted: any = {
      id: 99,
      company_id: null,
      unit_id: 2,
      patient_id: 42,
      professional_id: null,
      amount: 200,
      discount: 0,
      total: 200,
      status: "em_aberto",
      notes: null,
      created_at: "2026-01-01T00:00:00Z",
    };
    (supabase.rpc as any).mockResolvedValue({ data: inserted, error: null });

    const result = await billingsService.create({
      patient_id: "42",
      gross_amount: 200,
      net_amount: 200,
      idempotency_key: "billing:test:99",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("create_manual_billing_secure", {
      p_patient_id: "42",
      p_professional_id: null,
      p_billing_type: "particular",
      p_gross_amount: 200,
      p_discount: 0,
      p_net_amount: 200,
      p_notes: null,
      p_idempotency_key: "billing:test:99",
    });
    expect(result).toEqual(expect.objectContaining({
      id: "99",
      patient_id: "42",
      unit_id: 2,
      gross_amount: 200,
      discount: 0,
      net_amount: 200,
      status: "em_aberto",
    }));
  });

  it("rejeita paciente inválido antes de chamar o banco", async () => {
    await expect(billingsService.create({
      patient_id: "patient-uuid",
      gross_amount: 300,
      net_amount: 300,
      idempotency_key: "billing:test:invalid",
    })).rejects.toThrow(/Paciente inválido/);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("lança erro quando supabase retorna error", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { message: "fk fail" },
    });

    await expect(
      billingsService.create({
        patient_id: "42",
        gross_amount: 100,
        net_amount: 100,
        idempotency_key: "billing:test:error",
      })
    ).rejects.toThrow(/Erro ao criar faturamento/);
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

  it("cria cobrança pelo comando seguro sem aceitar contexto do navegador", async () => {
    const inserted: any = {
      id: 99,
      patient_id: 42,
      amount: "100.00",
      discount: "0",
      status: "pendente",
    };
    (supabase.rpc as any).mockResolvedValue({ data: inserted, error: null });

    const result = await financialService.create({
      patient_id: "42",
      amount: 100,
      due_date: "2026-08-10",
      payment_method: "pix",
      notes: "Cobrança QA",
      idempotency_key: "financial:test:99",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("create_financial_receivable_secure", {
      p_patient_id: "42",
      p_amount: 100,
      p_due_date: "2026-08-10",
      p_payment_method: "pix",
      p_notes: "Cobrança QA",
      p_idempotency_key: "financial:test:99",
    });
    expect(result).toEqual(expect.objectContaining({
      id: "99",
      patient_id: "42",
      amount: 100,
      discount: 0,
      status: "pendente",
    }));
  });

  it("rejeita paciente inválido antes de chamar o banco", async () => {
    await expect(financialService.create({
      patient_id: "patient-uuid",
      amount: 200,
      idempotency_key: "financial:test:invalid",
    })).rejects.toThrow(/Paciente inválido/);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("lança erro quando supabase retorna error", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { message: "fail" },
    });

    await expect(
      financialService.create({
        patient_id: "42",
        amount: 100,
        idempotency_key: "financial:test:error",
      })
    ).rejects.toThrow(/Erro ao criar transação/);
  });
});

describe("financialService — markPaid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("liquida transação pelo comando seguro", async () => {
    const updated = {
      id: 1,
      patient_id: 42,
      amount: "100.00",
      discount: "0",
      status: "pago",
      payment_method: "pix",
    };
    (supabase.rpc as any).mockResolvedValue({ data: updated, error: null });

    const result = await financialService.markPaid("1", "pix");

    expect(supabase.rpc).toHaveBeenCalledWith("settle_financial_transaction_secure", {
      p_transaction_id: "1",
      p_payment_method: "pix",
    });
    expect(result).toEqual(expect.objectContaining({
      id: "1",
      patient_id: "42",
      amount: 100,
      status: "pago",
      payment_method: "pix",
    }));
  });

  it("rejeita cobrança inválida antes de chamar o banco", async () => {
    await expect(financialService.markPaid("t-1", "pix")).rejects.toThrow(
      /ID da cobrança inválido/
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("lança erro quando supabase retorna error", async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { message: "x" },
    });

    await expect(financialService.markPaid("1", "dinheiro")).rejects.toThrow(
      /Erro ao registrar pagamento/
    );
  });
});
