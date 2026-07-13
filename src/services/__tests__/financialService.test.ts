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
        patient_id: 101,
        appointment_id: 201,
        amount: 250,
        status: "pending",
        guide_number: "G-001",
        tiss_status: "consulta",
        dt_vencimento: null,
        dt_pagamento: null,
        patient_name: "Paciente Um",
        professional_name: "Dra. Um",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "b-2",
        company_id: "company-uuid",
        patient_id: 102,
        appointment_id: 202,
        amount: 500,
        status: "paid",
        guide_number: null,
        tiss_status: "exame",
        dt_vencimento: null,
        dt_pagamento: "2026-01-02",
        patient_name: "Paciente Dois",
        professional_name: "Dr. Dois",
        created_at: "2026-01-02T00:00:00Z",
      },
    ];

    (supabase.rpc as any).mockResolvedValue({ data: rows, error: null });

    const result = await billingsService.getAll();

    expect(supabase.rpc).toHaveBeenCalledWith("list_billing_production_secure");
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("b-1");
    expect(result[0].net_amount).toBe(250);
    expect(result[0].patient_name).toBe("Paciente Um");
    expect(result[0].professional_name).toBe("Dra. Um");
    expect(result[1].status).toBe("paid");
  });

  it("retorna array vazio quando não há dados", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });

    const result = await billingsService.getAll();
    expect(result).toEqual([]);
  });

  it("lança erro quando supabase retorna error", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(billingsService.getAll()).rejects.toThrow(/Erro ao buscar faturamentos/);
  });
});

describe("billingsService — create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cria faturamento por RPC vinculada ao atendimento", async () => {
    const inserted: any = {
      id: "b-99",
      company_id: null,
      patient_id: "patient-uuid",
      appointment_id: 201,
      amount: 200,
      tiss_status: "particular",
      guide_number: null,
      status: "em_aberto",
      created_at: "2026-01-01T00:00:00Z",
    };
    (supabase.rpc as any).mockResolvedValue({ data: inserted, error: null });

    const result = await billingsService.create({
      appointment_id: "201",
      gross_amount: 200,
      billing_type: "particular",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("create_billing_secure", {
      p_appointment_id: 201,
      p_amount: 200,
      p_tiss_status: "particular",
      p_guide_number: null,
    });
    expect(result).toEqual(expect.objectContaining({
      id: "b-99",
      patient_id: "patient-uuid",
      gross_amount: 200,
      discount: 0,
      net_amount: 200,
      status: "em_aberto",
    }));
  });

  it("lança erro quando supabase retorna error", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: { message: "fk fail" } });

    await expect(
      billingsService.create({
        appointment_id: "201",
        gross_amount: 100,
      })
    ).rejects.toThrow(/Erro ao criar faturamento/);
  });
});

describe("billingsService — updateStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("atualiza status do faturamento por RPC", async () => {
    const updated = { id: "1", amount: 100, status: "faturado", created_at: "2026-01-01" };
    (supabase.rpc as any).mockResolvedValue({ data: updated, error: null });

    const result = await billingsService.updateStatus("1", "faturado");

    expect(supabase.rpc).toHaveBeenCalledWith("update_billing_status_secure", {
      p_billing_id: 1, p_status: "faturado", p_reason: null,
    });
    expect(result.status).toBe("faturado");
  });

  it("lança erro quando supabase retorna error", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: { message: "db err" } });

    await expect(billingsService.updateStatus("b-1", "cancelado")).rejects.toThrow(
      /Erro ao atualizar faturamento/
    );
  });
});

describe("financialService — getAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mapeia o resumo financeiro seguro", async () => {
    const rows = [
      {
        billing_id: 10,
        company_id: "company-uuid",
        patient_id: 20,
        appointment_id: 30,
        billed_amount: "250.00",
        received_amount: "75.00",
        balance_amount: "175.00",
        financial_status: "parcial",
        due_date: "2026-01-15",
        last_payment_method: "pix",
        last_payment_at: "2026-01-10T12:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    (supabase.rpc as any).mockResolvedValue({ data: rows, error: null });

    const result = await financialService.getAll();

    expect(supabase.rpc).toHaveBeenCalledWith("list_billing_financial_summary_secure");
    expect(result[0]).toMatchObject({
      id: "10", patient_id: "20", appointment_id: "30",
      amount: 250, received_amount: 75, balance_amount: 175,
      status: "parcial", payment_method: "pix",
    });
  });

  it("retorna array vazio quando data=null", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });

    const result = await financialService.getAll();
    expect(result).toEqual([]);
  });

  it("lança erro quando supabase retorna error", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: { message: "x" } });

    await expect(financialService.getAll()).rejects.toThrow(/Erro ao buscar transações/);
  });
});

describe("financialService — recordPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registra recebimento pelo ledger com payload controlado", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: [{ id: 99 }], error: null });
    const key = "31111111-1111-4111-8111-111111111111";

    await financialService.recordPayment("10", 75, "pix", key);

    expect(supabase.rpc).toHaveBeenCalledWith("record_billing_receipt_secure", {
      p_billing_id: 10,
      p_amount: 75,
      p_payment_method: "pix",
      p_idempotency_key: key,
    });
  });

  it("lança erro quando supabase retorna error", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: { message: "fail" } });

    await expect(
      financialService.recordPayment("10", 75, "pix", "31111111-1111-4111-8111-111111111111")
    ).rejects.toThrow(
      /Erro ao registrar pagamento/
    );
  });
});

