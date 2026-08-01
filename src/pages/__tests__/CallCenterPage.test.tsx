import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CallCenterPage from "@/pages/CallCenterPage";

const mocks = vi.hoisted(() => ({
  listContacts: vi.fn(),
  listTasks: vi.fn(),
  listConfirmationQueue: vi.fn(),
  materializeConfirmationQueue: vi.fn(),
  recordConfirmation: vi.fn(),
  completeTask: vi.fn(),
  createContact: vi.fn(),
  searchPatients: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/services/callCenterService", () => ({
  callCenterService: {
    listContacts: mocks.listContacts,
    listTasks: mocks.listTasks,
    listConfirmationQueue: mocks.listConfirmationQueue,
    materializeConfirmationQueue: mocks.materializeConfirmationQueue,
    recordConfirmation: mocks.recordConfirmation,
    completeTask: mocks.completeTask,
    createContact: mocks.createContact,
  },
}));

vi.mock("@/services/patientsService", () => ({
  patientsService: { search: mocks.searchPatients },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const confirmation = {
  id: 7,
  appointment_id: 70,
  patient_id: 10,
  due_at: "2026-07-27T12:00:00.000Z",
  status: "pending" as const,
  attempt_count: 0,
  last_attempt_at: null,
  patient_name: "Paciente QA",
  patient_phone: "21999999999",
};

describe("CallCenterPage", () => {
  beforeEach(() => {
    mocks.listContacts.mockResolvedValue([]);
    mocks.listTasks.mockResolvedValue([]);
    mocks.listConfirmationQueue.mockResolvedValue([]);
    mocks.materializeConfirmationQueue.mockResolvedValue(4);
    mocks.recordConfirmation.mockResolvedValue(undefined);
    mocks.completeTask.mockResolvedValue(undefined);
    mocks.createContact.mockResolvedValue({});
    mocks.searchPatients.mockResolvedValue([]);
  });

  it("carrega a tela e faz retry somente com consultas de leitura", async () => {
    mocks.listContacts
      .mockRejectedValueOnce(new Error("falha de leitura"))
      .mockResolvedValueOnce([]);

    render(<CallCenterPage />);

    fireEvent.click(await screen.findByRole("button", { name: /tentar novamente/i }));

    await screen.findByRole("heading", { name: "Call Center" });
    expect(mocks.listContacts).toHaveBeenCalledTimes(2);
    expect(mocks.listTasks).toHaveBeenCalledTimes(2);
    expect(mocks.listConfirmationQueue).toHaveBeenCalledTimes(2);
    expect(mocks.materializeConfirmationQueue).not.toHaveBeenCalled();
  });

  it("materializa a fila uma única vez após comando e confirmação explícitos", async () => {
    render(<CallCenterPage />);

    await screen.findByRole("heading", { name: "Call Center" });
    expect(mocks.materializeConfirmationQueue).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Atualizar fila" }));
    expect(mocks.materializeConfirmationQueue).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: "Confirmar atualização" }));

    await waitFor(() => {
      expect(mocks.materializeConfirmationQueue).toHaveBeenCalledTimes(1);
      expect(mocks.materializeConfirmationQueue).toHaveBeenCalledWith(3);
    });
    await waitFor(() => expect(mocks.listConfirmationQueue).toHaveBeenCalledTimes(2));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Fila de confirmação atualizada",
    }));
  });

  it("registra a confirmação e apenas recarrega as listas", async () => {
    mocks.listConfirmationQueue.mockResolvedValue([confirmation]);

    render(<CallCenterPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() => {
      expect(mocks.recordConfirmation).toHaveBeenCalledWith(7, "confirmed", undefined);
    });
    await waitFor(() => expect(mocks.listConfirmationQueue).toHaveBeenCalledTimes(2));
    expect(mocks.materializeConfirmationQueue).not.toHaveBeenCalled();
  });
});
