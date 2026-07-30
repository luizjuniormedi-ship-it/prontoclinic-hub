import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BillingAccountsPage from "@/pages/BillingAccountsPage";
import { billingAccountsService, type BillingAccount } from "@/services/billingAccountsService";

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
vi.mock("@/services/billingAccountsService", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/services/billingAccountsService")>();
  return {
    ...original,
    billingAccountsService: {
      list: vi.fn(),
      stats: vi.fn(),
      review: vi.fn(),
      reopen: vi.fn(),
    },
  };
});

const account: BillingAccount = {
  id: "account-qa",
  patient_id: 101,
  insurance_id: 10,
  billing_type: "convenio",
  account_type: "ambulatorial",
  status: "aberta",
  competence_month: "2026-07",
  total_gross_amount: 150,
  total_net_amount: 150,
  total_paid_amount: 0,
  total_pending_amount: 150,
  authorization_number: "AUTH-QA",
  guide_number: "GUIA-QA",
  has_pending_issues: false,
  has_denial: false,
  is_reopened: false,
  created_at: "2026-07-29T12:00:00Z",
  opened_at: "2026-07-29T12:00:00Z",
  paid_at: null,
  version: 1,
  readiness: {
    account_id: "account-qa",
    version: 1,
    status: "aberta",
    issues: [],
    blocking_count: 0,
    can_close: true,
  },
  patient_name: "Paciente Faturamento QA",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(billingAccountsService.list).mockResolvedValue([account]);
  vi.mocked(billingAccountsService.stats).mockReturnValue({
    total: 1,
    abertas: 1,
    prontas: 1,
    comPendencia: 0,
    enviadas: 0,
    pagas: 0,
  });
  vi.mocked(billingAccountsService.review).mockResolvedValue(account.readiness);
});

async function openAccountDetail() {
  render(<BillingAccountsPage />);
  await screen.findByText("Paciente Faturamento QA");
  fireEvent.click(screen.getByTitle("Conferir"));
  expect(await screen.findByRole("dialog", { name: "Conferência da Conta" })).toBeInTheDocument();
}

describe("BillingAccountsPage — contrato canônico de pré-contas", () => {
  it("carrega somente billing_accounts e calcula indicadores da mesma resposta", async () => {
    await openAccountDetail();
    expect(billingAccountsService.list).toHaveBeenCalledTimes(1);
    expect(billingAccountsService.stats).toHaveBeenCalledWith([account]);
    expect(screen.getByRole("button", { name: "Revisar pendências" })).toBeEnabled();
  });

  it("mantém o carregamento funcional sem relações auxiliares inexistentes", async () => {
    render(<BillingAccountsPage />);
    expect(await screen.findByText("Paciente Faturamento QA")).toBeInTheDocument();
    expect(screen.queryByText("Competências")).not.toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("revisa pendências pela RPC canônica", async () => {
    await openAccountDetail();
    fireEvent.click(screen.getByRole("button", { name: "Revisar pendências" }));

    await waitFor(() => expect(billingAccountsService.review).toHaveBeenCalledWith(account));
  });
});
