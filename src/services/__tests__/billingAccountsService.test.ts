import { beforeEach, describe, expect, it, vi } from "vitest";
import { billingAccountsService, type BillingAccount } from "@/services/billingAccountsService";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  is: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: mocks.from },
}));

describe("billingAccountsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue({ select: () => ({ is: mocks.is }) });
    mocks.is.mockReturnValue({ order: mocks.order });
    mocks.order.mockReturnValue({ limit: mocks.limit });
    mocks.limit.mockResolvedValue({ data: [], error: null });
  });

  it("ordena a tabela canônica pela coluna existente created_at", async () => {
    await billingAccountsService.list();

    expect(mocks.from).toHaveBeenCalledWith("billing_accounts");
    expect(mocks.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("considera pronta somente a conta no estado pronta_envio", () => {
    const base = {
      id: "qa",
      patient_id: null,
      insurance_id: null,
      billing_type: "convenio",
      account_type: "ambulatorial",
      competence_month: null,
      total_gross_amount: 100,
      total_net_amount: 100,
      total_paid_amount: 0,
      total_pending_amount: 100,
      authorization_number: null,
      guide_number: null,
      has_pending_issues: false,
      has_denial: false,
      is_reopened: false,
      created_at: "2026-07-29T12:00:00Z",
      opened_at: "2026-07-29T12:00:00Z",
      paid_at: null,
    } satisfies Omit<BillingAccount, "status">;

    const stats = billingAccountsService.stats([
      { ...base, id: "open", status: "aberta" },
      { ...base, id: "ready", status: "pronta_envio" },
    ]);

    expect(stats.prontas).toBe(1);
  });
});
