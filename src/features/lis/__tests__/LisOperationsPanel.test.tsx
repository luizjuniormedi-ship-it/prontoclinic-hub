import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gatewayMocks = vi.hoisted(() => ({
  acknowledgeCriticalAlert: vi.fn(),
  collectSpecimen: vi.fn(),
  deliverOrder: vi.fn(),
  recordQcRun: vi.fn(),
  recordResults: vi.fn(),
  transitionSpecimen: vi.fn(),
  validateResult: vi.fn(),
}));

vi.mock("@/features/lis/api/lisGateway", () => gatewayMocks);

import { LisOperationsPanel } from "../components/LisOperationsPanel";

describe("LisOperationsPanel", () => {
  beforeEach(() => {
    Object.values(gatewayMocks).forEach((mock) => mock.mockReset());
  });

  it("renderiza o contexto operacional sem disparar RPC", () => {
    render(
      <LisOperationsPanel
        companyId="00000000-0000-4000-8000-000000000001"
        unitId={2}
        roleName="Laboratório"
      />,
    );

    expect(screen.getByRole("heading", { name: "Operação laboratorial" })).toBeInTheDocument();
    expect(screen.getByText("Unidade 2 · perfil Laboratório")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Coletar amostra" })).toBeEnabled();
    expect(gatewayMocks.collectSpecimen).not.toHaveBeenCalled();
  });

  it("bloqueia operações para um perfil não autorizado", () => {
    render(
      <LisOperationsPanel
        companyId="00000000-0000-4000-8000-000000000001"
        unitId={2}
        roleName="Recepção"
      />,
    );

    expect(screen.getByRole("button", { name: "Coletar amostra" })).toBeDisabled();
    expect(
      screen.getByText("Contexto de empresa, unidade ou perfil inválido."),
    ).toBeInTheDocument();
  });

  it("impede laboratório de liberar resultado e permite validação técnica", () => {
    render(
      <LisOperationsPanel
        companyId="00000000-0000-4000-8000-000000000001"
        unitId={2}
        roleName="Laboratório"
      />,
    );

    const validationTab = screen.getByRole("tab", { name: "Validação" });
    fireEvent.mouseDown(validationTab, { button: 0, ctrlKey: false });
    fireEvent.click(validationTab);

    const submit = screen.getByRole("button", { name: "Confirmar etapa" });
    expect(submit).toBeEnabled();

    const actionSelect = screen.getByRole("combobox", { name: "Etapa" });
    fireEvent.mouseDown(actionSelect, { button: 0, ctrlKey: false });
    fireEvent.click(actionSelect);
    fireEvent.click(screen.getByRole("option", { name: "Liberação" }));

    expect(submit).toBeDisabled();
    expect(gatewayMocks.validateResult).not.toHaveBeenCalled();
  });
});
