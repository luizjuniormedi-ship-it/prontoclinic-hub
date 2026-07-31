import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  billingAccountsService,
  type BillingAccount,
  type BillingAuditQueueItem,
  type BillingCompetence,
} from "@/services/billingAccountsService";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: mocks.rpc },
}));

describe("billingAccountsService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it("localiza o handoff da recepção por conta e agendamento", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        id: "account-qa",
        appointment_id: 91001,
        status: "aberta",
        opened_at: "2026-07-29T12:00:00Z",
      },
      error: null,
    });

    const focused = await billingAccountsService.getFocused("account-qa", 91001);

    expect(mocks.rpc).toHaveBeenCalledWith("m39_get_billing_account_secure", {
      p_account_id: "account-qa",
      p_appointment_id: 91001,
    });
    expect(focused).toMatchObject({ id: "account-qa", appointment_id: 91001 });
  });

  it("considera pronta somente a conta no estado pronta_envio", () => {
    const base = {
      id: "qa",
      appointment_id: null,
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

  it("fecha e reabre competência somente pelos comandos auditáveis", async () => {
    const competence: BillingCompetence = {
      id: null,
      competence_month: "2026-07-01",
      status: "open",
      version: 1,
      closed_at: null,
      close_reason: null,
      reopened_at: null,
      reopen_reason: null,
      account_count: 2,
      account_ids: ["account-a", "account-b"],
      updated_at: "2026-07-29T12:00:00Z",
    };
    const operationIds = [
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ] as const;
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(operationIds[0])
      .mockReturnValueOnce(operationIds[1]);
    mocks.rpc
      .mockResolvedValueOnce({ data: { ...competence, status: "closed", version: 2 }, error: null })
      .mockResolvedValueOnce({ data: { ...competence, status: "open", version: 3 }, error: null });

    const closed = await billingAccountsService.closeCompetence(competence, "  Fechamento QA  ");
    await billingAccountsService.reopenCompetence(closed, "  Reabertura QA  ");

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "m39_close_billing_competence_secure", {
      p_competence: "2026-07-01",
      p_reason: "Fechamento QA",
      p_expected_version: 1,
      p_operation_id: operationIds[0],
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "m39_reopen_billing_competence_secure", {
      p_competence: "2026-07-01",
      p_reason: "Reabertura QA",
      p_expected_version: 2,
      p_operation_id: operationIds[1],
    });
  });

  it("lista, assume e decide a auditoria pela fila segura", async () => {
    const item = {
      account_id: "account-audit",
      account_status: "aguardando_conferencia",
      account_version: 3,
      review_id: null,
      review_version: null,
    } as BillingAuditQueueItem;
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444")
      .mockReturnValueOnce("55555555-5555-4555-8555-555555555555");
    mocks.rpc
      .mockResolvedValueOnce({ data: [item], error: null })
      .mockResolvedValueOnce({
        data: {
          account_id: item.account_id,
          account_status: "em_auditoria",
          account_version: 4,
          review_id: "review-audit",
          review_status: "assigned",
          review_version: 1,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          account_id: item.account_id,
          account_status: "pronta_envio",
          account_version: 5,
          review_id: "review-audit",
          review_status: "approved",
          review_version: 2,
        },
        error: null,
      });

    await billingAccountsService.listAuditQueue();
    const claimed = await billingAccountsService.claimAudit(item);
    await billingAccountsService.decideAudit(
      {
        ...item,
        account_status: "em_auditoria",
        account_version: claimed.account_version,
        review_id: claimed.review_id,
        review_version: claimed.review_version,
      },
      "approved",
      "  Documentação conferida  ",
      "  Guia e laudo anexados  ",
    );

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "m37_list_billing_audit_queue_secure", {
      p_status: null,
      p_limit: 200,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "m37_claim_billing_audit_secure", {
      p_account_id: "account-audit",
      p_expected_account_version: 3,
      p_operation_id: "44444444-4444-4444-8444-444444444444",
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(3, "m37_decide_billing_audit_secure", {
      p_account_id: "account-audit",
      p_review_id: "review-audit",
      p_decision: "approved",
      p_opinion: "Documentação conferida",
      p_evidence: { note: "Guia e laudo anexados" },
      p_expected_account_version: 4,
      p_expected_review_version: 1,
      p_operation_id: "55555555-5555-4555-8555-555555555555",
    });
  });
});

