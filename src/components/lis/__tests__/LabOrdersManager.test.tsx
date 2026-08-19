import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LabOrdersManager } from "@/components/lis/LabOrdersManager";

const serviceMocks = vi.hoisted(() => ({
  communicateAlert: vi.fn(),
  collectSpecimen: vi.fn(),
  createCatalogo: vi.fn(),
  getCatalogo: vi.fn(),
  getOrderDetail: vi.fn(),
  listAlerts: vi.fn(),
  listOrders: vi.fn(),
  toast: vi.fn(),
  updateOrderStatus: vi.fn(),
}));

vi.mock("@/services/lisService", () => ({
  LAB_CATEGORIAS: ["BIOQUIMICA"],
  LAB_MATERIAIS: ["SANGUE"],
  LAB_STATUS_OPTIONS: ["PENDENTE"],
  alerta: {
    comunicar: serviceMocks.communicateAlert,
    listarPendentes: serviceMocks.listAlerts,
  },
  catalogo: {
    create: serviceMocks.createCatalogo,
    getAll: serviceMocks.getCatalogo,
    update: vi.fn(),
  },
  pedido: {
    atualizarStatus: serviceMocks.updateOrderStatus,
    getById: serviceMocks.getOrderDetail,
    listar: serviceMocks.listOrders,
    marcarColetado: serviceMocks.collectSpecimen,
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    companyId: "company-1",
    user: { id: "user-1" },
  }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: serviceMocks.toast }),
}));

vi.mock("@/components/lis/CriticalAlertsBanner", () => ({
  CriticalAlertsBanner: () => null,
}));

vi.mock("@/components/lis/LabResultForm", () => ({
  LabResultForm: ({
    cdExame,
    cdItemPedido,
  }: {
    cdExame: number;
    cdItemPedido: number;
  }) => <div>{`resultado-${cdItemPedido}-${cdExame}`}</div>,
}));

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  return {
    Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
    SelectValue: () => null,
  };
});

vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  type TabsState = {
    onValueChange: (value: string) => void;
    value: string;
  };
  const TabsContext = React.createContext<TabsState | null>(null);
  const useTabs = () => {
    const context = React.useContext(TabsContext);
    if (!context) throw new Error("Tabs child rendered outside Tabs");
    return context;
  };

  return {
    Tabs: ({
      children,
      onValueChange,
      value,
    }: {
      children: ReactNode;
      onValueChange: (value: string) => void;
      value: string;
    }) => (
      <TabsContext.Provider value={{ onValueChange, value }}>
        <div>{children}</div>
      </TabsContext.Provider>
    ),
    TabsContent: ({ children, value }: { children: ReactNode; value: string }) => {
      const context = useTabs();
      return context.value === value ? <div>{children}</div> : null;
    },
    TabsList: ({ children }: { children: ReactNode }) => <div role="tablist">{children}</div>,
    TabsTrigger: ({ children, value }: { children: ReactNode; value: string }) => {
      const context = useTabs();
      return (
        <button
          aria-selected={context.value === value}
          onClick={() => context.onValueChange(value)}
          role="tab"
          type="button"
        >
          {children}
        </button>
      );
    },
  };
});

function renderManager() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LabOrdersManager />
    </QueryClientProvider>,
  );
}

describe("LabOrdersManager", () => {
  beforeEach(() => {
    serviceMocks.communicateAlert.mockReset();
    serviceMocks.collectSpecimen.mockReset();
    serviceMocks.createCatalogo.mockReset();
    serviceMocks.getCatalogo.mockReset();
    serviceMocks.getOrderDetail.mockReset();
    serviceMocks.listAlerts.mockReset();
    serviceMocks.listOrders.mockReset();
    serviceMocks.toast.mockReset();
    serviceMocks.updateOrderStatus.mockReset();
    serviceMocks.listAlerts.mockResolvedValue([]);
    serviceMocks.listOrders.mockResolvedValue([]);
    serviceMocks.collectSpecimen.mockResolvedValue(undefined);
  });

  it("renderiza valores DECIMAL em string sem acionar o Error Boundary", async () => {
    serviceMocks.getCatalogo.mockResolvedValue([
      {
        id: 1,
        company_id: "company-1",
        ds_exame: "Hemograma",
        ds_sigla: "HEM",
        nr_prazo_dias: "2",
        vl_particular: "42.50",
        vl_convenio: "31.25",
        lg_ativo: true,
        created_at: "2026-07-26T12:00:00.000Z",
        updated_at: "2026-07-26T12:00:00.000Z",
      },
      {
        id: 2,
        company_id: "company-1",
        ds_exame: "Glicemia",
        ds_sigla: "GLI",
        nr_prazo_dias: "1",
        vl_particular: "0.00",
        vl_convenio: null,
        lg_ativo: true,
        created_at: "2026-07-26T12:00:00.000Z",
        updated_at: "2026-07-26T12:00:00.000Z",
      },
    ]);

    renderManager();
    fireEvent.click(screen.getByRole("tab", { name: /catálogo/i }));

    expect(await screen.findByText("Hemograma")).toBeInTheDocument();
    expect(screen.getByText("Glicemia")).toBeInTheDocument();
    expect(screen.getByText(/42,50/)).toBeInTheDocument();
    expect(screen.getByText(/0,00/)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("exibe erro explícito e permite repetir a consulta do catálogo", async () => {
    serviceMocks.getCatalogo
      .mockRejectedValueOnce(new Error("Falha controlada do catálogo"))
      .mockResolvedValueOnce([]);

    renderManager();
    fireEvent.click(screen.getByRole("tab", { name: /catálogo/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Falha controlada do catálogo");

    fireEvent.click(screen.getByRole("button", { name: /tentar novamente/i }));
    await waitFor(() => expect(serviceMocks.getCatalogo).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Nenhum exame no catálogo")).toBeInTheDocument();
  });

  it("preserva o registro de resultado canônico sem oferecer COLETADO → EM_ANALISE", async () => {
    serviceMocks.getCatalogo.mockResolvedValue([]);
    serviceMocks.listOrders.mockResolvedValue([{
      id: 44,
      company_id: "company-1",
      cd_paciente: 10,
      cd_medico: 20,
      dt_pedido: "2026-07-26T12:00:00.000Z",
      cd_tipo_atendimento: "AMBULATORIAL",
      tp_prioridade: "ROTINA",
      tp_status: "COLETADO",
      created_at: "2026-07-26T12:00:00.000Z",
      paciente_nome: "Paciente QA",
      medico_nome: "Médico QA",
      itens_count: 1,
    }]);
    serviceMocks.getOrderDetail.mockResolvedValue({
      pedido: { id: 44 },
      itens: [{
        id: 77,
        cd_pedido: 44,
        cd_exame: 9,
        tp_status: "COLETADO",
        created_at: "2026-07-26T12:00:00.000Z",
        exame_nome: "Hemograma completo",
        exame_sigla: "HEM",
        resultados: [],
      }],
    });

    renderManager();
    expect(await screen.findByText("Paciente QA")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /analisar/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /resultados/i }));
    fireEvent.click(await screen.findByRole("button", { name: /ver itens/i }));

    expect(await screen.findByText("Hemograma completo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /inserir resultado/i }));

    expect(await screen.findByText("resultado-77-9")).toBeInTheDocument();
    expect(serviceMocks.getOrderDetail).toHaveBeenCalledWith(44);
  });

  it("informa falha operacional ao cancelar um pedido", async () => {
    serviceMocks.getCatalogo.mockResolvedValue([]);
    serviceMocks.updateOrderStatus.mockRejectedValue(
      new Error("Falha controlada ao cancelar"),
    );
    serviceMocks.listOrders.mockResolvedValue([{
      id: 46,
      company_id: "company-1",
      cd_paciente: 10,
      cd_medico: 20,
      dt_pedido: "2026-07-26T12:00:00.000Z",
      cd_tipo_atendimento: "AMBULATORIAL",
      tp_prioridade: "ROTINA",
      tp_status: "PENDENTE",
      created_at: "2026-07-26T12:00:00.000Z",
      paciente_nome: "Paciente Cancelamento QA",
      medico_nome: "Médico QA",
      itens_count: 1,
    }]);

    renderManager();
    fireEvent.click(
      await screen.findByRole("button", { name: /cancelar pedido 46/i }),
    );

    await waitFor(() =>
      expect(serviceMocks.toast).toHaveBeenCalledWith({
        title: "Erro ao cancelar pedido",
        description: "Falha controlada ao cancelar",
        variant: "destructive",
      }),
    );
  });

  it("informa falha operacional ao comunicar um alerta crítico", async () => {
    serviceMocks.getCatalogo.mockResolvedValue([]);
    serviceMocks.communicateAlert.mockRejectedValue(
      new Error("Falha controlada na comunicação"),
    );
    serviceMocks.listAlerts.mockResolvedValue([{
      id: 91,
      cd_resultado: 1,
      tp_alerta: "CRITICO_ALTO",
      ds_parametro: "Potássio",
      vl_resultado: 7.2,
      vl_referencia: "3,5 a 5,1",
      dt_alerta: "2026-07-26T12:00:00.000Z",
      paciente_nome: "Paciente Alerta QA",
    }]);

    renderManager();
    fireEvent.click(screen.getByRole("tab", { name: /alertas/i }));
    fireEvent.click(await screen.findByRole("button", { name: /comunicar/i }));

    await waitFor(() =>
      expect(serviceMocks.toast).toHaveBeenCalledWith({
        title: "Erro ao comunicar alerta",
        description: "Falha controlada na comunicação",
        variant: "destructive",
      }),
    );
  });

  it("registra a coleta por item somente depois de identificar a amostra", async () => {
    serviceMocks.getCatalogo.mockResolvedValue([]);
    serviceMocks.listOrders.mockResolvedValue([{
      id: 45,
      company_id: "company-1",
      cd_paciente: 10,
      cd_medico: 20,
      dt_pedido: "2026-07-26T12:00:00.000Z",
      cd_tipo_atendimento: "AMBULATORIAL",
      tp_prioridade: "ROTINA",
      tp_status: "PENDENTE",
      created_at: "2026-07-26T12:00:00.000Z",
      paciente_nome: "Paciente Coleta QA",
      medico_nome: "Médico QA",
      itens_count: 1,
    }]);
    serviceMocks.getOrderDetail.mockResolvedValue({
      pedido: { id: 45 },
      itens: [{
        id: 78,
        cd_pedido: 45,
        cd_exame: 10,
        tp_status: "PENDENTE",
        created_at: "2026-07-26T12:00:00.000Z",
        exame_nome: "Glicemia",
        exame_sigla: "GLI",
        resultados: [],
      }],
    });

    renderManager();
    fireEvent.click(screen.getByRole("tab", { name: /coleta/i }));
    fireEvent.click(await screen.findByRole("button", { name: /registrar amostras/i }));

    const sampleInput = await screen.findByLabelText(/identificador da amostra/i);
    const confirmButton = screen.getByRole("button", { name: /confirmar coleta/i });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(sampleInput, { target: { value: " AMOSTRA-78 " } });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    await waitFor(() =>
      expect(serviceMocks.collectSpecimen).toHaveBeenCalledWith(
        78,
        "AMOSTRA-78",
      ),
    );
  });

  it("impede preço inválido no catálogo antes de chamar a RPC", async () => {
    serviceMocks.getCatalogo.mockResolvedValue([]);

    renderManager();
    fireEvent.click(screen.getByRole("tab", { name: /catálogo/i }));
    fireEvent.click(await screen.findByRole("button", { name: /novo exame/i }));

    fireEvent.change(screen.getByLabelText(/sigla/i), { target: { value: "GLI" } });
    fireEvent.change(screen.getByLabelText(/^exame/i), { target: { value: "Glicemia" } });
    fireEvent.change(screen.getByLabelText(/valor particular/i), {
      target: { value: "-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /cadastrar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "maiores ou iguais a zero",
    );
    expect(serviceMocks.createCatalogo).not.toHaveBeenCalled();
  });
});
