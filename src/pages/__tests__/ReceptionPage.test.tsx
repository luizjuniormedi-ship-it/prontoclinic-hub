import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReceptionPage from "@/pages/ReceptionPage";

const mocks = vi.hoisted(() => ({
  authRole: "Recepção",
  getAppointments: vi.fn(),
  updateStatus: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role_name: mocks.authRole } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: <T,>(value: T) => value,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{
          id: "patient-1",
          full_name: "Paciente Teste",
          cpf: "12345678900",
          birth_date: "1990-01-01",
          phone: null,
          allergies: null,
          insurance_plan_id: null,
        }],
      }),
    })),
  },
}));

vi.mock("@/services/appointmentsService", () => ({
  appointmentsService: {
    getByDate: mocks.getAppointments,
    updateStatus: mocks.updateStatus,
  },
  professionalsLookup: { getAll: vi.fn().mockResolvedValue([]) },
  specialtiesLookup: { getAll: vi.fn().mockResolvedValue([]) },
  appointmentTypesLookup: { getAll: vi.fn().mockResolvedValue([]) },
}));

vi.mock("@/services/receptionService", () => ({
  receptionService: {
    listPending: vi.fn().mockResolvedValue([]),
  },
}));

const waitingAppointment = {
  id: "appointment-1",
  patient_id: "patient-1",
  professional_id: null,
  specialty_id: null,
  appointment_type_id: null,
  unit_id: null,
  appointment_date: "2026-07-13",
  start_time: "09:00:00",
  end_time: "09:30:00",
  status: "waiting",
  notes: null,
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function renderReception() {
  render(<ReceptionPage />);
  return screen.findByRole("button", { name: "Iniciar" });
}

describe("ReceptionPage - início operacional por persona", () => {
  beforeEach(() => {
    mocks.authRole = "Recepção";
    mocks.getAppointments.mockResolvedValue([waitingAppointment]);
    mocks.updateStatus.mockResolvedValue(undefined);
  });

  it("permite à recepção iniciar e aguarda a transição sem navegar para attendance", async () => {
    const transition = deferred<void>();
    mocks.updateStatus.mockReturnValueOnce(transition.promise);
    const startButton = await renderReception();

    fireEvent.click(startButton);

    expect(mocks.updateStatus).toHaveBeenCalledWith("appointment-1", "in_progress");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Iniciando..." })).toBeDisabled();

    transition.resolve();

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: "Atendimento iniciado!" }));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("navega perfil autorizado somente após a transição concluir", async () => {
    mocks.authRole = "Administrador";
    const transition = deferred<void>();
    mocks.updateStatus.mockReturnValueOnce(transition.promise);
    const startButton = await renderReception();

    fireEvent.click(startButton);
    expect(mocks.navigate).not.toHaveBeenCalled();

    transition.resolve();

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/attendance/appointment-1"));
  });

  it("mantém a página e mostra feedback quando a transição falha", async () => {
    mocks.updateStatus.mockRejectedValueOnce(new Error("Transição recusada"));
    const startButton = await renderReception();

    fireEvent.click(startButton);

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Erro",
      description: "Transição recusada",
      variant: "destructive",
    }));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});

