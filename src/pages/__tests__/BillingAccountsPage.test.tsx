import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BillingAccountsPage from "@/pages/BillingAccountsPage";
import { billingAccountsService, type BillingAccount } from "@/services/billingAccountsService";
import { tissGuideService } from "@/services/tissGuideService";

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
vi.mock("@/services/tissGuideService", () => ({
  tissGuideService: { materializeAccount: vi.fn() },
}));
vi.mock("@/services/billingAccountsService", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/services/billingAccountsService")>();
  return {
    ...original,
    billingAccountsService: {
      list: vi.fn(),
      getFocused: vi.fn(),
      stats: vi.fn(),
      review: vi.fn(),
      reopen: vi.fn(),
      listCompetences: vi.fn(),
      closeCompetence: vi.fn(),
      reopenCompetence: vi.fn(),
      listAuditQueue: vi.fn(),
      claimAudit: vi.fn(),
      decideAudit: vi.fn(),
    },
  };
});

const account: BillingAccount = {
  id: "account-qa",
  appointment_id: 91001,
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
  vi.mocked(billingAccountsService.getFocused).mockResolvedValue(account);
  vi.mocked(billingAccountsService.stats).mockReturnValue({
    total: 1,
    abertas: 1,
    prontas: 1,
    comPendencia: 0,
    enviadas: 0,
    pagas: 0,
  });
  vi.mocked(billingAccountsService.review).mockResolvedValue(account.readiness);
  vi.mocked(tissGuideService.materializeAccount).mockResolvedValue({
    billing_account_id: account.id,
    appointment_id: account.appointment_id!,
    unit_id: 1,
    guide_id: "guide-qa",
    guide_number: 2026081201,
    xml_id: 9001,
    environment: "HOMOLOGACAO",
  });
  vi.mocked(billingAccountsService.listCompetences).mockResolvedValue([
    {
      id: null,
      competence_month: "2026-07-01",
      status: "open",
      version: 1,
      closed_at: null,
      close_reason: null,
      reopened_at: null,
      reopen_reason: null,
      account_count: 1,
      account_ids: [account.id],
      updated_at: "2026-07-29T12:00:00Z",
    },
  ]);
  vi.mocked(billingAccountsService.listAuditQueue).mockResolvedValue([
    {
      account_id: account.id,
      patient_name: account.patient_name || null,
      guide_number: account.guide_number,
      account_status: "aguardando_conferencia",
      account_version: 1,
      total_net_amount: 150,
      readiness: account.readiness,
      review_id: null,
      review_status: null,
      review_version: null,
      reviewer_id: null,
      reviewer_name: null,
      deadline_at: null,
      decided_at: null,
      opinion: null,
      evidence: null,
      sla_overdue: false,
    },
  ]);
});

async function openAccountDetail() {
  renderBillingAccountsPage();
  await screen.findByText("Paciente Faturamento QA");
  fireEvent.click(screen.getByTitle("Conferir"));
  expect(await screen.findByRole("dialog", { name: "Conferência da Conta" })).toBeInTheDocument();
}

function renderBillingAccountsPage(initialEntry = "/billing-accounts") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BillingAccountsPage />
    </MemoryRouter>,
  );
}

describe("BillingAccountsPage — contrato canônico de pré-contas", () => {
  it("carrega somente billing_accounts e calcula indicadores da mesma resposta", async () => {
    await openAccountDetail();
    expect(billingAccountsService.list).toHaveBeenCalledTimes(1);
    expect(billingAccountsService.stats).toHaveBeenCalledWith([account]);
    expect(screen.getByRole("button", { name: "Revisar pendências" })).toBeEnabled();
  });

  it("mantém o carregamento funcional sem relações auxiliares inexistentes", async () => {
    renderBillingAccountsPage();
    expect(await screen.findByText("Paciente Faturamento QA")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Competências" })).toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("abre diretamente a conta indicada pela recepção", async () => {
    renderBillingAccountsPage("/billing-accounts?account=account-qa&appointment=91001");

    expect(await screen.findByRole("dialog", { name: "Conferência da Conta" })).toBeInTheDocument();
    expect(screen.getAllByText("Paciente Faturamento QA").length).toBeGreaterThan(0);
    expect(billingAccountsService.getFocused).toHaveBeenCalledWith("account-qa", 91001);
    expect(billingAccountsService.list).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("normaliza valores NUMERIC serializados pelo PostgreSQL", async () => {
    vi.mocked(billingAccountsService.list).mockResolvedValue([{
      ...account,
      total_gross_amount: "150.50" as unknown as number,
      total_net_amount: "149.25" as unknown as number,
    }]);

    await openAccountDetail();

    expect(screen.getByText("R$ 150,50")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 149,25")).toHaveLength(2);
  });

  it("substitui a produção legada pela mesma projeção canônica de contas", async () => {
    renderBillingAccountsPage("/billing-production");

    expect(await screen.findByText("Paciente Faturamento QA")).toBeInTheDocument();
    expect(billingAccountsService.list).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Novo Faturamento" })).not.toBeInTheDocument();
  });

  it("falha fechado quando conta e agendamento não correspondem", async () => {
    vi.mocked(billingAccountsService.getFocused).mockRejectedValue(
      new Error("Conta da recepção não localizada no contexto ativo"),
    );

    renderBillingAccountsPage("/billing-accounts?account=account-qa&appointment=99999");

    expect(await screen.findByRole("alert")).toHaveTextContent("Conta da recepção não localizada");
    expect(screen.queryByText("Paciente Faturamento QA")).not.toBeInTheDocument();
    expect(billingAccountsService.list).not.toHaveBeenCalled();
  });

  it("revisa pendências pela RPC canônica", async () => {
    await openAccountDetail();
    fireEvent.click(screen.getByRole("button", { name: "Revisar pendências" }));

    await waitFor(() => expect(billingAccountsService.review).toHaveBeenCalledWith(account));
  });

  it("materializa guia e XML somente a partir da conta pronta para envio", async () => {
    const readyAccount: BillingAccount = { ...account, status: "pronta_envio", version: 4 };
    vi.mocked(billingAccountsService.list).mockResolvedValue([readyAccount]);

    renderBillingAccountsPage();
    await screen.findByText("Paciente Faturamento QA");
    fireEvent.click(screen.getByTitle("Conferir"));
    fireEvent.click(await screen.findByRole("button", { name: "Gerar guia e XML TISS" }));

    await waitFor(() => expect(tissGuideService.materializeAccount).toHaveBeenCalledWith({
      billingAccountId: readyAccount.id,
      expectedAppointmentId: readyAccount.appointment_id,
      expectedAccountVersion: 4,
    }));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Guia e XML TISS materializados",
    }));
  });

  it("diferencia valor financeiro invalido de zero legitimo", async () => {
    vi.mocked(billingAccountsService.list).mockResolvedValue([{
      ...account,
      total_gross_amount: "invalido" as unknown as number,
      total_net_amount: 0,
    }]);

    await openAccountDetail();

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 0,00").length).toBeGreaterThan(0);
  });

  it("nao mostra sucesso quando a materializacao retorna correlacao divergente", async () => {
    const readyAccount: BillingAccount = { ...account, status: "pronta_envio", version: 4 };
    vi.mocked(billingAccountsService.list).mockResolvedValue([readyAccount]);
    vi.mocked(tissGuideService.materializeAccount).mockResolvedValue({
      billing_account_id: "outra-conta", appointment_id: 999, unit_id: 1,
      guide_id: "guide-qa", guide_number: 2026081201, xml_id: 9001, environment: "HOMOLOGACAO",
    });

    renderBillingAccountsPage();
    await screen.findByText("Paciente Faturamento QA");
    fireEvent.click(screen.getByTitle("Conferir"));
    fireEvent.click(await screen.findByRole("button", { name: "Gerar guia e XML TISS" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Não foi possível materializar o TISS",
      variant: "destructive",
    })));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({
      title: "Guia e XML TISS materializados",
    }));
  });

  it("lista e fecha uma competência aberta pelo contrato seguro", async () => {
    const openCompetence = {
      id: null,
      competence_month: "2026-07-01",
      status: "open" as const,
      version: 1,
      closed_at: null,
      close_reason: null,
      reopened_at: null,
      reopen_reason: null,
      account_count: 1,
      account_ids: [account.id],
      updated_at: "2026-07-29T12:00:00Z",
    };
    vi.mocked(billingAccountsService.listCompetences).mockResolvedValue([openCompetence]);
    const closedCompetence = {
      ...openCompetence,
      id: "competence-qa",
      status: "closed" as const,
      version: 2,
    };
    vi.mocked(billingAccountsService.closeCompetence).mockResolvedValue(closedCompetence);

    renderBillingAccountsPage();
    await screen.findByText("Paciente Faturamento QA");
    const competencesTab = screen.getByRole("tab", { name: "Competências" });
    fireEvent.mouseDown(competencesTab, { button: 0, ctrlKey: false });
    fireEvent.click(competencesTab);

    await waitFor(() => expect(billingAccountsService.listCompetences).toHaveBeenCalled());
    fireEvent.click(await screen.findByTitle("Fechar competência"));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Fechamento mensal QA" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(billingAccountsService.closeCompetence).toHaveBeenCalledWith(
      expect.objectContaining({ competence_month: "2026-07-01", version: 1 }),
      "Fechamento mensal QA",
    ));
  });

  it("assume uma conta pela fila de auditoria sem criar outra conta", async () => {
    vi.mocked(billingAccountsService.claimAudit).mockResolvedValue({
      account_id: account.id,
      account_status: "em_auditoria",
      account_version: 2,
      review_id: "review-qa",
      review_status: "assigned",
      review_version: 1,
    });

    renderBillingAccountsPage();
    await screen.findByText("Paciente Faturamento QA");
    const auditTab = screen.getByRole("tab", { name: "Auditoria" });
    fireEvent.mouseDown(auditTab, { button: 0, ctrlKey: false });
    fireEvent.click(auditTab);

    await waitFor(() => expect(billingAccountsService.listAuditQueue).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: "Assumir" }));

    await waitFor(() => expect(billingAccountsService.claimAudit).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: account.id, account_version: 1 }),
    ));
  });
});

