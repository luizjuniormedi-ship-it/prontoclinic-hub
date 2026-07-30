import { beforeEach, describe, expect, it, vi } from "vitest";
import { billingAccountsService, type BillingAccount } from "@/services/billingAccountsService";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: mocks.rpc },
}));

describe("billingAccountsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: [], error: null });
  });

  it("lista contas somente pela projeção segura", async () => {
    await billingAccountsService.list();

    expect(mocks.rpc).toHaveBeenCalledWith("m39_list_billing_accounts_secure", {
      p_status: null,
      p_billing_type: null,
      p_competence: null,
      p_only_pending: false,
      p_limit: 300,
    });
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
      version: 1,
      readiness: {
        account_id: "qa",
        version: 1,
        status: "aberta",
        issues: [],
        blocking_count: 0,
        can_close: true,
      },
    } satisfies Omit<BillingAccount, "status">;

    const stats = billingAccountsService.stats([
      { ...base, id: "open", status: "aberta" },
      { ...base, id: "ready", status: "pronta_envio" },
    ]);

    expect(stats.prontas).toBe(1);
  });

  it("usa versão otimista e operação idempotente ao revisar", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
    mocks.rpc.mockResolvedValueOnce({
      data: {
        account_id: "qa",
        version: 2,
        status: "com_pendencia",
        issues: [{ code: "guide_number_missing", severity: "blocking" }],
        blocking_count: 1,
        can_close: false,
      },
      error: null,
    });

    await billingAccountsService.review({
      id: "qa",
      version: 1,
    } as BillingAccount);

    expect(mocks.rpc).toHaveBeenCalledWith("m39_review_billing_account_secure", {
      p_account_id: "qa",
      p_expected_version: 1,
      p_operation_id: "11111111-1111-4111-8111-111111111111",
    });
  });
});
