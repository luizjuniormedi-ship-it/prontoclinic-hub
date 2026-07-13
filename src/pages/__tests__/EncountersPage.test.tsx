import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EncountersPage from "@/pages/EncountersPage";
import type { Encounter } from "@/services/encountersService";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/services/encountersService", () => ({
  ENC_STATUS_LABELS: {
    draft: "Rascunho",
    signed: "Assinado",
    legacy_locked: "Legado bloqueado",
  },
  encountersService: {
    list: mocks.list,
    get: mocks.get,
  },
}));

const signedEncounter: Encounter = {
  id: "record-20",
  company_id: "company-1",
  patient_id: 10,
  professional_id: 30,
  appointment_id: 40,
  encounter_type: "Consulta",
  status: "signed",
  priority: "normal",
  chief_complaint: "Cefaleia",
  summary: "Evolução estável",
  signed_by_name: "Dra. Ana",
  signed_at: "2026-07-13T12:00:00Z",
  started_at: "2026-07-13T10:00:00Z",
  finished_at: "2026-07-13T12:00:00Z",
  created_at: "2026-07-13T10:00:00Z",
  patient_name: "Maria Souza",
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("EncountersPage read-only flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([signedEncounter]);
    mocks.get.mockResolvedValue(signedEncounter);
  });

  it("exibe carregamento até a lista canônica responder", async () => {
    const request = deferred<Encounter[]>();
    mocks.list.mockReturnValueOnce(request.promise);

    render(<EncountersPage />);

    expect(screen.getByText("Carregando atendimentos...")).toBeInTheDocument();
    request.resolve([signedEncounter]);

    expect(await screen.findByText("Maria Souza")).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledWith({ status: undefined });
  });

  it("abre o detalhe consultando get e mostra somente os dados de leitura", async () => {
    render(<EncountersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir" }));

    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("record-20"));
    expect(await screen.findByText("Cefaleia")).toBeInTheDocument();
    expect(screen.getByText("Evolução estável")).toBeInTheDocument();
    expect(screen.getByText(/Registro assinado por Dra\. Ana/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Salvar|Assinar|Verificar/i })).not.toBeInTheDocument();
  });

  it("mostra estado de erro quando a lista falha", async () => {
    mocks.list.mockRejectedValueOnce(new Error("view indisponível"));

    render(<EncountersPage />);

    expect(await screen.findByText("view indisponível")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });

  it("mantém a lista e informa erro quando a abertura falha", async () => {
    mocks.get.mockRejectedValueOnce(new Error("leitura recusada"));
    render(<EncountersPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Abrir" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Erro ao abrir prontuário",
      description: "leitura recusada",
      variant: "destructive",
    }));
    expect(screen.getByText("Maria Souza")).toBeInTheDocument();
  });

  it("identifica legado bloqueado sem alegar assinatura digital", async () => {
    const legacyEncounter: Encounter = {
      ...signedEncounter,
      status: "legacy_locked",
      signed_by_name: null,
      signed_at: null,
    };
    mocks.list.mockResolvedValueOnce([legacyEncounter]);
    mocks.get.mockResolvedValueOnce(legacyEncounter);

    render(<EncountersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir" }));

    expect(await screen.findByText(
      "Registro legado bloqueado. Não há assinatura digital canônica associada.",
    )).toBeInTheDocument();
    expect(screen.queryByText(/Registro assinado/)).not.toBeInTheDocument();
  });
});

