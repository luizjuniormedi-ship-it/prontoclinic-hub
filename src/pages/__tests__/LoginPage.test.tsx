import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/pages/LoginPage";
import { useAuth } from "@/hooks/useAuth";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));

const login = vi.fn();
const verifyMfa = vi.fn();
const logout = vi.fn();

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({
    login,
    verifyMfa,
    logout,
    isAuthenticated: false,
  } as never);
});

describe("LoginPage MFA", () => {
  it("restaura o desafio TOTP depois de recarregar a sessão AAL1", async () => {
    vi.mocked(useAuth).mockReturnValue({
      login,
      verifyMfa,
      logout,
      isAuthenticated: false,
      session: { access_token: "restored" },
      mfaStep: "challenge",
      mustChangePassword: false,
    } as never);

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes><Route path="/login" element={<LoginPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/aplicativo autenticador/i)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Formulário de login" })).not.toBeInTheDocument();
  });

  it("solicita e verifica o TOTP real antes de navegar", async () => {
    login.mockResolvedValue({ success: true, next: "mfa-challenge" });
    verifyMfa.mockResolvedValue({ success: true, next: "authenticated" });

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>área autenticada</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "user@example.test" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "secret" } });
    fireEvent.submit(screen.getByRole("form", { name: "Formulário de login" }));

    await screen.findByText(/aplicativo autenticador/i);
    fireEvent.change(screen.getByLabelText("Código 2FA"), { target: { value: "123456" } });
    fireEvent.submit(screen.getByRole("form", { name: "Verificação em duas etapas" }));

    await waitFor(() => expect(verifyMfa).toHaveBeenCalledWith("123456"));
    expect(await screen.findByText("área autenticada")).toBeInTheDocument();
  });

  it("direciona usuário sem fator para o cadastro MFA", async () => {
    login.mockResolvedValue({ success: true, next: "mfa-enroll" });
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/mfa-enrollment" element={<div>cadastro MFA</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "user@example.test" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "secret" } });
    fireEvent.submit(screen.getByRole("form", { name: "Formulário de login" }));
    expect(await screen.findByText("cadastro MFA")).toBeInTheDocument();
  });
});
