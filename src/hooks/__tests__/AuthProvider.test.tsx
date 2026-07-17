import { render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { supabase } from "@/lib/supabase";
import { AuthProvider, useAuth } from "@/hooks/useAuth";

const session = {
  access_token: "access-token",
  refresh_token: "refresh-token",
  expires_in: 3600,
  token_type: "bearer",
  user: {
    id: "a0000000-0000-0000-0000-000000000001",
    email: "invalid@example.test",
    user_metadata: {},
  },
} as Session;

function Probe() {
  const { isAuthenticated, isLoading, mfaStep, mustChangePassword } = useAuth();
  return <div>{isLoading ? "loading" : isAuthenticated ? "authenticated" : mustChangePassword ? "password-change" : mfaStep}</div>;
}

function configureAuth(
  currentLevel: "aal1" | "aal2",
  factors: Array<{ id: string; status: string }> = [],
  restoredSession: Session = session,
) {
  const auth = supabase.auth as unknown as Record<string, unknown>;
  auth.getSession = vi.fn().mockResolvedValue({ data: { session: restoredSession } });
  auth.onAuthStateChange = vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  auth.signOut = vi.fn().mockResolvedValue({ error: null });
  auth.mfa = {
    getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
      data: { currentLevel, nextLevel: "aal2" }, error: null,
    }),
    listFactors: vi.fn().mockResolvedValue({ data: { totp: factors }, error: null }),
  };
  return auth;
}

describe("AuthProvider fail-closed restoration", () => {
  it("encerra a sessão restaurada quando não existe perfil autorizado", async () => {
    const auth = configureAuth("aal2");
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    vi.mocked(supabase.from).mockReturnValue(query as never);

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(screen.getByText("none")).toBeInTheDocument());
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("não materializa o perfil funcional enquanto a sessão estiver em AAL1", async () => {
    const auth = configureAuth("aal1", [{ id: "factor-1", status: "verified" }]);

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(screen.getByText("challenge")).toBeInTheDocument());
    expect(supabase.from).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("direciona sessão AAL1 sem fator verificado para enrollment", async () => {
    configureAuth("aal1");
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("enroll")).toBeInTheDocument());
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("confia somente na flag protegida do perfil para exigir troca de senha", async () => {
    configureAuth("aal2");
    const maybeSingle = vi.fn()
      .mockResolvedValueOnce({
        data: {
          id: session.user.id,
          full_name: "Usuário de teste",
          role_id: 3,
          role_name: "recepcao",
          company_id: "10000000-0000-0000-0000-000000000001",
          primary_unit_id: 1,
          lg_ativo: true,
          must_change_password: true,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { name: "recepcao" }, error: null });
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle,
    };
    vi.mocked(supabase.from).mockReturnValue(query as never);
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("password-change")).toBeInTheDocument());
    expect(supabase.from).toHaveBeenCalledWith("user_profiles");
  });
});
