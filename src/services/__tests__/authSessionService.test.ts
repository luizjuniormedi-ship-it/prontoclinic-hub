import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: mocks.rpc,
    auth: { signOut: mocks.signOut },
  },
}));

import { authSessionService } from "@/services/authSessionService";

describe("authSessionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it("ativa contexto e sessão atomicamente sem trafegar tokens", async () => {
    const record = {
      session_id: "10000000-0000-0000-0000-000000000001",
      device_id: "20000000-0000-0000-0000-000000000002",
      idle_expires_at: "2026-07-16T23:00:00Z",
    };
    mocks.rpc.mockResolvedValueOnce({ data: record, error: null });

    await expect(authSessionService.activate({
      membershipId: "40000000-0000-0000-0000-000000000004",
      roleId: 3,
      clientDeviceId: "30000000-0000-0000-0000-000000000003",
      unitId: 7,
      displayName: "Chrome no consultório",
      platform: "Linux",
      userAgent: "test-agent",
    })).resolves.toEqual(record);

    expect(mocks.rpc).toHaveBeenCalledWith("activate_application_context", {
      p_membership_id: "40000000-0000-0000-0000-000000000004",
      p_role_id: 3,
      p_client_device_id: "30000000-0000-0000-0000-000000000003",
      p_unit_id: 7,
      p_display_name: "Chrome no consultório",
      p_platform: "Linux",
      p_user_agent: "test-agent",
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toMatch(/refresh_token|access_token/i);
  });

  it("falha fechado quando o backend não confirma a sessão", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "revogada" } });

    await expect(authSessionService.isAllowed(
      "10000000-0000-0000-0000-000000000001",
      "30000000-0000-0000-0000-000000000003",
    )).resolves.toBe(false);
  });

  it("revoga o contexto do dispositivo sem fingir revogação individual do GoTrue", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });

    await expect(authSessionService.revokeDevice(
      "20000000-0000-0000-0000-000000000002",
      "dispositivo perdido",
    )).resolves.toEqual({
      appContextRevoked: true,
      gotrueRevocation: "requires_edge_function_admin_api",
    });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("faz logout local com o escopo oficial do Supabase", async () => {
    await authSessionService.logoutLocal("10000000-0000-0000-0000-000000000001");

    expect(mocks.rpc).toHaveBeenCalledWith("revoke_application_session", {
      p_session_id: "10000000-0000-0000-0000-000000000001",
      p_reason: "local_logout",
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("faz logout global e revoga todos os contextos da aplicação", async () => {
    await authSessionService.logoutGlobal();

    expect(mocks.rpc).toHaveBeenCalledWith("revoke_all_application_sessions", {
      p_reason: "global_logout",
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" });
  });
});
