import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TissXml } from "@/services/tissService";
import {
  formatTissCurrency,
  formatTissInteger,
  formatTissPercent,
} from "@/components/billing/tissDisplay";
import { TissLoteList } from "@/components/billing/TissLoteList";
import { TissStats } from "@/components/billing/TissStats";
import { TissXmlPreview } from "@/components/billing/TissXmlPreview";

const serviceMocks = vi.hoisted(() => ({
  getEstatisticas: vi.fn(),
  getInsuranceCompanies: vi.fn(),
  listFaturas: vi.fn(),
}));

vi.mock("@/services/tissService", () => ({
  tissService: {
    getEstatisticas: serviceMocks.getEstatisticas,
    listFaturas: serviceMocks.listFaturas,
  },
}));

vi.mock("@/services/insuranceService", () => ({
  insuranceCompanyService: {
    getAll: serviceMocks.getInsuranceCompanies,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("recharts", async () => {
  const React = await import("react");
  const passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Bar: passthrough,
    BarChart: ({ children, data }: { children?: ReactNode; data?: unknown }) => (
      <div data-testid="bar-chart">
        <span>{JSON.stringify(data)}</span>
        {children}
      </div>
    ),
    CartesianGrid: passthrough,
    Cell: passthrough,
    Legend: passthrough,
    Pie: ({ children, data }: { children?: ReactNode; data?: unknown }) => (
      <div data-testid="pie-chart">
        <span>{JSON.stringify(data)}</span>
        {children}
      </div>
    ),
    PieChart: passthrough,
    ResponsiveContainer: passthrough,
    Tooltip: passthrough,
    XAxis: passthrough,
    YAxis: passthrough,
  };
});

vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");
  const passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ children, open }: { children?: ReactNode; open: boolean }) => (
      open ? <div>{children}</div> : null
    ),
    DialogContent: passthrough,
    DialogDescription: passthrough,
    DialogFooter: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
  };
});

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Select: passthrough,
    SelectContent: passthrough,
    SelectItem: passthrough,
    SelectTrigger: passthrough,
    SelectValue: () => null,
  };
});

function renderWithQueryClient(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {node}
    </QueryClientProvider>,
  );
}

function rawTissXml(overrides: Record<string, unknown>): TissXml {
  return {
    id: 1,
    company_id: "company-1",
    ds_versao_tiss: "4.03.00",
    tp_ambiente: "HOMOLOGACAO",
    status: "PENDENTE",
    lg_deletado: false,
    created_at: "2026-07-26T12:00:00.000Z",
    updated_at: "2026-07-26T12:00:00.000Z",
    ...overrides,
  } as unknown as TissXml;
}

describe("TISS numeric display guards", () => {
  beforeEach(() => {
    serviceMocks.getEstatisticas.mockReset();
    serviceMocks.getInsuranceCompanies.mockReset();
    serviceMocks.listFaturas.mockReset();
    serviceMocks.getInsuranceCompanies.mockResolvedValue([]);
    serviceMocks.listFaturas.mockResolvedValue([]);
  });

  it("formata string decimal e recusa null, texto, NaN e infinito", () => {
    expect(formatTissCurrency("12.5")).toBe("R$ 12,50");
    expect(formatTissCurrency(null)).toBe("—");
    expect(formatTissCurrency("valor-inválido")).toBe("—");
    expect(formatTissCurrency(Number.NaN)).toBe("—");
    expect(formatTissInteger(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatTissPercent("8.2")).toBe("8.20%");
  });

  it("não renderiza NaN nos indicadores ou dados dos gráficos", async () => {
    serviceMocks.getEstatisticas.mockResolvedValue({
      total_guias: "3",
      total_enviado: "125.50",
      total_processado: null,
      total_liberado: null,
      total_glosado: "valor-inválido",
      total_pago: Number.NaN,
      taxa_glosa_percent: Number.POSITIVE_INFINITY,
      taxa_recebimento_percent: null,
      por_convenio: [{
        convenio: "Convênio QA",
        guias: "3",
        informado: "125.50",
        liberado: null,
        glosa: "valor-inválido",
        taxa_glosa: Number.NaN,
      }],
    });

    renderWithQueryClient(
      <TissStats companyId="company-1" ano={2026} />,
    );

    expect(await screen.findByText(/R\$\s*125,50/)).toBeInTheDocument();
    expect(screen.getByTestId("bar-chart")).toHaveTextContent(
      '"informado":125.5,"glosa":0,"liberado":0',
    );
    expect(document.body).not.toHaveTextContent("NaN");
    expect(document.body).not.toHaveTextContent("R$ NaN");
  });

  it("consulta guias anuais reais para montar a distribuição de status", async () => {
    serviceMocks.getEstatisticas.mockResolvedValue({
      total_guias: 3,
      total_enviado: 150,
      total_processado: 0,
      total_liberado: 0,
      total_glosado: 0,
      total_pago: 0,
      taxa_glosa_percent: 0,
      taxa_recebimento_percent: 0,
      por_convenio: [],
    });
    serviceMocks.listFaturas.mockResolvedValue([
      rawTissXml({ id: 1, status: "PENDENTE" }),
      rawTissXml({ id: 2, status: "PENDENTE" }),
      rawTissXml({ id: 3, status: "PROCESSADO" }),
    ]);

    renderWithQueryClient(<TissStats companyId="company-1" ano={2026} />);

    expect(await screen.findByTestId("pie-chart")).toHaveTextContent(
      '[{"name":"PENDENTE","value":2},{"name":"PROCESSADO","value":1}]',
    );
    expect(serviceMocks.listFaturas).toHaveBeenCalledWith("company-1", { ano: 2026 });
  });

  it("mostra erro explícito quando a consulta de indicadores falha", async () => {
    serviceMocks.getEstatisticas.mockRejectedValue({
      code: "42501",
      message: "Permissão canônica de faturamento obrigatória",
      details: "A operação exige faturamento.view",
    });

    renderWithQueryClient(
      <TissStats companyId="company-1" ano={2026} />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Permissão canônica de faturamento obrigatória",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A operação exige faturamento.view (código 42501)",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("Erro desconhecido");
    expect(screen.getByRole("button", { name: /tentar novamente/i })).toBeInTheDocument();
  });

  it("mostra estado vazio quando não existem indicadores no período", async () => {
    serviceMocks.getEstatisticas.mockResolvedValue({
      total_guias: 0,
      total_enviado: 0,
      total_processado: 0,
      total_liberado: 0,
      total_glosado: 0,
      total_pago: 0,
      taxa_glosa_percent: 0,
      taxa_recebimento_percent: 0,
      por_convenio: [],
    });

    renderWithQueryClient(
      <TissStats companyId="company-1" ano={2026} />,
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Nenhum indicador TISS disponível para 2026",
    );
  });

  it("não renderiza NaN nas linhas de guias com payload numérico inconsistente", async () => {
    serviceMocks.listFaturas.mockResolvedValue([
      rawTissXml({
        cd_lote: 91,
        ds_tipo_guia: "SP/SADT",
        vl_informado: "10.50",
        vl_liberado: null,
        vl_glosa: "valor-inválido",
      }),
    ]);

    renderWithQueryClient(
      <TissLoteList
        companyId="company-1"
        mes={7}
        ano={2026}
        filterStatus="ALL"
        setFilterStatus={vi.fn()}
        filterConvenio="ALL"
        setFilterConvenio={vi.fn()}
        onSelectXml={vi.fn()}
        onOpenGlosa={vi.fn()}
      />,
    );

    expect(await screen.findByText(/R\$\s*10,50/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /gateway não homologado/i })).toBeDisabled();
    expect(document.body).not.toHaveTextContent("NaN");
    expect(document.body).not.toHaveTextContent("R$ NaN");
  });

  it("não renderiza NaN no preview com string, null e valor inválido", () => {
    const xml = rawTissXml({
      ds_descricao: "Guia sintética",
      vl_informado: "99.90",
      vl_liberado: null,
      vl_glosa: "valor-inválido",
    });

    render(
      <TissXmlPreview
        xml={xml}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/R\$\s*99,90/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("NaN");
    expect(document.body).not.toHaveTextContent("R$ NaN");
  });
});
