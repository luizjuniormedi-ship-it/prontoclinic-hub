import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BillingAccountsPage from "@/pages/BillingAccountsPage";
import { billingAccountsService, type BillingAccount } from "@/services/billingAccountsService";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
vi.mock("@/hooks/useConfirm", () => ({
  useConfirm: () => ({ confirm: mocks.confirm }),
}));
vi.mock("@/services/billingAccountsService", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/services/billingAccountsService")>();
  return {
    ...original,
    billingAccountsService: {
      list: vi.fn(),
      listCompetencies: vi.fn(),
      stats: vi.fn(),
      pendingIssues: vi.fn(),
      checkPending: vi.fn(),
      resolveIssue: vi.fn(),
      reopen: vi.fn(),
      closeCompetency: vi.fn(),
      receitaPorConvenio: vi.fn(),
      receitaMensal: vi.fn(),
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
  opened_at: "2026-07-29T12:00:00Z",
  paid_at: null,
  patient_name: "Paciente Faturamento QA",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(billingAccountsService.list).mockResolvedValue([account]);
  vi.mocked(billingAccountsService.listCompetencies).mockResolvedValue([]);
  vi.mocked(billingAccountsService.stats).mockResolvedValue({
    total: 1,
    abertas: 1,
    prontas: 1,
    comPendencia: 0,
    enviadas: 0,
    pagas: 0,
  });
});

async function openAccountDetail() {
  render(<BillingAccountsPage />);
  await screen.findByText("Paciente Faturamento QA");
  fireEvent.click(screen.getByTitle("Conferir"));
  expect(await screen.findByRole("dialog", { name: "Conferência da Conta" })).toBeInTheDocument();
}

describe("BillingAccountsPage — conferência fail-closed", () => {
  it("não libera a conta quando a consulta de pendências falha", async () => {
    vi.mocked(billingAccountsService.pendingIssues).mockRejectedValue(new Error("Banco indisponível"));

    await openAccountDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A conta não está liberada para envio",
    );
    expect(screen.getByText("Banco indisponível")).toBeInTheDocument();
    expect(screen.queryByText("Sem pendências — conta pronta para envio")).not.toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Não foi possível verificar as pendências",
      variant: "destructive",
    }));
  });

  it("exibe conta pronta somente depois de consulta comprovadamente vazia", async () => {
    vi.mocked(billingAccountsService.pendingIssues).mockResolvedValue([]);

    await openAccountDetail();

    expect(await screen.findByText("Sem pendências — conta pronta para envio")).toBeInTheDocument();
    expect(screen.queryByText("A conta não está liberada para envio")).not.toBeInTheDocument();
  });

  it("permite repetir a consulta sem fechar o detalhe", async () => {
    vi.mocked(billingAccountsService.pendingIssues)
      .mockRejectedValueOnce(new Error("Falha transitória"))
      .mockResolvedValueOnce([]);

    await openAccountDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Tentar novamente" }));

    await waitFor(() => expect(billingAccountsService.pendingIssues).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Sem pendências — conta pronta para envio")).toBeInTheDocument();
  });

  it("não anuncia conta pronta quando a validação pós-glosa fica indisponível", async () => {
    vi.mocked(billingAccountsService.pendingIssues)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("Falha ao confirmar resultado"));
    vi.mocked(billingAccountsService.checkPending).mockResolvedValue(0);

    await openAccountDetail();
    await screen.findByText("Sem pendências — conta pronta para envio");
    fireEvent.click(screen.getByRole("button", { name: "Rodar glosa preventiva" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A conta não está liberada para envio",
    );
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Não foi possível validar a conta",
      variant: "destructive",
    }));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({
      title: "Glosa preventiva executada",
    }));
  });
});
