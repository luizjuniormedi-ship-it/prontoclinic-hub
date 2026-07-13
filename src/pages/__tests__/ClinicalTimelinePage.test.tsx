import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClinicalTimelinePage from "@/pages/ClinicalTimelinePage";

const mocks = vi.hoisted(() => ({
  searchPatients: vi.fn(),
  getPatientTimeline: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/services/clinicalTimelineService", () => ({
  clinicalTimelineService: {
    searchPatients: mocks.searchPatients,
    getPatientTimeline: mocks.getPatientTimeline,
  },
}));

vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));

const patient = { id: 10, full_name: "Maria Souza" };
const event = {
  event_type: "atendimento" as const,
  event_id: "record-20",
  event_date: "2026-07-13T12:00:00Z",
  title: "Cefaleia",
  detail: "Evolução estável",
  professional: "Dra. Ana",
  status: "signed" as const,
};

async function searchAndOpenPatient() {
  const searchButton = screen.getByRole("button", { name: "Buscar" });
  fireEvent.change(screen.getByPlaceholderText("Buscar paciente por nome..."), {
    target: { value: "Maria" },
  });
  fireEvent.click(searchButton);
  const patientButton = await screen.findByRole("button", { name: "Maria Souza" });
  await waitFor(() => expect(searchButton).toBeEnabled());
  await act(async () => {
    fireEvent.click(patientButton);
  });
}

describe("ClinicalTimelinePage read-only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchPatients.mockResolvedValue([patient]);
    mocks.getPatientTimeline.mockResolvedValue([event]);
  });

  it("exibe somente eventos canônicos e não oferece emissão ou impressão", async () => {
    render(<ClinicalTimelinePage />);
    await searchAndOpenPatient();

    expect(await screen.findByText("Cefaleia")).toBeInTheDocument();
    expect(screen.getByText("Evolução estável")).toBeInTheDocument();
    expect(screen.getByText("Assinado")).toBeInTheDocument();
    expect(mocks.getPatientTimeline).toHaveBeenCalledWith(10);
    expect(screen.queryByRole("button", { name: /receita|imprimir|emitir/i })).not.toBeInTheDocument();
  });

  it("mostra erro explícito e permite repetir a leitura", async () => {
    mocks.getPatientTimeline
      .mockRejectedValueOnce(new Error("Erro ao carregar timeline clínica: acesso negado"))
      .mockResolvedValueOnce([event]);

    render(<ClinicalTimelinePage />);
    await searchAndOpenPatient();

    expect(await screen.findByText("Erro ao carregar timeline clínica: acesso negado")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    });

    expect(await screen.findByText("Cefaleia")).toBeInTheDocument();
    expect(mocks.getPatientTimeline).toHaveBeenCalledTimes(2);
  });

  it("mostra erro explícito quando a busca de pacientes falha", async () => {
    mocks.searchPatients.mockRejectedValueOnce(new Error("Erro ao buscar pacientes: indisponível"));
    render(<ClinicalTimelinePage />);

    fireEvent.change(screen.getByPlaceholderText("Buscar paciente por nome..."), {
      target: { value: "Maria" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));

    expect(await screen.findByText("Erro ao buscar pacientes: indisponível")).toBeInTheDocument();
    await waitFor(() => expect(mocks.searchPatients).toHaveBeenCalledWith("Maria"));
  });
});

