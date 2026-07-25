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
});

describe("ReceptionFinancialPanel", () => {
  it("prepara uma única pré-conta com responsabilidade por pagador", async () => {
    const { onChanged } = renderPanel(summary());

    expect(screen.getByText("Preparar cobrança")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Preparar cobrança\./ }));

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
});
