import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "@/App";

vi.mock("@/pages/LoginPage", () => ({ default: () => null }));
vi.mock("@/pages/ForgotPasswordPage", () => ({ default: () => null }));
vi.mock("@/pages/ResetPasswordPage", () => ({ default: () => null }));
vi.mock("@/pages/MfaEnrollmentPage", () => ({ default: () => null }));
vi.mock("@/pages/PreCadastroPage", () => ({ default: () => null }));
vi.mock("@/pages/ConfirmarEmailPage", () => ({ default: () => null }));
vi.mock("@/pages/NpsSurveyPage", () => ({ default: () => null }));
vi.mock("@/pages/NotFound", () => ({ default: () => null }));

vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ProtectedRoute", () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useAuth", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useConfirm", () => ({
  ConfirmProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/toaster", () => ({
  Toaster: () => null,
}));

vi.mock("@/pages/ShortcutsHelp", () => ({
  ShortcutsHelp: () => null,
}));

vi.mock("@/pages/NursingTriagePage", () => ({
  default: () => <div data-testid="nursing-triage-route">Rota de Triagem</div>,
}));

vi.mock("@/pages/NursingQueuePage", () => ({
  default: () => <div data-testid="nursing-queue-route">Rota da Fila</div>,
}));

describe("rotas de Enfermagem", () => {
  it("resolve /nursing/queue para a pagina de fila, nao para Triagem", async () => {
    window.history.pushState({}, "", "/nursing/queue");

    render(<App />);

    expect(await screen.findByTestId("nursing-queue-route")).toBeInTheDocument();
    expect(screen.queryByTestId("nursing-triage-route")).not.toBeInTheDocument();
  });
});
