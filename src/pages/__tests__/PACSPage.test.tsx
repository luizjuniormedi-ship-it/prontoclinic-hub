import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PACSPage from "@/pages/PACSPage";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  getByStudyInstanceUid: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/services/dicomService", () => ({
  examService: { list: mocks.list },
  reportService: { getByStudyInstanceUid: mocks.getByStudyInstanceUid },
}));

vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (value: string) => void; children: React.ReactNode }) => (
    <select value={value} onChange={(event) => onValueChange?.(event.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

const study = {
  id: 24,
  company_id: "00000000-0000-4000-8000-000000000001",
  cd_dicom_exame: "1.2.826.0.1.3680043.10.24",
  ds_patient_name: "Paciente Imagem QA",
  ds_modality: "CR",
  ds_ae_title: "CR_SALA1",
  ds_exame: "Radiografia de tórax",
  nr_images: 2,
  ds_status: "RECEIVED",
  created_at: "2026-08-16T12:00:00.000Z",
  updated_at: "2026-08-16T12:00:00.000Z",
} as const;

describe("PACSPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([]);
    mocks.getByStudyInstanceUid.mockResolvedValue(null);
  });

  it("exibe erro de listagem em vez de estado vazio silencioso", async () => {
    mocks.list.mockRejectedValue(new Error("falha ao consultar estudos PACS"));

    render(<PACSPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("falha ao consultar estudos PACS");
    expect(screen.queryByText("Nenhum estudo PACS encontrado")).not.toBeInTheDocument();
  });

  it("correlaciona o laudo pelo StudyInstanceUID e mantém falha explícita", async () => {
    mocks.list.mockResolvedValue([study]);
    mocks.getByStudyInstanceUid.mockRejectedValue(new Error("falha ao consultar laudo canônico"));

    render(<PACSPage />);
    fireEvent.click(await screen.findByRole("button", { name: /detalhes/i }));

    await waitFor(() => expect(mocks.getByStudyInstanceUid).toHaveBeenCalledWith(study.cd_dicom_exame));
    expect(await screen.findByRole("alert")).toHaveTextContent("falha ao consultar laudo canônico");
    expect(screen.queryByText("Nenhum laudo vinculado a este estudo.")).not.toBeInTheDocument();
  });
});
