import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);
HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock("@/config/moduleRollout", () => ({
  isWaveModuleEnabled: () => true,
}));

import { ModuleLauncher } from "../ModuleLauncher";

function renderLauncher(roleName: string) {
  const onNavigate = vi.fn();
  render(
    <ModuleLauncher
      open
      onOpenChange={vi.fn()}
      roleName={roleName}
      storageScope={`test:${roleName}`}
      onNavigate={onNavigate}
    />,
  );
  return { onNavigate };
}

describe("ModuleLauncher", () => {
  it("starts with short, explicit journeys instead of the full catalog", () => {
    renderLauncher("admin");

    expect(screen.getByText("Dar entrada no paciente", { exact: true })).toBeVisible();
    expect(screen.getByText("Receber particular ou coparticipação", { exact: true })).toBeVisible();
    expect(screen.getByText("Faturar atendimento pelo convênio", { exact: true })).toBeVisible();
    expect(screen.queryByText("Usuários e acessos", { exact: true })).not.toBeInTheDocument();
  });

  it("keeps Reception separate from Caixa and insurance billing", () => {
    renderLauncher("recepcao");

    expect(screen.getByText("Dar entrada no paciente", { exact: true })).toBeVisible();
    expect(screen.queryByText("Receber particular ou coparticipação", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Faturar atendimento pelo convênio", { exact: true })).not.toBeInTheDocument();
  });

  it("opens a task area without exposing unrelated modules", () => {
    renderLauncher("admin");
    fireEvent.mouseDown(
      screen.getByRole("tab", { name: "Caixa e convênios" }),
      { button: 0, ctrlKey: false },
    );

    expect(screen.getByText("Caixa: Pix, cartão e dinheiro", { exact: true })).toBeVisible();
    expect(screen.getByText("Faturamento de convênios", { exact: true })).toBeVisible();
    expect(screen.queryByText("Triagem e risco", { exact: true })).not.toBeInTheDocument();
  });

  it("searches the full authorized catalog by payment terms", () => {
    renderLauncher("admin");
    const dialog = screen.getByRole("dialog", { name: "Buscar módulos e funções" });

    fireEvent.change(
      within(dialog).getByPlaceholderText("Buscar tarefa, módulo ou função..."),
      { target: { value: "pix" } },
    );

    expect(screen.getByText("Caixa: Pix, cartão e dinheiro", { exact: true })).toBeVisible();
    expect(screen.queryByText("Entrada do paciente", { exact: true })).not.toBeInTheDocument();
  });

  it("navigates to the selected journey", () => {
    const { onNavigate } = renderLauncher("admin");

    fireEvent.click(screen.getByText("Dar entrada no paciente", { exact: true }));

    expect(onNavigate).toHaveBeenCalledWith("/reception");
  });
});
