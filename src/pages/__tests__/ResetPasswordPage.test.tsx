import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import { useAuth } from "@/hooks/useAuth";
import { updatePasswordAndLogout } from "@/services/authPasswordService";
import { authSessionService } from "@/services/authSessionService";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/services/authPasswordService", () => ({ updatePasswordAndLogout: vi.fn() }));
vi.mock("@/services/authSessionService", () => ({
  authSessionService: { logoutGlobal: vi.fn() },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: {} } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    mustChangePassword: false,
    passwordRecoveryAuthorized: false,
  } as never);
  vi.mocked(updatePasswordAndLogout).mockResolvedValue();
  vi.mocked(authSessionService.logoutGlobal).mockResolvedValue();
});

describe("ResetPasswordPage", () => {
  it("não confia em type=recovery ou location.state sem evento autenticado", () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/reset-password", search: "?type=recovery", state: { forced: true } }]}>
        <ResetPasswordPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/link de recuperação inválido ou expirado/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Nova Senha")).not.toBeInTheDocument();
  });

  it("libera a troca somente após PASSWORD_RECOVERY e revoga sessões da aplicação", async () => {
    vi.mocked(useAuth).mockReturnValue({
      mustChangePassword: false,
      passwordRecoveryAuthorized: true,
    } as never);

    render(
      <MemoryRouter initialEntries={["/reset-password"]}>
        <ResetPasswordPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Nova Senha"), { target: { value: "nova-senha-segura" } });
    fireEvent.change(screen.getByLabelText("Confirmar Senha"), { target: { value: "nova-senha-segura" } });
    fireEvent.click(screen.getByRole("button", { name: "Redefinir Senha" }));

    await waitFor(() => expect(updatePasswordAndLogout).toHaveBeenCalled());
    const revoke = vi.mocked(updatePasswordAndLogout).mock.calls[0][2];
    expect(revoke).toEqual(expect.any(Function));
    await revoke?.();
    expect(authSessionService.logoutGlobal).toHaveBeenCalledTimes(1);
  });
});
