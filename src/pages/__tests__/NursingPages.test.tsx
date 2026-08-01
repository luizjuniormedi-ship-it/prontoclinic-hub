import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import NursingQueuePage from "@/pages/NursingQueuePage";
import NursingTriagePage from "@/pages/NursingTriagePage";

const mocks = vi.hoisted(() => ({
  queueDisplay: vi.fn(({ modoTV }: { modoTV?: boolean }) => (
    <section data-tv-mode={modoTV ? "true" : "false"}>
      <h1>Painel de Chamada</h1>
      <button type="button">Chamar próxima</button>
    </section>
  )),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { company_id: "company-nursing-qa" },
    activeCompanyId: "company-nursing-qa",
    activeUnitId: 7,
  }),
}));

vi.mock("@/components/nursing/TriagePanel", () => ({
  TriagePanel: () => (
    <section>
      <h1>Triagem de Enfermagem</h1>
      <button type="button">Nova Triagem</button>
    </section>
  ),
}));

vi.mock("@/components/nursing/QueueDisplay", () => ({
  QueueDisplay: mocks.queueDisplay,
}));

describe("paginas de Enfermagem", () => {
  it("mantem a Triagem com um unico titulo e sua acao propria", () => {
    render(
      <MemoryRouter initialEntries={["/nursing/triage"]}>
        <NursingTriagePage />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("heading", { name: "Triagem de Enfermagem" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Nova Triagem" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chamar próxima" })).not.toBeInTheDocument();
  });

  it("renderiza a fila com titulo e acao distintos da Triagem", () => {
    render(
      <MemoryRouter initialEntries={["/nursing/queue"]}>
        <NursingQueuePage />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("heading", { name: "Painel de Chamada" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Chamar próxima" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nova Triagem" })).not.toBeInTheDocument();
    expect(mocks.queueDisplay).toHaveBeenLastCalledWith(
      expect.objectContaining({ companyId: "company-nursing-qa", unitId: 7, modoTV: false }),
      {},
    );
  });

  it("preserva o modo TV somente quando solicitado na rota da fila", () => {
    render(
      <MemoryRouter initialEntries={["/nursing/queue?tv=1"]}>
        <NursingQueuePage />
      </MemoryRouter>,
    );

    expect(mocks.queueDisplay).toHaveBeenLastCalledWith(
      expect.objectContaining({ companyId: "company-nursing-qa", unitId: 7, modoTV: true }),
      {},
    );
  });
});
