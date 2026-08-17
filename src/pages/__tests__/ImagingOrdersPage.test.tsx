import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ImagingOrdersPage from "@/pages/ImagingOrdersPage";

const mocks = vi.hoisted(() => ({
  listOrders: vi.fn(),
  listItems: vi.fn(),
  createItem: vi.fn(),
  releaseAppointment: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/services/dicomService", () => ({
  imagingOrdersService: { list: mocks.listOrders },
  imagingOrderItemsService: {
    listByOrder: mocks.listItems,
    create: mocks.createItem,
  },
  worklistQueueService: { releaseAppointment: mocks.releaseAppointment },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
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

const order = {
  id: "00000000-0000-4000-8000-000000000024",
  company_id: "00000000-0000-4000-8000-000000000001",
  unit_id: 1,
  patient_id: "501",
  patient_name: "Paciente Imagem QA",
  accession_number: "ACC-M24-001",
  priority: "normal",
  status: "agendado",
  appointment_id: 101,
  scheduling_id: "101",
  created_at: "2026-08-16T12:00:00.000Z",
  updated_at: "2026-08-16T12:00:00.000Z",
} as const;

const item = {
  id: "00000000-0000-4000-8000-000000000025",
  imaging_order_id: order.id,
  exam_name: "Radiografia de tórax",
  modality_type: "CR",
  contrast_required: false,
  status: "agendado",
  created_at: "2026-08-16T12:00:00.000Z",
  updated_at: "2026-08-16T12:00:00.000Z",
} as const;

function queryResult(data: unknown, error: unknown = null) {
  const result = Promise.resolve({ data, error });
  const query = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    limit: vi.fn(() => result),
  };
  return query;
}

describe("ImagingOrdersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listOrders.mockResolvedValue([]);
    mocks.listItems.mockResolvedValue([item]);
    mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    mocks.from.mockImplementation((table: string) => {
      if (table === "patients") return queryResult([{ id: "501", full_name: "Paciente Imagem QA" }]);
      return queryResult([{ id: "101", appointment_date: "2026-08-16", start_time: "14:00", status: "scheduled", professionals: { full_name: "Dra. Solicitante" } }]);
    });
  });

  it("exibe erro de listagem em vez de estado vazio silencioso", async () => {
    mocks.listOrders.mockRejectedValue(new Error("falha ao consultar pedidos"));

    render(<ImagingOrdersPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("falha ao consultar pedidos");
    expect(screen.queryByText("Nenhum pedido de exame")).not.toBeInTheDocument();
  });

  it("cria pedido e itens em uma única RPC com agendamento obrigatório", async () => {
    render(<ImagingOrdersPage />);
    fireEvent.click(await screen.findByRole("button", { name: /novo pedido/i }));

    await waitFor(() => expect(mocks.from).toHaveBeenCalledWith("patients"));
    let selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "501" } });

    await waitFor(() => expect(mocks.from).toHaveBeenCalledWith("appointments"));
    selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[1], { target: { value: "101" } });
    fireEvent.change(screen.getByPlaceholderText("Raio-X Tórax PA/Perfil"), { target: { value: "Radiografia de tórax" } });
    fireEvent.change(screen.getByPlaceholderText("CR_SALA1"), { target: { value: "CR_SALA1" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar Pedido" }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("m24_create_imaging_order_secure", {
      p_appointment_id: 101,
      p_clinical_indication: null,
      p_priority: "normal",
      p_idempotency_key: "appointment:101",
      p_items: [{
        exam_name: "Radiografia de tórax",
        modality_type: "CR",
        body_part: null,
        laterality: null,
        contrast_required: false,
        station_aetitle: "CR_SALA1",
      }],
    }));
    expect(mocks.createItem).not.toHaveBeenCalled();
  });

  it("mantém erro de detalhe explícito e não oferece liberação por item", async () => {
    mocks.listOrders.mockResolvedValue([order]);
    mocks.listItems.mockRejectedValue(new Error("falha ao consultar itens"));

    render(<ImagingOrdersPage />);
    fireEvent.click(await screen.findByRole("button", { name: /detalhes/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("falha ao consultar itens");
    expect(screen.queryByText("Nenhum exame neste pedido")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "WL" })).not.toBeInTheDocument();
  });

  it("cancela o pedido por uma única RPC com motivo obrigatório", async () => {
    mocks.listOrders.mockResolvedValue([order]);

    render(<ImagingOrdersPage />);
    fireEvent.click(await screen.findByRole("button", { name: /detalhes/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar Pedido" }));
    fireEvent.change(screen.getByLabelText("Motivo *"), { target: { value: "Paciente desistiu do exame" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("m24_cancel_imaging_order_secure", {
      p_order_id: order.id,
      p_reason: "Paciente desistiu do exame",
    }));
  });
});
