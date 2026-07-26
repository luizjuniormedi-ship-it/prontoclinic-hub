import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ReceptionFinancialPanel } from "@/components/reception/ReceptionFinancialPanel";
import type { ReceptionCheckoutSummary } from "@/services/receptionCheckoutService";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  openCashSession: vi.fn(),
  registerPayment: vi.fn(),
  generateGuide: vi.fn(),
  validateGuide: vi.fn(),
  signGuide: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/services/receptionCheckoutService", () => ({
  isReceptionGuideValid: (value: ReceptionCheckoutSummary) => Boolean(
    value.guide
    && ["validated", "signed"].includes(value.guide.status)
    && value.guide.validation_errors.length === 0,
  ),
  receptionCheckoutService: {
    prepare: mocks.prepare,
    openCashSession: mocks.openCashSession,
    registerPayment: mocks.registerPayment,
    generateGuide: mocks.generateGuide,
    validateGuide: mocks.validateGuide,
    signGuide: mocks.signGuide,
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

function summary(overrides: Partial<ReceptionCheckoutSummary> = {}): ReceptionCheckoutSummary {
  return {
    appointment_id: 101,
    patient_id: 1,
    company_id: "company-1",
    unit_id: 1,
    account_id: null,
    prepared: false,
    payer_type: "particular",
    collection_policy: "before_checkin",
    insurance_id: null,
    insurance_plan_id: null,
    service_id: null,
    service_name: "Consulta",
    gross_amount: 100,
    discount_amount: 0,
    net_amount: 100,
    copay_amount: 0,
    patient_responsibility_amount: 100,
    insurance_responsibility_amount: 0,
    patient_paid_amount: 0,
    patient_pending_amount: 100,
    authorization_number: null,
    requires_tiss_guide: false,
    requires_tiss_signature: true,
    suggested_guide_type: "consulta",
    guide: null,
    active_tiss_versions: [
      {
        id: 1,
        version: "04.03.00",
        scope: "prestador_operadora",
        effective_from: "2026-04-01",
        effective_until: null,
      },
    ],
    cash_session_open: false,
    receivable: null,
    ...overrides,
  };
}

function renderPanel(value: ReceptionCheckoutSummary, onChanged = vi.fn().mockResolvedValue(undefined)) {
  render(
    <TooltipProvider delayDuration={0}>
      <ReceptionFinancialPanel appointmentId="101" summary={value} onChanged={onChanged} />
    </TooltipProvider>,
  );
  return { onChanged };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue(summary({ prepared: true, account_id: 10 }));
  mocks.openCashSession.mockResolvedValue(undefined);
  mocks.generateGuide.mockResolvedValue(summary());
  mocks.validateGuide.mockResolvedValue(summary());
  mocks.signGuide.mockResolvedValue(summary());
});

describe("ReceptionFinancialPanel", () => {
  it("prepara uma única pré-conta com responsabilidade por pagador", async () => {
    const { onChanged } = renderPanel(summary());

    const prepareCharge = screen.getByRole("button", { name: /^Preparar cobrança\./ });
    expect(prepareCharge).toBeEnabled();
    fireEvent.click(prepareCharge);

    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: "101",
      payerType: "particular",
      grossAmount: 100,
      patientResponsibility: 100,
      insuranceResponsibility: 0,
      collectionPolicy: "before_checkin",
    })));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("não permite dinheiro sem caixa aberto e oferece a ação correta", () => {
    renderPanel(summary({ prepared: true, account_id: 10 }));

    expect(screen.getByText("Caixa fechado")).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: /Registrar pagamento\. Abra o caixa antes de receber em dinheiro\./,
    })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Abrir caixa\./ })).toBeEnabled();
  });

  it("gera a guia individual usando uma versão TISS ativa", async () => {
    const value = summary({
      prepared: true,
      account_id: 10,
      payer_type: "convenio",
      insurance_id: 4,
      patient_responsibility_amount: 0,
      insurance_responsibility_amount: 100,
      patient_pending_amount: 0,
      collection_policy: "waived",
      requires_tiss_guide: true,
    });
    const { onChanged } = renderPanel(value);

    fireEvent.click(screen.getByRole("button", { name: /^Gerar guia TISS\./ }));

    await waitFor(() => expect(mocks.generateGuide).toHaveBeenCalledWith(
      "101",
      "consulta",
      1,
      "",
    ));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("mantém a edição aberta quando a preparação falha", async () => {
    mocks.prepare.mockRejectedValueOnce(new Error("Falha ao preparar cobrança"));
    const { onChanged } = renderPanel(summary());

    fireEvent.click(screen.getByRole("button", { name: /^Preparar cobrança\./ }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Não foi possível concluir a ação",
      variant: "destructive",
    })));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Preparar cobrança\./ })).toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({
      title: "Cobrança preparada e enviada aos módulos responsáveis",
    }));
  });

  it("não anuncia sucesso quando a releitura autoritativa falha", async () => {
    const onChanged = vi.fn().mockRejectedValue(new Error("Readiness indisponível"));
    renderPanel(summary(), onChanged);

    fireEvent.click(screen.getByRole("button", { name: /^Preparar cobrança\./ }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Não foi possível concluir a ação",
      description: "Readiness indisponível",
      variant: "destructive",
    })));
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({
      title: "Cobrança preparada e enviada aos módulos responsáveis",
    }));
    expect(screen.getByRole("button", { name: /^Preparar cobrança\./ })).toBeInTheDocument();
  });

  it("impede desconto maior que o valor bruto", () => {
    renderPanel(summary());

    fireEvent.change(screen.getByLabelText("Desconto"), { target: { value: "150" } });

    expect(screen.getByText("O desconto deve ser maior ou igual a zero e não pode superar o valor bruto.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preparar cobrança/ })).toBeDisabled();
  });

  it("exibe todos os erros de validação retornados na guia", () => {
    renderPanel(summary({
      prepared: true,
      account_id: 10,
      payer_type: "convenio",
      requires_tiss_guide: true,
      guide: {
        id: 77,
        number: "GUIA-77",
        type: "consulta",
        status: "generated",
        version: "04.03.00",
        requires_signature: true,
        patient_signed_at: null,
        validation_errors: [
          "Código do procedimento obrigatório",
          "Número da carteirinha inválido",
        ],
      },
    }));

    expect(screen.getByText("Código do procedimento obrigatório")).toBeInTheDocument();
    expect(screen.getByText("Número da carteirinha inválido")).toBeInTheDocument();
  });

  it("não anuncia validação TISS quando o retorno contém pendências", async () => {
    const current = summary({
      prepared: true,
      account_id: 10,
      payer_type: "convenio",
      requires_tiss_guide: true,
      guide: {
        id: 77,
        number: "GUIA-77",
        type: "consulta",
        status: "generated",
        version: "04.03.00",
        requires_signature: true,
        patient_signed_at: null,
        validation_errors: [],
      },
    });
    mocks.validateGuide.mockResolvedValueOnce(summary({
      ...current,
      guide: {
        ...current.guide!,
        status: "generated",
        validation_errors: ["Número da carteirinha inválido"],
      },
    }));
    const { onChanged } = renderPanel(current);

    fireEvent.click(screen.getByRole("button", { name: /^Validar guia\./ }));

    await waitFor(() => expect(screen.getByText("Número da carteirinha inválido")).toBeInTheDocument());
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Guia TISS com pendências",
      variant: "destructive",
    }));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({
      title: "Guia TISS validada sem pendências",
    }));
  });

  it("anuncia validação TISS somente após retorno válido e releitura", async () => {
    const current = summary({
      prepared: true,
      account_id: 10,
      payer_type: "convenio",
      requires_tiss_guide: true,
      guide: {
        id: 77,
        number: "GUIA-77",
        type: "consulta",
        status: "generated",
        version: "04.03.00",
        requires_signature: true,
        patient_signed_at: null,
        validation_errors: [],
      },
    });
    mocks.validateGuide.mockResolvedValueOnce(summary({
      ...current,
      guide: {
        ...current.guide!,
        status: "validated",
        validation_errors: [],
      },
    }));
    const { onChanged } = renderPanel(current);

    fireEvent.click(screen.getByRole("button", { name: /^Validar guia\./ }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Guia TISS validada sem pendências",
    }));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.toast.mock.invocationCallOrder[0],
    );
  });

  it("deixa explícito que registra método sem capturar artefato de assinatura", () => {
    renderPanel(summary({
      prepared: true,
      account_id: 10,
      payer_type: "convenio",
      requires_tiss_guide: true,
      guide: {
        id: 77,
        number: "GUIA-77",
        type: "consulta",
        status: "validated",
        version: "04.03.00",
        requires_signature: true,
        patient_signed_at: null,
        validation_errors: [],
      },
    }));

    expect(screen.getByText(/Nenhuma imagem, biometria ou artefato de assinatura é capturado/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Registrar método da assinatura\./ })).toBeInTheDocument();
  });
});
