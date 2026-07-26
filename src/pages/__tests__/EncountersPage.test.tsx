import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EncountersPage from "@/pages/EncountersPage";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@/services/encountersService", () => ({
  ENC_STATUS_LABELS: {
    waiting: "Aguardando atendimento",
    completed: "Finalizado",
  },
  encountersService: {
    list: mocks.list,
  },
}));

describe("EncountersPage — roteamento canônico", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([{
      id: "55",
      appointment_id: "55",
      patient_id: "12",
      professional_id: "8",
      encounter_type: "Consulta",
      status: "waiting",
      appointment_date: "2026-07-25",
      start_time: "10:30:00",
      created_at: "2026-07-25T10:30:00",
      patient_name: "Paciente QA",
    }]);
  });

  it("abre o atendimento pelo appointment_id canônico", async () => {
    render(<EncountersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Abrir atendimento" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/attendance/55");
  });

  it("encaminha o prontuário para a rota records", async () => {
    render(<EncountersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Prontuário" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/records");
  });
});
