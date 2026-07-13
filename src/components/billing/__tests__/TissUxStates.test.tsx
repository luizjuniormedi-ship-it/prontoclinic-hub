import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TissGlosaList, TissGuiaForm } from "../TissGuiaForm";
import { TissManager } from "../TissManager";
import { TissStats } from "../TissStats";

const useQueryMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => useQueryMock(options),
}));

describe("estados de leitura TISS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mantem os indicadores em loading sem exibir zeros prematuros", () => {
    useQueryMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });

    render(<TissStats ano={2026} />);

    expect(screen.getByRole("status")).toHaveTextContent("Carregando indicadores TISS");
    expect(screen.queryByText("Registros TISS em 2026")).not.toBeInTheDocument();
    expect(screen.queryByText("R$ 0,00")).not.toBeInTheDocument();
  });

  it("exibe zero somente depois de confirmar indicadores vazios", () => {
    useQueryMock.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });

    render(<TissStats ano={2026} />);

    expect(screen.getByText("Registros TISS em 2026")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*0,00/)).toBeInTheDocument();
  });

  it("distingue loading de lista vazia de glosas", () => {
    useQueryMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    const { rerender } = render(<TissGlosaList />);

    expect(screen.getByText("Carregando...")).toBeInTheDocument();
    expect(screen.queryByText("Nenhuma glosa encontrada.")).not.toBeInTheDocument();

    useQueryMock.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    rerender(<TissGlosaList />);
    expect(screen.getByText("Nenhuma glosa encontrada.")).toBeInTheDocument();
  });

  it("exibe erro de glosas e repete apenas a consulta", () => {
    const refetch = vi.fn();
    useQueryMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });

    render(<TissGlosaList />);

    expect(screen.getByRole("alert")).toHaveTextContent("Nao foi possivel carregar as glosas TISS");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("renderiza uma glosa sem inferir que ela esta em aberto", () => {
    useQueryMock.mockReturnValue({
      data: [{
        id: 1,
        tiss_xml_id: 2,
        billing_id: null,
        denial_code: "7101",
        denial_reason: "Procedimento nao coberto",
        denial_amount: 12.5,
        denial_date: "2026-07-12",
        appeal_sent: false,
        appeal_date: null,
        appeal_protocol: null,
        appeal_status: "PENDENTE",
        procedure_code: null,
        executor_code: null,
        created_at: "2026-07-12T12:00:00Z",
        updated_at: "2026-07-12T12:00:00Z",
      }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<TissGlosaList />);

    expect(screen.getByText("7101")).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*12,50/)).toBeInTheDocument();
    expect(screen.getByText("PENDENTE")).toBeInTheDocument();
  });

  it("usa rotulo neutro para o conjunto de glosas", () => {
    useQueryMock.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });

    render(<TissManager />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Glosas" }), { button: 0, ctrlKey: false });

    expect(screen.getByText(/Todas as glosas\./)).toBeInTheDocument();
    expect(screen.queryByText(/Glosas em aberto/)).not.toBeInTheDocument();
  });

  it("distingue loading de protocolos vazios", () => {
    useQueryMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    const { rerender } = render(
      <TissGuiaForm protocolDialogOpen setProtocolDialogOpen={vi.fn()} />,
    );

    expect(screen.getByText("Carregando...")).toBeInTheDocument();
    expect(screen.queryByText("Nenhum protocolo encontrado.")).not.toBeInTheDocument();

    useQueryMock.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    rerender(<TissGuiaForm protocolDialogOpen setProtocolDialogOpen={vi.fn()} />);
    expect(screen.getByText("Nenhum protocolo encontrado.")).toBeInTheDocument();
  });

  it("exibe erro de protocolos e permite repetir a consulta", () => {
    const refetch = vi.fn();
    useQueryMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });

    render(<TissGuiaForm protocolDialogOpen setProtocolDialogOpen={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Nao foi possivel carregar os protocolos");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("renderiza somente metadados permitidos do protocolo", () => {
    useQueryMock.mockReturnValue({
      data: [{
        id: 10,
        insurance_company_id: 20,
        insurance_company_name: "Operadora Teste",
        tiss_version: "3.05.00",
        environment: "HOMOLOGACAO",
        active: true,
        last_test_at: null,
        last_test_status: null,
        created_at: "2026-07-12T12:00:00Z",
        updated_at: "2026-07-12T12:00:00Z",
      }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<TissGuiaForm protocolDialogOpen setProtocolDialogOpen={vi.fn()} />);

    expect(screen.getByText("Operadora Teste")).toBeInTheDocument();
    expect(screen.getByText("3.05.00")).toBeInTheDocument();
    expect(screen.getByText("HOMOLOGACAO")).toBeInTheDocument();
    expect(screen.getByText(/Endpoints, certificados e credenciais nao sao exibidos/)).toBeInTheDocument();
  });
});
