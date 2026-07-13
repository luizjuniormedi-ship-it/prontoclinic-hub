import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LabResultForm } from "@/components/lis/LabResultForm";

const mocks = vi.hoisted(() => ({
  getReferences: vi.fn(),
  listResults: vi.fn(),
  getItemStatus: vi.fn(),
  saveSecure: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/services/lisService", () => ({
  classificar: vi.fn(() => "NORMAL"),
  valorReferencia: { getByExame: mocks.getReferences },
  resultado: {
    listarPorItem: mocks.listResults,
    obterStatusItem: mocks.getItemStatus,
    salvarSeguro: mocks.saveSecure,
  },
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

function renderForm(onSaved = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <LabResultForm
        cdItemPedido={42}
        cdExame={7}
        userId="user-lab-1"
        onSaved={onSaved}
        onCancel={vi.fn()}
      />
    </QueryClientProvider>,
  );

  return onSaved;
}

describe("LabResultForm — salvamento seguro", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getReferences.mockResolvedValue([{
      id: 1,
      cd_exame: 7,
      ds_parametro: "Glicose",
      vl_minimo: 70,
      vl_maximo: 99,
      ds_unidade: "mg/dL",
      nr_idade_min: 0,
      nr_idade_max: 120,
      lg_ativo: true,
      created_at: "2026-01-01T00:00:00Z",
    }]);
    mocks.listResults.mockResolvedValue([]);
    mocks.getItemStatus.mockResolvedValue("COLETADO");
    mocks.saveSecure.mockResolvedValue({ success: true, item_status: "EM_ANALISE" });
  });

  it("envia o payload pela RPC encapsulada, com status esperado e idempotência", async () => {
    const onSaved = renderForm();

    fireEvent.change(await screen.findByLabelText("Valor"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar (não liberar)" }));

    await waitFor(() => expect(mocks.saveSecure).toHaveBeenCalledTimes(1));
    expect(mocks.saveSecure).toHaveBeenCalledWith({
      itemId: 42,
      results: [{
        ds_parametro: "Glicose",
        vl_resultado: 90,
        vl_resultado_texto: null,
        ds_unidade: "mg/dL",
        vl_minimo_referencia: 70,
        vl_maximo_referencia: 99,
        tp_resultado: "NORMAL",
        cd_equipamento: null,
        cd_lote_reagente: null,
        ds_observacao: null,
        ds_hl7_message: null,
      }],
      release: false,
      expectedStatus: "COLETADO",
      idempotencyKey: expect.any(String),
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("reutiliza a chave para uma nova tentativa do mesmo payload", async () => {
    mocks.saveSecure
      .mockRejectedValueOnce(new Error("Falha transitória"))
      .mockResolvedValueOnce({ success: true, item_status: "EM_ANALISE" });
    renderForm();

    fireEvent.change(await screen.findByLabelText("Valor"), { target: { value: "90" } });
    const saveButton = screen.getByRole("button", { name: "Salvar (não liberar)" });
    fireEvent.click(saveButton);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Erro ao salvar",
      variant: "destructive",
    })));

    fireEvent.click(saveButton);
    await waitFor(() => expect(mocks.saveSecure).toHaveBeenCalledTimes(2));

    const firstKey = mocks.saveSecure.mock.calls[0][0].idempotencyKey;
    const secondKey = mocks.saveSecure.mock.calls[1][0].idempotencyKey;
    expect(secondKey).toBe(firstKey);
  });

  it("exige salvar o item coletado antes de liberar", async () => {
    renderForm();
    expect(await screen.findByRole("button", { name: "Salvar e liberar" })).toBeDisabled();

    mocks.getItemStatus.mockResolvedValue("EM_ANALISE");
    renderForm();
    const releaseButtons = await screen.findAllByRole("button", { name: "Salvar e liberar" });
    expect(releaseButtons.at(-1)).toBeEnabled();
  });
});

