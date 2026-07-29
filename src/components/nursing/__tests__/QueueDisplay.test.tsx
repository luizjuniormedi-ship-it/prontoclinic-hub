import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueueDisplay } from "@/components/nursing/QueueDisplay";

const mocks = vi.hoisted(() => ({
  getFilaAtiva: vi.fn(),
  getClassificacoes: vi.fn(),
  chamar: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/services/nursingService", () => ({
  nursingService: {
    fila: {
      getFilaAtiva: mocks.getFilaAtiva,
      chamar: mocks.chamar,
    },
    classificacao: {
      getAll: mocks.getClassificacoes,
    },
  },
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

describe("QueueDisplay", () => {
  beforeEach(() => {
    mocks.getFilaAtiva.mockResolvedValue([
      {
        id: 42,
        company_id: "company-nursing-qa",
        cd_paciente: 9,
        dt_chegada: "2026-07-27T03:00:00.000Z",
        cd_senha: "E042",
        cd_classificacao_id: 3,
        tp_status: "AGUARDANDO",
        ds_queixa_inicial: "Paciente sintético aguardando",
        created_at: "2026-07-27T03:00:00.000Z",
      },
    ]);
    mocks.getClassificacoes.mockResolvedValue([
      {
        id: 3,
        ds_classificacao: "AMARELO",
        cd_cor_hex: "#EAB308",
        nr_tempo_max_atendimento_min: 60,
        lg_ativo: true,
        created_at: "2026-07-27T03:00:00.000Z",
      },
    ]);
    mocks.chamar.mockResolvedValue(undefined);
  });

  it("exibe a fila e chama o proximo paciente sem acao de nova Triagem", async () => {
    render(<QueueDisplay companyId="company-nursing-qa" unitId={7} />);

    expect(await screen.findByRole("heading", { name: "Painel de Chamada" })).toBeInTheDocument();
    expect(screen.getByText("E042")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nova Triagem" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Chamar próxima" }));

    await waitFor(() => expect(mocks.chamar).toHaveBeenCalledWith(42));
    await waitFor(() => expect(mocks.getFilaAtiva).toHaveBeenCalledTimes(2));
    expect(mocks.getFilaAtiva).toHaveBeenCalledWith("company-nursing-qa", 7);
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Senha E042 chamada!" });
  });
});
