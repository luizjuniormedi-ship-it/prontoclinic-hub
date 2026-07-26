import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ReceptionCheckinDialog } from "@/components/reception/ReceptionCheckinDialog";
import type { CheckinIssue, CheckinReadiness } from "@/services/receptionService";
import type { Appointment } from "@/types";

vi.mock("@/components/reception/ReceptionFinancialPanel", () => ({
  ReceptionFinancialPanel: () => (
    <div id="reception-financial-title">Painel financeiro</div>
  ),
}));

function issue(overrides: Partial<CheckinIssue> & Pick<CheckinIssue, "type" | "description">): CheckinIssue {
  return {
    severity: "blocking",
    step: "general",
    blocking: true,
    resolution_action: null,
    owner: null,
    impact: null,
    legacy_fallback: false,
    ...overrides,
  };
}

const appointment = {
  id: "101",
  patientName: "Paciente Teste",
  time: "09:00",
  doctorName: "Profissional Teste",
} as Appointment;

function renderDialog(issues: CheckinIssue[]) {
  const readiness: CheckinReadiness = {
    appointment_id: 101,
    patient_id: 1,
    ready: false,
    issues,
    has_authorization_pending: false,
    has_document_pending: false,
  };

  render(
    <TooltipProvider delayDuration={0}>
      <ReceptionCheckinDialog
        appointment={appointment}
        readiness={readiness}
        loading={false}
        priority="normal"
        exceptionReason=""
        canReleaseException={false}
        onPriorityChange={vi.fn()}
        onExceptionReasonChange={vi.fn()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onOpenPatient={vi.fn()}
        onResolveIssue={vi.fn()}
        onCheckoutChanged={vi.fn().mockResolvedValue(undefined)}
      />
    </TooltipProvider>,
  );
}

describe("ReceptionCheckinDialog", () => {
  it("renderiza todas as issues por etapa com ação, responsável e impacto", () => {
    renderDialog([
      issue({
        type: "tiss_guide_invalid",
        description: "Guia TISS inválida",
        step: "tiss",
        resolution_action: "Corrigir os campos obrigatórios",
        owner: "Faturamento",
        impact: "Bloqueia o faturamento",
      }),
      issue({
        type: "tiss_signature_missing",
        description: "Método de assinatura ausente",
        step: "tiss",
      }),
      issue({
        type: "billing_not_prepared",
        description: "Pré-conta não preparada",
        step: "billing",
      }),
      issue({
        type: "payment_pending",
        description: "Pagamento pendente",
        step: "billing",
      }),
      issue({
        type: "cash_session_required",
        description: "Caixa precisa ser aberto",
        step: "billing",
      }),
    ]);

    expect(screen.getByText("Guia TISS inválida")).toBeInTheDocument();
    expect(screen.getByText("Método de assinatura ausente")).toBeInTheDocument();
    expect(screen.getByText("Pré-conta não preparada")).toBeInTheDocument();
    expect(screen.getByText("Pagamento pendente")).toBeInTheDocument();
    expect(screen.getByText("Caixa precisa ser aberto")).toBeInTheDocument();
    expect(screen.getByText("Ação recomendada: Corrigir os campos obrigatórios")).toBeInTheDocument();
    expect(screen.getByText("Responsável: Faturamento")).toBeInTheDocument();
    expect(screen.getByText("Impacto: Bloqueia o faturamento")).toBeInTheDocument();
  });
});
