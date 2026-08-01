import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LabResultForm } from "../LabResultForm";
import { resultado, valorReferencia } from "@/services/lisService";

const toast = vi.fn();

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("@/services/lisService", () => ({
  classificar: (value: number | null, minimum: number | null, maximum: number | null) => {
    if (value === null) return "INCONCLUSIVO";
    if (maximum !== null && value > maximum * 1.5) return "CRITICO_ALTO";
    if (minimum !== null && value < minimum * 0.5) return "CRITICO_BAIXO";
    return "NORMAL";
  },
  valorReferencia: {
    getByExame: vi.fn(),
  },
  resultado: {
    listarPorItem: vi.fn(),
    inserirLote: vi.fn(),
    liberarItem: vi.fn(),
  },
}));

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LabResultForm
        cdItemPedido={81}
        cdExame={31}
        userId="23000000-0000-4000-8000-000000000011"
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("LabResultForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(valorReferencia.getByExame).mockResolvedValue([
      {
        id: 91,
        company_id: "23000000-0000-4000-8000-000000000001",
        cd_exame: 31,
        ds_parametro: "Glicose",
        vl_minimo: 70,
        vl_maximo: 99,
        ds_unidade: "mg/dL",
        cd_sexo: "A",
        nr_idade_min: 0,
        nr_idade_max: 120,
        lg_ativo: true,
        created_at: "2026-07-27T00:00:00Z",
      },
    ]);
    vi.mocked(resultado.listarPorItem).mockResolvedValue([
      {
        id: 501,
        company_id: "23000000-0000-4000-8000-000000000001",
        cd_item_pedido: 81,
        cd_valor_referencia: 91,
        ds_parametro: "Glicose",
        vl_resultado: 90,
        vl_resultado_texto: null,
        ds_unidade: "mg/dL",
        vl_minimo_referencia: 70,
        vl_maximo_referencia: 99,
        tp_resultado: "NORMAL",
        dt_resultado: "2026-07-27T00:00:00Z",
        created_at: "2026-07-27T00:00:00Z",
      },
    ]);
    vi.mocked(resultado.liberarItem).mockResolvedValue();
  });

  it("preserva IDs canônicos e reutiliza a operação ao repetir o mesmo payload", async () => {
    vi.mocked(resultado.inserirLote)
      .mockRejectedValueOnce(new Error("timeout sintético"))
      .mockResolvedValueOnce([
        {
          id: 501,
          company_id: "23000000-0000-4000-8000-000000000001",
          cd_item_pedido: 81,
          cd_valor_referencia: 91,
          ds_parametro: "Glicose",
          vl_resultado: 200,
          vl_resultado_texto: null,
          ds_unidade: "mg/dL",
          vl_minimo_referencia: 70,
          vl_maximo_referencia: 99,
          tp_resultado: "CRITICO_ALTO",
          dt_resultado: "2026-07-27T00:00:00Z",
          created_at: "2026-07-27T00:00:00Z",
        },
      ]);

    renderForm();

    const valueInput = await screen.findByLabelText("Valor");
    await waitFor(() => expect(valueInput).toHaveValue(90));
    fireEvent.change(valueInput, { target: { value: "200" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar (não liberar)" }));
    await waitFor(() => expect(resultado.inserirLote).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Erro ao salvar" }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Salvar (não liberar)" }));
    await waitFor(() => expect(resultado.inserirLote).toHaveBeenCalledTimes(2));

    const firstCall = vi.mocked(resultado.inserirLote).mock.calls[0];
    const secondCall = vi.mocked(resultado.inserirLote).mock.calls[1];
    expect(firstCall[1][0]).toEqual(expect.objectContaining({
      id: 501,
      cd_valor_referencia: 91,
      ds_parametro: "Glicose",
      vl_resultado: 200,
    }));
    expect(firstCall[1][0]).not.toHaveProperty("tp_resultado");
    expect(firstCall[2]?.operationId).toBeTruthy();
    expect(secondCall[2]?.operationId).toBe(firstCall[2]?.operationId);
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Resultado salvo",
        description: "Valores críticos detectados. Alerta gerado automaticamente.",
      })),
    );
  });
});
