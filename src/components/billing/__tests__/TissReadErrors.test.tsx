import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TissLoteList } from "../TissLoteList";
import { TissStats } from "../TissStats";

const useQueryMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => useQueryMock(options),
}));

vi.mock("recharts", () => ({
  BarChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Legend: () => null,
  PieChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Pie: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Cell: () => null,
}));

describe("erros de leitura TISS", () => {
  const refetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useQueryMock.mockImplementation((options: { queryKey: string[] }) => {
      if (options.queryKey[0] === "insurance-companies") return { data: [] };
      return { data: undefined, isLoading: false, isError: true, refetch };
    });
  });

  it("exibe falha da lista e permite repetir apenas a leitura", () => {
    render(
      <TissLoteList
        companyId="company-1"
        mes={7}
        ano={2026}
        filterStatus="ALL"
        setFilterStatus={vi.fn()}
        filterConvenio="ALL"
        setFilterConvenio={vi.fn()}
        onSelectXml={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Nao foi possivel carregar as guias TISS");
    expect(screen.getByText("Guias indisponiveis no momento.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("exibe falha dos indicadores e permite repetir apenas a leitura", () => {
    render(<TissStats companyId="company-1" ano={2026} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Nao foi possivel carregar os indicadores TISS");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
