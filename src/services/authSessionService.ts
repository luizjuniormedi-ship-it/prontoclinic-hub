import { supabase } from "@/lib/supabase";

type RpcError = { message: string } | null;

export interface RegisterApplicationSessionInput {
  membershipId: string;
  roleId: number;
  clientDeviceId: string;
  unitId: number | null;
  displayName?: string | null;
  platform?: string | null;
  userAgent?: string | null;
}

export interface ApplicationSessionRegistration {
  session_id: string;
  device_id: string;
  idle_expires_at: string;
  absolute_expires_at?: string;
}

export interface DeviceRevocationResult {
  appContextRevoked: true;
  /**
   * O browser não recebe refresh tokens de outras sessões do GoTrue e não pode
   * revogar uma sessão remota específica. Para isso, use uma Edge Function
   * autenticada que invoque a Admin API. A revogação abaixo bloqueia imediatamente
   * o contexto da aplicação (RPC/RLS), de forma fail-closed.
   */
  gotrueRevocation: "requires_edge_function_admin_api";
}

function throwIfError(error: RpcError): void {
  if (error) throw new Error(error.message);
}

async function signOutWithApplicationRevocation(
  rpcName: "revoke_application_session" | "revoke_all_application_sessions",
  rpcArgs: Record<string, unknown>,
  scope: "local" | "global",
): Promise<void> {
  const revocation = await supabase.rpc(rpcName, rpcArgs);
  const signOut = await supabase.auth.signOut({ scope });

  // O logout oficial ainda é tentado quando o registro auditável falha.
  throwIfError(signOut.error);
  throwIfError(revocation.error);
}

export const authSessionService = {
  async activate(input: RegisterApplicationSessionInput): Promise<ApplicationSessionRegistration> {
    const { data, error } = await supabase.rpc("activate_application_context", {
      p_membership_id: input.membershipId,
      p_role_id: input.roleId,
      p_client_device_id: input.clientDeviceId,
      p_unit_id: input.unitId,
      p_display_name: input.displayName ?? null,
      p_platform: input.platform ?? null,
      p_user_agent: input.userAgent ?? null,
    });
    throwIfError(error);
    if (!data || typeof data !== "object") {
      throw new Error("O backend não registrou a sessão da aplicação.");
    }
    return data as unknown as ApplicationSessionRegistration;
  },

  async heartbeat(sessionId: string, clientDeviceId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("heartbeat_application_session", {
      p_session_id: sessionId,
      p_client_device_id: clientDeviceId,
    });
    return !error && data === true;
  },

  async isAllowed(sessionId: string, clientDeviceId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("is_application_session_allowed", {
      p_session_id: sessionId,
      p_client_device_id: clientDeviceId,
    });
    return !error && data === true;
  },

  async listDevices(): Promise<unknown[]> {
    const { data, error } = await supabase.rpc("list_application_devices");
    throwIfError(error);
    return Array.isArray(data) ? data : [];
  },

  async revokeDevice(deviceId: string, reason: string): Promise<DeviceRevocationResult> {
    const { data, error } = await supabase.rpc("revoke_application_device", {
      p_device_id: deviceId,
      p_reason: reason,
    });
    throwIfError(error);
    if (data !== true) throw new Error("O dispositivo não foi revogado.");
    return {
      appContextRevoked: true,
      gotrueRevocation: "requires_edge_function_admin_api",
    };
  },

  async logoutLocal(sessionId: string): Promise<void> {
    await signOutWithApplicationRevocation(
      "revoke_application_session",
      { p_session_id: sessionId, p_reason: "local_logout" },
      "local",
    );
  },

  async logoutGlobal(): Promise<void> {
    await signOutWithApplicationRevocation(
      "revoke_all_application_sessions",
      { p_reason: "global_logout" },
      "global",
    );
  },
};
