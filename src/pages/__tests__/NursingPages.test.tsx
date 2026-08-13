import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import NursingQueuePage from "@/pages/NursingQueuePage";
import NursingTriagePage from "@/pages/NursingTriagePage";
import { TriageAtomicForm } from "@/components/nursing/m19/TriageAtomicForm";

const classifications = [{
  id: 1,
  company_id: null,
  ds_classificacao: "Verde",
  cd_cor_hex: "#00aa00",
  nr_tempo_max_atendimento_min: 120,
  ds_descricao: null,
  lg_ativo: true,
}];

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
  it("redireciona a rota legada para M19 preservando todo o contexto canonico", async () => {
    function LocationProbe() {
      const location = useLocation();
      return <output data-testid="location">{location.pathname}{location.search}</output>;
    }

    render(
      <MemoryRouter
        initialEntries={[
          "/nursing/triage?patientId=42&appointmentId=100&queueId=200&origin=reception",
        ]}
      >
        <Routes>
          <Route path="/nursing/triage" element={<NursingTriagePage />} />
          <Route path="/nursing/clinical" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/nursing/clinical?patientId=42&appointmentId=100&queueId=200&origin=reception",
    );
    expect(screen.queryByRole("button", { name: "Nova Triagem" })).not.toBeInTheDocument();
  });

  it("preserva a rota de painel TV sem redirecionar para o fluxo clinico", () => {
    render(
      <MemoryRouter initialEntries={["/nursing/triage?tv=1"]}>
        <NursingTriagePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Painel de Chamada" })).toBeInTheDocument();
    expect(mocks.queueDisplay).toHaveBeenLastCalledWith(
      expect.objectContaining({ companyId: "company-nursing-qa", unitId: 7, modoTV: true }),
      {},
    );
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

  it("sincroniza atomicamente o contexto M19 e só bloqueia os três IDs completos", () => {
    const { rerender } = render(
      <TriageAtomicForm
        unitId={7}
        classifications={classifications}
        initialPatientId={42}
        initialAppointmentId={100}
        initialQueueId={200}
        contextLocked
        onCompleted={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Paciente")).toHaveValue(42);
    expect(screen.getByLabelText("Agendamento")).toHaveValue(100);
    expect(screen.getByLabelText("Senha da fila")).toHaveValue(200);
    expect(screen.getByLabelText("Senha da fila")).toHaveAttribute("readonly");

    rerender(
      <TriageAtomicForm
        unitId={7}
        classifications={classifications}
        initialPatientId={43}
        initialAppointmentId={101}
        initialQueueId={201}
        contextLocked
        onCompleted={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Paciente")).toHaveValue(43);
    expect(screen.getByLabelText("Agendamento")).toHaveValue(101);
    expect(screen.getByLabelText("Senha da fila")).toHaveValue(201);

    rerender(
      <TriageAtomicForm
        unitId={7}
        classifications={classifications}
        initialPatientId={43}
        initialAppointmentId={101}
        initialQueueId={null}
        contextLocked={false}
        onCompleted={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Senha da fila")).toHaveValue(null);
    expect(screen.getByLabelText("Senha da fila")).not.toHaveAttribute("readonly");
  });
});
