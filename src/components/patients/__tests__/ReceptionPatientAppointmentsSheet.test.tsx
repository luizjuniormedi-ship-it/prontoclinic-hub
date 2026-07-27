import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReceptionPatientAppointmentsSheet } from "../ReceptionPatientAppointmentsSheet";

const serviceMocks = vi.hoisted(() => ({
  listPatientAppointments: vi.fn(),
}));

vi.mock("@/services/receptionService", () => ({
  receptionService: serviceMocks,
}));

describe("ReceptionPatientAppointmentsSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.listPatientAppointments.mockResolvedValue([
      {
        id: "32",
        appointmentDate: "2026-07-26",
        startTime: "10:00:00",
        endTime: "10:30:00",
        status: "scheduled",
        unitId: 2,
        professionalId: 4,
        appointmentTypeId: 6,
      },
    ]);
  });

  it("apresenta somente o histórico retornado pela RPC da recepção", async () => {
    render(
      <ReceptionPatientAppointmentsSheet
        open
        onOpenChange={vi.fn()}
        patientId="8"
        patientName="Paciente Sintético"
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Agendamentos do paciente" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Paciente Sintético")).toBeInTheDocument();
    expect(
      await screen.findByRole("list", {
        name: "Histórico de agendamentos de Paciente Sintético",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("26/07/2026")).toBeInTheDocument();
    expect(screen.getByText("10:00 - 10:30")).toBeInTheDocument();
    expect(screen.getByText("Agendado")).toBeInTheDocument();
    expect(serviceMocks.listPatientAppointments).toHaveBeenCalledWith("8");
  });

  it("expõe falha de leitura sem apresentar dados obsoletos", async () => {
    serviceMocks.listPatientAppointments.mockRejectedValue(
      new Error("permission denied"),
    );

    render(
      <ReceptionPatientAppointmentsSheet
        open
        onOpenChange={vi.fn()}
        patientId="8"
        patientName="Paciente Sintético"
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("permission denied"),
    );
    expect(
      screen.queryByRole("list", {
        name: "Histórico de agendamentos de Paciente Sintético",
      }),
    ).not.toBeInTheDocument();
  });
});
