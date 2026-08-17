import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DicomWorklistPage from "@/pages/DicomWorklistPage";
import type { DicomWorklistItem } from "@/types/dicom";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  cancel: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/services/dicomService", () => ({
  worklistQueueService: {
    list: mocks.list,
    cancel: mocks.cancel,
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: mocks.toast,
}));

const pendingItem: DicomWorklistItem = {
  id: "00000000-0000-4000-8000-000000000010",
  company_id: "00000000-0000-4000-8000-000000000001",
  unit_id: 7,
  appointment_id: 101,
  imaging_order_item_id: "00000000-0000-4000-8000-000000000011",
  idempotency_key: "worklist-appointment-101",
  patient_id: "501",
  patient_name: "Paciente Worklist QA",
  patient_identifier: "PM-501",
  accession_number: "ACC-2026-0001",
  requested_procedure_description: "Radiografia de tórax",
  modality_type: "CR",
  scheduled_station_aetitle: "PRONTOMEDIC_CR",
  scheduled_datetime: "2026-08-15T13:30:00.000Z",
  status: "pending",
  exported_to_worklist: false,
  created_at: "2026-08-15T12:00:00.000Z",
  updated_at: "2026-08-15T12:00:00.000Z",
};

describe("DicomWorklistPage", () => {
  beforeEach(() => {
    mocks.list.mockResolvedValue([pendingItem]);
    mocks.cancel.mockResolvedValue(undefined);
  });

  it("não oferece Exportar para item pending", async () => {
    render(<DicomWorklistPage />);

    expect(await screen.findByText("Paciente Worklist QA")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /exportar/i })).not.toBeInTheDocument();
  });

  it("mostra estado de erro e permite tentar a listagem novamente", async () => {
    mocks.list
      .mockRejectedValueOnce(new Error("falha de leitura"))
      .mockResolvedValueOnce([pendingItem]);

    render(<DicomWorklistPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Erro ao carregar worklist");

    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(await screen.findByText("Paciente Worklist QA")).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("cancela item pending e recarrega a worklist", async () => {
    mocks.list
      .mockResolvedValueOnce([pendingItem])
      .mockResolvedValueOnce([]);

    render(<DicomWorklistPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(pendingItem.id));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Worklist vazia")).toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Item cancelado da worklist" });
  });
});
