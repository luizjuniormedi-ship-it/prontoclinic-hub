import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { MouseEventHandler, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { QuickActionsMenu } from "@/components/schedule/QuickActionsMenu";
import type { Appointment } from "@/types";

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: MouseEventHandler<HTMLButtonElement> }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

const appointment = {
  id: "appointment-qa-1",
  patientId: "patient-qa-1",
  patientName: "Paciente QA",
  doctorId: "professional-qa-1",
  doctorName: "Profissional QA",
  date: (() => {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
  })(),
  time: "09:00",
  duration: 30,
  status: "confirmed",
  type: "consulta",
} as Appointment;

describe("QuickActionsMenu - entrada transacional na Recepção", () => {
  it("encaminha check-in à Recepção e não oferece início clínico direto", async () => {
    const onAction = vi.fn();
    render(<QuickActionsMenu appointment={appointment} onAction={onAction} />);

    fireEvent.click(screen.getByText("Dar entrada na Recepção"));

    expect(onAction).toHaveBeenCalledWith("checkin", appointment);
    expect(screen.queryByText("Iniciar atendimento")).not.toBeInTheDocument();
  });

  it("preserva o appointment_id entre Agenda e Recepção sem alterar status na Agenda", () => {
    const scheduleSource = readFileSync("src/pages/SchedulePage.tsx", "utf8");
    const receptionSource = readFileSync("src/pages/ReceptionPage.tsx", "utf8");

    expect(scheduleSource).toContain(
      "navigate(`/reception?appointment=${encodeURIComponent(appointment.id)}`)",
    );
    expect(scheduleSource).not.toContain('waiting: "Check-in realizado"');
    expect(scheduleSource).not.toContain('in_progress: "Atendimento iniciado"');
    expect(receptionSource).toContain('searchParams.get("appointment")');
    expect(receptionSource).toContain("openCheckinRef.current(appointment)");
  });

  it("não permite entrada antecipada para agendamento futuro", () => {
    const future = new Date();
    future.setDate(future.getDate() + 1);
    const futureDate = [
      future.getFullYear(),
      String(future.getMonth() + 1).padStart(2, "0"),
      String(future.getDate()).padStart(2, "0"),
    ].join("-");

    render(
      <QuickActionsMenu
        appointment={{ ...appointment, date: futureDate }}
        onAction={vi.fn()}
      />,
    );

    expect(screen.queryByText("Dar entrada na Recepção")).not.toBeInTheDocument();
  });
});
