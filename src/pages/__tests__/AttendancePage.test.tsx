import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AttendancePage from "../AttendancePage";

const mocks = vi.hoisted(() => ({ id: "1", from: vi.fn(), toast: vi.fn() }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ appointmentId: mocks.id }), useNavigate: () => vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/services/medicalRecordsService", () => ({ medicalRecordsService: { finalizeAttendance: vi.fn() } }));

function response(data: unknown, error: unknown = null) { return { data, error }; }
function appointment(id: string) { return { id, patient_id: id, status: "confirmed" }; }
function patient(id: string) { return { id, full_name: `Paciente ${id}` }; }
function query(result: unknown) {
  return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(result) }) }) };
}

describe("AttendancePage route isolation", () => {
  beforeEach(() => { mocks.id = "1"; mocks.from.mockReset(); });

  it("clears clinical fields when navigating to another appointment", async () => {
    mocks.from.mockImplementation((table) => query(response(table === "appointments" ? appointment(mocks.id) : patient(mocks.id))));
    const view = render(<AttendancePage />);
    await screen.findByText("Paciente 1");
    fireEvent.change(screen.getByPlaceholderText("Motivo da consulta..."), { target: { value: "Relato do paciente anterior" } });
    mocks.id = "2";
    view.rerender(<AttendancePage />);
    await screen.findByText("Paciente 2");
    expect(screen.getByPlaceholderText("Motivo da consulta...")).toHaveValue("");
    expect(screen.queryByText("Paciente 1")).not.toBeInTheDocument();
  });

  it("ignores an old patient response arriving after route navigation", async () => {
    let resolveOld!: (value: unknown) => void;
    const oldPatient = new Promise((resolve) => { resolveOld = resolve; });
    mocks.from.mockImplementation((table) => query(table === "appointments" ? response(appointment(mocks.id)) : mocks.id === "1" ? oldPatient : response(patient("2"))));
    const view = render(<AttendancePage />);
    await waitFor(() => expect(mocks.from).toHaveBeenCalledWith("patients"));
    mocks.id = "2";
    view.rerender(<AttendancePage />);
    await screen.findByText("Paciente 2");
    await act(async () => resolveOld(response(patient("1"))));
    expect(screen.queryByText("Paciente 1")).not.toBeInTheDocument();
    expect(screen.getByText("Paciente 2")).toBeInTheDocument();
  });

  it("blocks finalization when patient loading fails", async () => {
    mocks.from.mockImplementation((table) => query(table === "appointments" ? response(appointment("1")) : response(null, { message: "denied" })));
    render(<AttendancePage />);
    await screen.findByText("Não foi possível carregar o paciente deste atendimento.");
    expect(screen.queryByRole("button", { name: "Finalizar Atendimento" })).not.toBeInTheDocument();
  });
});
