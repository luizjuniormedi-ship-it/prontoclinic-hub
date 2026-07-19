import { describe, expect, it, vi, beforeEach } from "vitest";
import { billingAccountsService, isBillingReadyForSubmission } from "@/services/billingAccountsService";

vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));

import { supabase } from "@/lib/supabase";

describe("billingAccountsService — contrato local", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lista contas, aplica filtros e enriquece paciente", async () => {
    const accountQuery = { select: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
    (accountQuery as any).then = (resolve: (value: unknown) => unknown) => resolve({ data: [{ id: "ba-1", patient_id: 10, status: "aberta" }], error: null });
    const patientQuery = { select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [{ id: 10, full_name: "Maria" }], error: null }) };
    (supabase.from as any).mockReturnValueOnce(accountQuery).mockReturnValueOnce(patientQuery);

    const result = await billingAccountsService.list({ status: "aberta", onlyPending: true });

    expect(accountQuery.eq).toHaveBeenCalledWith("status", "aberta");
    expect(accountQuery.eq).toHaveBeenCalledWith("has_pending_issues", true);
    expect(result[0].patient_name).toBe("Maria");
  });

  it("executa glosa preventiva pelo RPC com account_id", async () => {
    (supabase.rpc as any).mockResolvedValue({ data: 2, error: null });

    await expect(billingAccountsService.checkPending("ba-1")).resolves.toBe(2);
    expect(supabase.rpc).toHaveBeenCalledWith("billing_check_pending", { p_account_id: "ba-1" });
  });

  it("propaga bloqueio de schema/RPC como erro acionável", async () => {
    const query = { select: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis() };
    (query as any).then = (resolve: (value: unknown) => unknown) => resolve({ data: null, error: { message: "relation does not exist" } });
    (supabase.from as any).mockReturnValue(query);

    await expect(billingAccountsService.list()).rejects.toThrow(/relation does not exist/);
  });

  it("classifica pronta para envio pelo status canônico ou por conta aberta sem pendências", () => {
    expect(isBillingReadyForSubmission({ status: "pronta_envio", has_pending_issues: true })).toBe(true);
    expect(isBillingReadyForSubmission({ status: "aberta", has_pending_issues: false })).toBe(true);
    expect(isBillingReadyForSubmission({ status: "aberta", has_pending_issues: true })).toBe(false);
  });
});
