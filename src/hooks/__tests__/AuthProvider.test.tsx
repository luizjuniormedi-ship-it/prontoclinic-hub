import { act, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/lib/supabase";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { accessContextService, type AccessContextOption } from "@/services/accessContextService";

vi.mock("@/services/accessContextService", () => ({
  accessContextService: {
    listAuthorized: vi.fn(),
  },
}));

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
  const { activeCompanyId, activeUnitId, isAuthenticated, isLoading, mfaStep, mustChangePassword, user } = useAuth();
  return (
    <>
      <div>{isLoading ? "loading" : isAuthenticated ? "authenticated" : mustChangePassword ? "password-change" : mfaStep}</div>
      <div data-testid="active-unit">{activeUnitId ?? "none"}</div>
      <div data-testid="active-company">{activeCompanyId ?? "none"}</div>
      <div data-testid="profile-role">{user?.role_name ?? "none"}</div>
    </>
  );
}

function configureAuth(
  currentLevel: "aal1" | "aal2",
  factors: Array<{ id: string; status: string }> = [],
  restoredSession: Session = session,
) {
  vi.mocked(accessContextService.listAuthorized).mockResolvedValue([]);
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
  const authorizedContext: AccessContextOption = {
    membershipId: "membership-1",
    companyId: "10000000-0000-0000-0000-000000000001",
    companyName: "Empresa QA",
    roleId: 3,
    roleName: "recepcao",
    unitId: 91002,
    unitName: "Unidade B",
  };

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  function configureActiveIdentity(mustChangePassword = false) {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: session.user.id,
          full_name: "Usuário de teste",
          lg_ativo: true,
          must_change_password: mustChangePassword,
        },
        error: null,
      }),
    };
    vi.mocked(supabase.from).mockReturnValue(query as never);
    return query;
  }

  it("atualiza empresa, unidade e perfil quando o contexto autorizado muda", async () => {
    configureAuth("aal2");
    configureActiveIdentity();
    vi.mocked(accessContextService.listAuthorized).mockResolvedValue([authorizedContext]);
    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(screen.getByText("authenticated")).toBeInTheDocument());
    expect(screen.getByTestId("profile-role")).toHaveTextContent("none");
    act(() => {
      window.dispatchEvent(new CustomEvent("prontomedic:access-context-changed", {
        detail: authorizedContext,
      }));
    });

    await waitFor(() => expect(screen.getByTestId("active-unit")).toHaveTextContent("91002"));
    expect(screen.getByTestId("active-company")).toHaveTextContent(authorizedContext.companyId);
    expect(screen.getByTestId("profile-role")).toHaveTextContent("recepcao");
  });

  it("ignora contexto armazenado que não pertence à lista autorizada", async () => {
    window.sessionStorage.setItem("prontomedic-access-context", JSON.stringify({
      ...authorizedContext,
      membershipId: "membership-nao-autorizada",
      companyId: "20000000-0000-0000-0000-000000000002",
      roleId: 1,
      roleName: "admin",
    }));
    configureAuth("aal2");
    configureActiveIdentity();
    vi.mocked(accessContextService.listAuthorized).mockResolvedValue([authorizedContext]);

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(screen.getByText("authenticated")).toBeInTheDocument());
    expect(screen.getByTestId("active-company")).toHaveTextContent("none");
    expect(screen.getByTestId("active-unit")).toHaveTextContent("none");
    expect(screen.getByTestId("profile-role")).toHaveTextContent("none");
  });

  it("aceita IDs numéricos serializados como texto somente quando o vínculo é autorizado", async () => {
    window.sessionStorage.setItem("prontomedic-access-context", JSON.stringify({
      ...authorizedContext,
      roleId: String(authorizedContext.roleId),
      unitId: String(authorizedContext.unitId),
    }));
    configureAuth("aal2");
    configureActiveIdentity();
    vi.mocked(accessContextService.listAuthorized).mockResolvedValue([authorizedContext]);

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(screen.getByText("authenticated")).toBeInTheDocument());
    expect(screen.getByTestId("active-company")).toHaveTextContent(authorizedContext.companyId);
    expect(screen.getByTestId("active-unit")).toHaveTextContent(String(authorizedContext.unitId));
    expect(screen.getByTestId("profile-role")).toHaveTextContent("recepcao");
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

    await waitFor(() => expect(screen.getByTestId("profile-role")).toHaveTextContent("none"));
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
    configureActiveIdentity(true);
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
        lg_ativo: boolean;
        must_change_password: boolean;
      };
      error: null;
    }>((resolve) => {
      resolveProfile = resolve;
    });
    const maybeSingle = vi.fn().mockReturnValueOnce(pendingProfile);
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
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});
