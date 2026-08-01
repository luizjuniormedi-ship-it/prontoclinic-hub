import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MeusAgendamentosPage from "@/pages/MeusAgendamentosPage";
import {
  clinicDateKey,
  diffClinicDays,
} from "@/services/patientPortalDate";

const mocks = vi.hoisted(() => ({
  listAppointments: vi.fn(),
  confirmAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
  rescheduleAppointment: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/services/patientPortalService", () => ({
  patientPortalService: {
    listAppointments: mocks.listAppointments,
    confirmAppointment: mocks.confirmAppointment,
    cancelAppointment: mocks.cancelAppointment,
    rescheduleAppointment: mocks.rescheduleAppointment,
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const oldAppointment = {
  id: "980403",
  appointment_date: "2099-08-03",
  start_time: "11:00:00",
  end_time: "11:30:00",
  status: "scheduled",
  is_return: false,
  professional_name: "Profissional Portal CI",
  unit_name: "Unidade Sintetica CI",
};

const newAppointment = {
  ...oldAppointment,
  appointment_date: "2099-08-10",
  start_time: "14:00:00",
  end_time: "14:30:00",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <MeusAgendamentosPage />
    </MemoryRouter>,
  );
}

describe("MeusAgendamentosPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAppointments.mockResolvedValue([oldAppointment]);
    mocks.confirmAppointment.mockResolvedValue({
      ...oldAppointment,
      status: "confirmed",
    });
    mocks.cancelAppointment.mockResolvedValue({
      ...oldAppointment,
      status: "cancelled",
    });
    mocks.rescheduleAppointment.mockResolvedValue(newAppointment);
  });

  it("renderiza somente o DTO seguro com nomes do profissional e unidade", async () => {
    renderPage();

    expect(await screen.findByText(/Profissional Portal CI/)).toBeVisible();
    expect(screen.getByText("Unidade Sintetica CI")).toBeVisible();
    expect(screen.queryByText(/QA_PATIENT_RESCHEDULE/)).not.toBeInTheDocument();
    expect(mocks.listAppointments).toHaveBeenCalledTimes(1);
  });

  it("usa o calendário da clínica no limite UTC da noite brasileira", () => {
    const utcAfterMidnight = new Date("2026-07-27T00:30:00.000Z");

    expect(clinicDateKey(utcAfterMidnight)).toBe("2026-07-26");
    expect(diffClinicDays("2026-07-26", utcAfterMidnight)).toBe(0);
    expect(diffClinicDays("2026-07-27", utcAfterMidnight)).toBe(1);
  });

  it("persiste o reagendamento e recarrega a fonte autoritativa", async () => {
    mocks.listAppointments
      .mockResolvedValueOnce([oldAppointment])
      .mockResolvedValueOnce([newAppointment]);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /reagendar/i }));
    fireEvent.change(screen.getByLabelText("Nova data"), {
      target: { value: "2099-08-10" },
    });
    fireEvent.change(screen.getByLabelText("Novo horário"), {
      target: { value: "14:00" },
    });
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "Conflito de horário familiar" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar reagendamento" }),
    );

    await waitFor(() => {
      expect(mocks.rescheduleAppointment).toHaveBeenCalledWith("980403", {
        appointmentDate: "2099-08-10",
        startTime: "14:00",
        reason: "Conflito de horário familiar",
      });
    });
    await waitFor(() => expect(mocks.listAppointments).toHaveBeenCalledTimes(2));
    expect(
      document.querySelector('time[datetime="2099-08-10"]'),
    ).toBeInTheDocument();
    expect(screen.getByText("14:00")).toBeVisible();
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Agendamento reagendado.",
    });
  });

  it("mantém o modal aberto e informa falha de contrato", async () => {
    mocks.rescheduleAppointment.mockRejectedValue(
      new Error("Horário indisponível para o profissional"),
    );

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /reagendar/i }));
    fireEvent.change(screen.getByLabelText("Nova data"), {
      target: { value: "2099-08-10" },
    });
    fireEvent.change(screen.getByLabelText("Novo horário"), {
      target: { value: "14:00" },
    });
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "Conflito de horário familiar" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar reagendamento" }),
    );

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith({
        title: "Erro ao reagendar",
        description: "Horário indisponível para o profissional",
        variant: "destructive",
      });
    });
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(mocks.listAppointments).toHaveBeenCalledTimes(1);
  });
});
