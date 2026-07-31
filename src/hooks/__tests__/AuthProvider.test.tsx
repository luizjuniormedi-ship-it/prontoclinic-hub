import { act, render, screen, waitFor } from "@testing-library/react";
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
  const { activeUnitId, isAuthenticated, isLoading, mfaStep, mustChangePassword } = useAuth();
  return (
    <>
      <div>{isLoading ? "loading" : isAuthenticated ? "authenticated" : mustChangePassword ? "password-change" : mfaStep}</div>
      <div data-testid="active-unit">{activeUnitId ?? "none"}</div>
    </>
  );
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
  it("atualiza a unidade ativa quando o contexto autorizado muda", async () => {
    configureAuth("aal1");
    render(<AuthProvider><Probe /></AuthProvider>);

    expect(screen.getByTestId("active-unit")).toHaveTextContent("none");
    act(() => {
      window.dispatchEvent(new CustomEvent("prontomedic:access-context-changed", {
        detail: {
          membershipId: "membership-1",
          companyId: "10000000-0000-0000-0000-000000000001",
          companyName: "Empresa QA",
          roleId: 3,
          roleName: "recepcao",
          unitId: 91002,
          unitName: "Unidade B",
        },
      }));
    });

    await waitFor(() => expect(screen.getByTestId("active-unit")).toHaveTextContent("91002"));
  });

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

  it("deduplica a restauração concorrente da mesma sessão", async () => {
    const auth = configureAuth("aal2");
    let authListener: ((event: string, restored: Session | null) => void) | undefined;
    let resolveProfile: ((value: {
      data: {
        id: string;
        full_name: string;
        role_id: number;
        role_name: string;
        company_id: string;
        primary_unit_id: number;
        lg_ativo: boolean;
        must_change_password: boolean;
      };
      error: null;
    }) => void) | undefined;
    auth.onAuthStateChange = vi.fn((listener) => {
      authListener = listener as typeof authListener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    const pendingProfile = new Promise<{
      data: {
        id: string;
        full_name: string;
        role_id: number;
        role_name: string;
        company_id: string;
        primary_unit_id: number;
        lg_ativo: boolean;
        must_change_password: boolean;
      };
      error: null;
    }>((resolve) => {
      resolveProfile = resolve;
    });
    const maybeSingle = vi.fn()
      .mockReturnValueOnce(pendingProfile)
      .mockResolvedValueOnce({ data: { name: "recepcao" }, error: null });
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle,
    };
    vi.mocked(supabase.from).mockReturnValue(query as never);

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(1));
    act(() => authListener?.("INITIAL_SESSION", session));
    await act(async () => {
      resolveProfile?.({
        data: {
          id: session.user.id,
          full_name: "Usuário de teste",
          role_id: 3,
          role_name: "recepcao",
          company_id: "10000000-0000-0000-0000-000000000001",
          primary_unit_id: 1,
          lg_ativo: true,
          must_change_password: false,
        },
        error: null,
      });
      await pendingProfile;
    });

    await waitFor(() => expect(screen.getByText("authenticated")).toBeInTheDocument());
    const mfa = auth.mfa as {
      getAuthenticatorAssuranceLevel: ReturnType<typeof vi.fn>;
    };
    expect(mfa.getAuthenticatorAssuranceLevel).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledTimes(2);
  });
});
