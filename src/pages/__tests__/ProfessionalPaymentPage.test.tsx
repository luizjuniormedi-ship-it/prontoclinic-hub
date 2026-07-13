import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProfessionalPaymentPage from "@/pages/ProfessionalPaymentPage";
import type { ProfessionalPayment } from "@/services/professionalPaymentsService";

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  transition: vi.fn(),
  createIntentKey: vi.fn(),
  unitsGetAll: vi.fn(),
  toast: vi.fn(),
  debouncedSearch: undefined as string | undefined,
}));

vi.mock("@/services/professionalPaymentsService", () => ({
  professionalPaymentsService: {
    list: mocks.list,
    transition: mocks.transition,
  },
  createProfessionalPaymentIntentKey: mocks.createIntentKey,
  todayInSaoPaulo: () => "2026-07-13",
}));

vi.mock("@/services/catalogService", () => ({
  unitsService: {
    getAll: mocks.unitsGetAll,
  },
}));

vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: <T,>(value: T) => (mocks.debouncedSearch ?? value) as T,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const basePayment: ProfessionalPayment = {
  id: 1,
  companyId: "11111111-1111-4111-8111-111111111111",
  professionalId: 10,
  professionalName: "Dra. Apurada",
  unitId: 2,
  unitName: "Centro",
  referenceDate: "2026-07-01",
  referenceDescription: "Julho",
  totalProcedures: 5,
  totalValue: 500,
  totalReceived: 500,
  remunerationType: "PERCENTAGE",
  percentage: 30,
  status: "apurado",
  paidOn: null,
  observation: null,
  cancelReason: null,
  createdBy: "22222222-2222-4222-8222-222222222222",
  updatedBy: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-07-13T12:00:00Z",
  updatedAt: "2026-07-13T12:00:00Z",
  totalCount: 4,
  idempotentReplay: null,
};

const payments: ProfessionalPayment[] = [
  basePayment,
  { ...basePayment, id: 2, professionalId: 11, professionalName: "Dr. Conferido", status: "conferido" },
  { ...basePayment, id: 3, professionalId: 12, professionalName: "Dra. Paga", status: "pago" },
  { ...basePayment, id: 4, professionalId: 13, professionalName: "Dr. Cancelado", status: "cancelado" },
];

function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`Linha nao encontrada para ${name}`);
  return row;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("ProfessionalPaymentPage secure actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockReset();
    mocks.transition.mockReset();
    mocks.createIntentKey.mockReset();
    mocks.unitsGetAll.mockReset();
    mocks.toast.mockReset();
    mocks.debouncedSearch = undefined;
    mocks.list.mockResolvedValue(payments);
    mocks.unitsGetAll.mockResolvedValue([
      { id: "2", name: "Centro" },
      { id: "99", name: "Unidade Remota" },
    ]);
    mocks.createIntentKey
      .mockReturnValueOnce("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .mockReturnValueOnce("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
      .mockReturnValue("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  });

  it("mostra erro de leitura e permite repetir sem criar dados", async () => {
    mocks.list
      .mockRejectedValueOnce(new Error("RPC de listagem indisponivel"))
      .mockResolvedValueOnce(payments);

    render(<ProfessionalPaymentPage />);

    expect(await screen.findByText("RPC de listagem indisponivel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(await screen.findByText("Dra. Apurada")).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.list).toHaveBeenLastCalledWith({ limit: 25, offset: 0 });
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it("busca globalmente a partir da pagina 2 e reinicia a paginacao na RPC", async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => ({
      ...basePayment,
      id: index + 1,
      professionalName: `Profissional ${index + 1}`,
      totalCount: 26,
    }));
    const secondPage = [{
      ...basePayment,
      id: 26,
      professionalName: "Profissional 26",
      totalCount: 26,
    }];
    const searchResult = [{
      ...basePayment,
      id: 77,
      professionalName: "Dra. Resultado Remoto",
      totalCount: 1,
    }];
    mocks.list.mockReset();
    mocks.list
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage)
      .mockResolvedValueOnce(searchResult);

    render(<ProfessionalPaymentPage />);
    await screen.findByText("Profissional 1");
    fireEvent.click(screen.getByRole("button", { name: "Proxima pagina" }));
    await screen.findByText("Profissional 26");

    fireEvent.change(screen.getByRole("textbox", { name: "Buscar repasses" }), {
      target: { value: "  Resultado Remoto  " },
    });

    expect(await screen.findByText("Dra. Resultado Remoto")).toBeInTheDocument();
    expect(mocks.list).toHaveBeenLastCalledWith({
      limit: 25,
      offset: 0,
      search: "Resultado Remoto",
    });
    expect(screen.getByText("1-1 de 1 repasses")).toBeInTheDocument();
  });

  it("carrega unidades autoritativas e envia unidade ausente da pagina atual ao servidor", async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => ({
      ...basePayment,
      id: index + 1,
      professionalName: `Profissional ${index + 1}`,
      totalCount: 26,
    }));
    const secondPage = [{
      ...basePayment,
      id: 26,
      professionalName: "Profissional 26",
      totalCount: 26,
    }];
    const remotePayment = {
      ...basePayment,
      id: 90,
      unitId: 99,
      unitName: "Unidade Remota",
      professionalName: "Dra. Unidade Remota",
      totalCount: 1,
    };
    mocks.list.mockReset();
    mocks.list
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage)
      .mockResolvedValueOnce([remotePayment]);

    render(<ProfessionalPaymentPage />);
    await screen.findByText("Profissional 1");
    expect(mocks.unitsGetAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Proxima pagina" }));
    await screen.findByText("Profissional 26");

    const unitFilter = screen.getByRole("combobox", { name: "Filtrar por unidade" });
    unitFilter.focus();
    fireEvent.keyDown(unitFilter, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Unidade Remota" }));

    expect(await screen.findByText("Dra. Unidade Remota")).toBeInTheDocument();
    expect(mocks.list).toHaveBeenLastCalledWith({ limit: 25, offset: 0, unitId: 99 });
  });

  it("reinicia a pagina antes de aplicar o status no servidor", async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => ({
      ...basePayment,
      id: index + 1,
      professionalName: `Profissional ${index + 1}`,
      totalCount: 26,
    }));
    const secondPage = [{
      ...basePayment,
      id: 26,
      professionalName: "Profissional 26",
      totalCount: 26,
    }];
    const paidResult = [{
      ...basePayment,
      id: 91,
      professionalName: "Dra. Paga Remota",
      status: "pago" as const,
      totalCount: 1,
    }];
    mocks.list.mockReset();
    mocks.list
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage)
      .mockResolvedValueOnce(paidResult);

    render(<ProfessionalPaymentPage />);
    await screen.findByText("Profissional 1");
    fireEvent.click(screen.getByRole("button", { name: "Proxima pagina" }));
    await screen.findByText("Profissional 26");

    const statusFilter = screen.getByRole("combobox", { name: "Filtrar por status" });
    statusFilter.focus();
    fireEvent.keyDown(statusFilter, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Pago" }));

    expect(await screen.findByText("Dra. Paga Remota")).toBeInTheDocument();
    expect(mocks.list).toHaveBeenLastCalledWith({ limit: 25, offset: 0, status: "pago" });
  });

  it("pagina pela contagem autoritativa e rotula totais como locais da pagina", async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => ({
      ...basePayment,
      id: index + 1,
      professionalId: index + 10,
      professionalName: `Profissional ${index + 1}`,
      totalCount: 26,
    }));
    const secondPage = [{
      ...basePayment,
      id: 26,
      professionalId: 35,
      professionalName: "Profissional 26",
      totalCount: 26,
    }];
    mocks.list.mockReset();
    mocks.list.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);

    render(<ProfessionalPaymentPage />);

    expect(await screen.findByText("Profissional 1")).toBeInTheDocument();
    expect(screen.getByText("Total pendente nesta pagina")).toBeInTheDocument();
    expect(screen.getByText("Total pago nesta pagina")).toBeInTheDocument();
    expect(screen.getByText("1-25 de 26 repasses")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Proxima pagina" }));

    expect(await screen.findByText("Profissional 26")).toBeInTheDocument();
    expect(screen.getByText("26-26 de 26 repasses")).toBeInTheDocument();
    expect(mocks.list).toHaveBeenNthCalledWith(1, { limit: 25, offset: 0 });
    expect(mocks.list).toHaveBeenNthCalledWith(2, { limit: 25, offset: 25 });
    expect(screen.getByRole("button", { name: "Proxima pagina" })).toBeDisabled();
  });

  it("oferece conferir apenas em apurado, pagar apenas em conferido e cancelamento nos dois", async () => {
    render(<ProfessionalPaymentPage />);
    await screen.findByText("Dra. Apurada");

    expect(within(rowFor("Dra. Apurada")).getByRole("button", { name: "Conferir" })).toBeEnabled();
    expect(within(rowFor("Dra. Apurada")).queryByRole("button", { name: "Pagar" })).not.toBeInTheDocument();
    expect(within(rowFor("Dra. Apurada")).getByRole("button", { name: "Cancelar" })).toBeEnabled();

    expect(within(rowFor("Dr. Conferido")).getByRole("button", { name: "Pagar" })).toBeEnabled();
    expect(within(rowFor("Dr. Conferido")).queryByRole("button", { name: "Conferir" })).not.toBeInTheDocument();
    expect(within(rowFor("Dr. Conferido")).getByRole("button", { name: "Cancelar" })).toBeEnabled();

    expect(within(rowFor("Dra. Paga")).queryAllByRole("button")).toHaveLength(0);
    expect(within(rowFor("Dr. Cancelado")).queryAllByRole("button")).toHaveLength(0);
  });

  it("paga somente depois da confirmacao explicita e impede duplo envio", async () => {
    const request = deferred<{
      id: number;
      status: "pago";
      paidOn: string;
      cancelReason: null;
      updatedBy: string;
      updatedAt: string;
      idempotentReplay: boolean;
    }>();
    const authoritativePayments = payments.map((payment) => payment.id === 2 ? {
      ...payment,
      status: "pago" as const,
      paidOn: "2026-07-13",
      updatedAt: "2026-07-13T13:00:01Z",
    } : payment);
    mocks.list.mockReset();
    mocks.list
      .mockResolvedValueOnce(payments)
      .mockResolvedValueOnce(authoritativePayments);
    mocks.transition.mockReturnValueOnce(request.promise);
    render(<ProfessionalPaymentPage />);

    fireEvent.click(within(rowFor(await screen.findByText("Dr. Conferido").then(() => "Dr. Conferido"))).getByRole("button", { name: "Pagar" }));
    expect(mocks.transition).not.toHaveBeenCalled();
    expect(screen.getByText(/Confirme explicitamente o pagamento/)).toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: "Confirmar pagamento" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(mocks.transition).toHaveBeenCalledTimes(1);
    expect(mocks.transition).toHaveBeenCalledWith(2, "pago", {
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      reason: null,
      paymentDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(screen.getByRole("button", { name: "Processando..." })).toBeDisabled();

    await act(async () => {
      request.resolve({
        id: 2,
        status: "pago",
        paidOn: "2026-07-13",
        cancelReason: null,
        updatedBy: "22222222-2222-4222-8222-222222222222",
        updatedAt: "2026-07-13T13:00:00Z",
        idempotentReplay: false,
      });
    });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: "Repasse pago" }));
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(within(rowFor("Dr. Conferido")).queryByRole("button", { name: "Pagar" })).not.toBeInTheDocument();
  });

  it("recarrega o estado autoritativo com o filtro mais recente apos a mutacao", async () => {
    const transitionRequest = deferred<{
      id: number;
      status: "pago";
      paidOn: string;
      cancelReason: null;
      updatedBy: string;
      updatedAt: string;
      idempotentReplay: boolean;
    }>();
    const latestFilterRows = [{
      ...basePayment,
      id: 88,
      professionalName: "Dra. Filtro Atual",
      status: "pago" as const,
      totalCount: 1,
    }];
    const pendingFilteredLoad = deferred<ProfessionalPayment[]>();
    mocks.list.mockReset();
    mocks.list
      .mockResolvedValueOnce(payments)
      .mockReturnValueOnce(pendingFilteredLoad.promise)
      .mockResolvedValueOnce(latestFilterRows);
    mocks.transition.mockReturnValueOnce(transitionRequest.promise);

    render(<ProfessionalPaymentPage />);
    await screen.findByText("Dr. Conferido");
    mocks.debouncedSearch = "";
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar repasses" }), {
      target: { value: "Filtro Atual" },
    });
    fireEvent.click(within(rowFor("Dr. Conferido")).getByRole("button", { name: "Pagar" }));
    mocks.debouncedSearch = "Filtro Atual";
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pagamento" }));

    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith({
      limit: 25,
      offset: 0,
      search: "Filtro Atual",
    }));

    await act(async () => {
      transitionRequest.resolve({
        id: 2,
        status: "pago",
        paidOn: "2026-07-13",
        cancelReason: null,
        updatedBy: "22222222-2222-4222-8222-222222222222",
        updatedAt: "2026-07-13T15:00:00Z",
        idempotentReplay: false,
      });
    });

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: "Repasse pago" }));
    await act(async () => {
      pendingFilteredLoad.resolve([{ ...basePayment, professionalName: "Resultado obsoleto" }]);
    });
    expect(mocks.list).toHaveBeenLastCalledWith({
      limit: 25,
      offset: 0,
      search: "Filtro Atual",
    });
    expect(await screen.findByText("Dra. Filtro Atual")).toBeInTheDocument();
    expect(screen.queryByText("Carregando repasses...")).not.toBeInTheDocument();
    expect(screen.queryByText("Resultado obsoleto")).not.toBeInTheDocument();
    expect(screen.queryByText("Dr. Conferido")).not.toBeInTheDocument();
  });

  it("ignora snapshot de replay e usa somente a recarga autoritativa durante retry", async () => {
    const staleReplay = {
      id: 2,
      status: "conferido" as const,
      paidOn: null,
      cancelReason: null,
      updatedBy: "22222222-2222-4222-8222-222222222222",
      updatedAt: "2026-07-13T12:30:00Z",
      idempotentReplay: true,
    };
    const authoritativePayments = payments.map((payment) => payment.id === 2 ? {
      ...payment,
      status: "pago" as const,
      paidOn: "2026-07-13",
      updatedAt: "2026-07-13T14:00:00Z",
    } : payment);
    mocks.list.mockReset();
    mocks.list
      .mockResolvedValueOnce(payments)
      .mockRejectedValueOnce(new Error("falha ao recarregar linha autoritativa"))
      .mockResolvedValueOnce(authoritativePayments);
    mocks.transition.mockResolvedValue(staleReplay);

    render(<ProfessionalPaymentPage />);
    await screen.findByText("Dr. Conferido");
    fireEvent.click(within(rowFor("Dr. Conferido")).getByRole("button", { name: "Pagar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pagamento" }));

    expect(await screen.findByText("falha ao recarregar linha autoritativa")).toBeInTheDocument();
    expect(rowFor("Dr. Conferido")).toHaveTextContent("Conferido");
    expect(rowFor("Dr. Conferido")).not.toHaveTextContent("Pago");

    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: "Repasse pago" }));
    expect(mocks.transition).toHaveBeenCalledTimes(2);
    expect(mocks.transition.mock.calls[0][2].idempotencyKey).toBe(
      mocks.transition.mock.calls[1][2].idempotencyKey,
    );
    expect(mocks.list).toHaveBeenCalledTimes(3);
    expect(within(rowFor("Dr. Conferido")).queryByRole("button", { name: "Pagar" })).not.toBeInTheDocument();
  });

  it("exige motivo ao cancelar e preserva a chave da intencao durante retry", async () => {
    mocks.transition
      .mockRejectedValueOnce(new Error("timeout apos commit"))
      .mockResolvedValueOnce({
        id: 1,
        status: "cancelado",
        paidOn: null,
        cancelReason: "Divergencia na producao",
        updatedBy: "22222222-2222-4222-8222-222222222222",
        updatedAt: "2026-07-13T14:00:00Z",
        idempotentReplay: true,
      });
    render(<ProfessionalPaymentPage />);

    await screen.findByText("Dra. Apurada");
    fireEvent.click(within(rowFor("Dra. Apurada")).getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(await screen.findByText("Informe o motivo do cancelamento.")).toBeInTheDocument();
    expect(mocks.transition).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), {
      target: { value: " Divergencia na producao " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(await screen.findByText("timeout apos commit")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(mocks.transition).toHaveBeenCalledTimes(2));
    expect(mocks.transition.mock.calls[0][2].idempotencyKey).toBe(
      mocks.transition.mock.calls[1][2].idempotencyKey,
    );
    expect(mocks.transition.mock.calls[1][2]).toMatchObject({
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      reason: "Divergencia na producao",
      paymentDate: null,
    });
  });
});

