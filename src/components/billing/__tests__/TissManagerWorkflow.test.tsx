import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TissManager } from "@/components/billing/TissManager";

const mocks = vi.hoisted(() => ({
  gerarFaturaMensal: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { company_id: "company-1" } }),
}));

vi.mock("@/services/tissService", () => ({
  tissService: {
    gerarFaturaMensal: mocks.gerarFaturaMensal,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.success,
    error: mocks.error,
  },
}));

vi.mock("@/components/billing/TissStats", () => ({
  TissStats: () => <div data-testid="tiss-stats" />,
}));

vi.mock("@/components/billing/TissLoteList", () => ({
  TissLoteList: () => <div data-testid="tiss-lote-list" />,
}));

vi.mock("@/components/billing/TissGuiaForm", () => ({
  TissGuiaForm: () => null,
}));

vi.mock("@/components/billing/TissXmlPreview", () => ({
  TissXmlPreview: () => null,
}));

describe("TissManager monthly generation", () => {
  beforeEach(() => {
    mocks.gerarFaturaMensal.mockReset();
    mocks.success.mockReset();
    mocks.error.mockReset();
    mocks.gerarFaturaMensal.mockResolvedValue({
      lote: 123,
      total_xmls: 2,
      vl_total: 150.5,
    });
  });

  it("exige confirmação explícita da competência", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <TissManager />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /gerar fatura do mes/i }));

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringMatching(/competência TISS \d{2}\/\d{4}/),
    );
    expect(mocks.gerarFaturaMensal).not.toHaveBeenCalled();
  });

  it("invalida guias, indicadores e distribuição após geração idempotente", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <QueryClientProvider client={queryClient}>
        <TissManager />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /gerar fatura do mes/i }));

    await waitFor(() => {
      expect(mocks.gerarFaturaMensal).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        "company-1",
      );
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tiss-xml"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tiss-stats"] });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["tiss-status-distribution"],
      });
    });
    expect(mocks.success).toHaveBeenCalled();
  });
});
