import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import PreCadastroPage from "../PreCadastroPage";

const mocks = vi.hoisted(() => ({ success: null as null | ((result: { accepted: true }) => void), toast: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useMutation: (options: { onSuccess: typeof mocks.success }) => {
  mocks.success = options.onSuccess;
  return { mutate: vi.fn(), isPending: false };
} }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/services/preCadastroService", () => ({
  VERSAO_TERMO_PRE_CADASTRO: "QA",
  GENDER: ["M", "F", "O"],
  preCadastroService: { getTextoTermo: () => "Termo QA" },
}));

describe("PreCadastroPage delivery containment", () => {
  it("nao afirma entrega nem expoe token depois da aceitacao", () => {
    render(<MemoryRouter><PreCadastroPage /></MemoryRouter>);
    act(() => mocks.success!({ accepted: true }));
    expect(screen.getByRole("heading", { name: "Pré-cadastro registrado!" })).toBeVisible();
    expect(screen.getByText(/Se o endereço.*estiver apto/s)).toBeVisible();
    expect(screen.queryByText(/Enviamos um link/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[0-9a-f]{64}/i);
    expect(mocks.toast).toHaveBeenLastCalledWith({ title: "Solicitação de pré-cadastro recebida." });
    expect(screen.queryByRole("button", { name: /enviar pré-cadastro/i })).not.toBeInTheDocument();
  });
});
