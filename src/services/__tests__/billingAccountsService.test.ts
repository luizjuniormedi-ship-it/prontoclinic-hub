import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  billingAccountsService,
  getBillingFinancialIssues,
  isBillingAccountReady,
  type BillingAccount,
} from "@/services/billingAccountsService";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

function account(
  totalGrossAmount: number,
  totalNetAmount: number,
): BillingAccount {
  return {
    id: "billing-1",
    patient_id: 1,
    insurance_id: null,
    billing_type: "particular",
    account_type: "consulta",
    status: "aberta",
    competence_month: null,
    total_gross_amount: totalGrossAmount,
    total_net_amount: totalNetAmount,
    total_paid_amount: 0,
    total_pending_amount: totalNetAmount,
    authorization_number: null,
    guide_number: null,
    has_pending_issues: false,
    has_denial: false,
    is_reopened: false,
    opened_at: "2026-07-25T12:00:00.000Z",
    paid_at: null,
  };
}

describe("getBillingFinancialIssues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aceita uma conta financeiramente consistente", () => {
    expect(getBillingFinancialIssues(account(200, 180))).toEqual([]);
  });

  it("impede conta pronta com bruto zerado ou líquido acima do bruto", () => {
    expect(getBillingFinancialIssues(account(0, 180))).toContain(
      "Valor bruto deve ser maior que zero.",
    );
    expect(getBillingFinancialIssues(account(100, 180))).toContain(
      "Valor líquido não pode superar o valor bruto.",
    );
  });
});

describe("isBillingAccountReady", () => {
  it("exige estado pronto, valores coerentes e ausência de pendências", () => {
    const open = account(200, 180);
    const ready = { ...open, status: "pronta_envio" as const };

    expect(isBillingAccountReady(open)).toBe(false);
    expect(isBillingAccountReady(ready)).toBe(true);
    expect(isBillingAccountReady(ready, 1)).toBe(false);
    expect(isBillingAccountReady({ ...ready, total_gross_amount: 0 })).toBe(false);
  });
});

describe("billingAccountsService.checkPending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockAccountUpdate() {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    vi.mocked(supabase.from).mockReturnValue({ update } as never);
    return { update, eq };
  }

  it("marca inconsistência financeira como pendência sem declarar a conta pronta", async () => {
    const update = mockAccountUpdate();

    const result = await billingAccountsService.checkPending(account(0, 180));

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(update.update).toHaveBeenCalledWith({
      status: "com_pendencia",
      has_pending_issues: true,
    });
    expect(result).toEqual({
      pendingCount: 2,
      financialIssues: [
        "Valor bruto deve ser maior que zero.",
        "Valor líquido não pode superar o valor bruto.",
      ],
      status: "com_pendencia",
    });
  });

  it("marca como pronta somente após a glosa canônica retornar sem pendências", async () => {
    const update = mockAccountUpdate();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: 0, error: null } as never);

    const result = await billingAccountsService.checkPending(account(200, 180));

    expect(supabase.rpc).toHaveBeenCalledWith("billing_check_pending", {
      p_account_id: "billing-1",
    });
    expect(update.update).toHaveBeenCalledWith({
      status: "pronta_envio",
      has_pending_issues: false,
    });
    expect(result.status).toBe("pronta_envio");
    expect(result.pendingCount).toBe(0);
  });

  it("mantém estado de pendência quando a glosa canônica encontra bloqueios", async () => {
    const update = mockAccountUpdate();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: 2, error: null } as never);

    const result = await billingAccountsService.checkPending(account(200, 180));

    expect(update.update).toHaveBeenCalledWith({
      status: "com_pendencia",
      has_pending_issues: true,
    });
    expect(result.status).toBe("com_pendencia");
    expect(result.pendingCount).toBe(2);
  });
});

describe("billingAccountsService.stats", () => {
  it("não conta uma conta aberta como pronta antes da glosa", async () => {
    const open = account(200, 180);
    const ready = { ...account(300, 250), id: "billing-2", status: "pronta_envio" as const };
    vi.spyOn(billingAccountsService, "list").mockResolvedValueOnce([open, ready]);

    const result = await billingAccountsService.stats();

    expect(result.abertas).toBe(1);
    expect(result.prontas).toBe(1);
  });
});
