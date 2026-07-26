import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  billingsService,
  financialService,
  type DbFinancialTransaction,
} from "@/services/financialService";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

const canonicalBilling = {
  id: 41,
  company_id: "company-1",
  unit_id: 7,
  patient_id: 12,
  professional_id: 8,
  appointment_id: 55,
  billing_type: "particular",
  total_gross_amount: 300,
  total_discount_amount: 50,
  total_net_amount: 250,
  status: "aberta",
  notes: null,
  opened_at: "2026-07-25T10:00:00Z",
  created_at: "2026-07-25T10:00:00Z",
};

const canonicalReceivable = {
  id: 71,
  company_id: "company-1",
  unit_id: 7,
  patient_id: 12,
  billing_account_id: 41,
  billing_id: 41,
  professional_id: 8,
  appointment_id: 55,
  transaction_type: "receivable",
  amount: 250,
  discount: 0,
  payment_method: null,
  status: "open",
  due_date: "2026-07-25",
  payment_date: null,
  notes: null,
  created_at: "2026-07-25T10:00:00Z",
};

function billingListChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
}

function billingLookupChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
}

describe("billingsService — contrato canônico", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lista billing_accounts e mantém a visão legada sem consultar billings", async () => {
    const chain = billingListChain({ data: [canonicalBilling], error: null });
    vi.mocked(supabase.from).mockReturnValue(chain as never);

    const result = await billingsService.getAll();

    expect(supabase.from).toHaveBeenCalledWith("billing_accounts");
    expect(supabase.from).not.toHaveBeenCalledWith("billings");
    expect(result).toEqual([
      expect.objectContaining({
        id: "41",
        patient_id: "12",
        appointment_id: "55",
        gross_amount: 300,
        discount: 50,
        net_amount: 250,
        status: "em_aberto",
        canonical_status: "aberta",
      }),
    ]);
  });

  it("reutiliza idempotentemente a conta já vinculada ao atendimento", async () => {
    const chain = billingLookupChain({ data: canonicalBilling, error: null });
    vi.mocked(supabase.from).mockReturnValue(chain as never);

    const result = await billingsService.create({
      appointment_id: "55",
      patient_id: "12",
      gross_amount: 300,
      discount: 50,
      net_amount: 250,
    });

    expect(result.id).toBe("41");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("prepara uma conta ausente pelo RPC transacional e a relê", async () => {
    vi.mocked(supabase.from)
      .mockReturnValueOnce(billingLookupChain({ data: null, error: null }) as never)
      .mockReturnValueOnce(billingLookupChain({ data: canonicalBilling, error: null }) as never);
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { account_id: 41 }, error: null } as never);

    const result = await billingsService.create({
      appointment_id: "55",
      patient_id: "12",
      billing_type: "particular",
      gross_amount: 300,
      discount: 50,
      net_amount: 250,
      notes: "Atendimento concluído",
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "prepare_reception_checkout_secure",
      expect.objectContaining({
        p_appointment_id: 55,
        p_patient_responsibility: 250,
        p_insurance_responsibility: 0,
        p_collection_policy: "accounts_receivable",
      }),
    );
    expect(result.id).toBe("41");
  });

  it("rejeita uma conta avulsa sem inventar linha em tabela legada", async () => {
    await expect(billingsService.create({
      patient_id: "12",
      gross_amount: 100,
      net_amount: 100,
    })).rejects.toThrow(/a partir de um atendimento/i);

    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("financialService — recebíveis canônicos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lista somente financial_transactions do tipo receivable", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [canonicalReceivable], error: null }),
    };
    vi.mocked(supabase.from).mockReturnValue(chain as never);

    const result = await financialService.getAll();

    expect(supabase.from).toHaveBeenCalledWith("financial_transactions");
    expect(chain.eq).toHaveBeenCalledWith("transaction_type", "receivable");
    expect(result[0]).toEqual(expect.objectContaining({
      id: "71",
      billing_id: "41",
      appointment_id: "55",
      status: "pendente",
      canonical_status: "open",
    }));
  });

  it("registra PIX pelo RPC seguro com referência e idempotência", async () => {
    const refreshed = { ...canonicalReceivable, status: "paid", payment_date: "2026-07-25" };
    const refreshChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: refreshed, error: null }),
    };
    vi.mocked(supabase.rpc).mockResolvedValue({ data: {}, error: null } as never);
    vi.mocked(supabase.from).mockReturnValue(refreshChain as never);

    const result = await financialService.markPaid(
      {
        ...canonicalReceivable,
        id: "71",
        patient_id: "12",
        billing_id: "41",
        professional_id: "8",
        appointment_id: "55",
        status: "pendente",
        canonical_status: "open",
      } as DbFinancialTransaction,
      "pix",
      "PIX-E2E-0001",
    );

    expect(supabase.rpc).toHaveBeenCalledWith(
      "register_reception_payment_secure",
      expect.objectContaining({
        p_appointment_id: 55,
        p_amount: 250,
        p_payment_method: "pix",
        p_idempotency_key: "financial:71:full-payment",
        p_external_reference: "PIX-E2E-0001",
      }),
    );
    expect(result.status).toBe("pago");
    expect(result.canonical_status).toBe("paid");
  });

  it("não registra pagamento eletrônico sem comprovante", async () => {
    const transaction = {
      id: "71",
      appointment_id: "55",
      amount: 250,
    } as DbFinancialTransaction;

    await expect(financialService.markPaid(transaction, "pix"))
      .rejects.toThrow(/comprovante/i);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("não registra recebível sem vínculo com atendimento", async () => {
    const transaction = {
      id: "71",
      appointment_id: null,
      amount: 250,
    } as DbFinancialTransaction;

    await expect(financialService.markPaid(transaction, "dinheiro"))
      .rejects.toThrow(/vinculado a um atendimento/i);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
