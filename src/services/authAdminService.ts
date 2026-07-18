import { supabase } from "@/lib/supabase";

interface InviteUserInput {
  email: string;
  fullName: string;
  companyId: string;
  roleId: number;
  primaryUnitId: number | null;
  redirectTo: string;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("auth-admin", { body });
  if (error || !data || (data as { error?: string }).error) {
    throw new Error("Não foi possível concluir a operação administrativa.");
  }
  return data as T;
}

export const authAdminService = {
  async inviteUser(input: InviteUserInput): Promise<{ userId: string }> {
    const result = await invoke<{ userId: string }>({ action: "invite-user", ...input });
    return { userId: result.userId };
  },

  async sendRecovery(userId: string, companyId: string, redirectTo: string): Promise<void> {
    await invoke<{ ok: true }>({ action: "send-recovery", userId, companyId, redirectTo });
  },

  async setActive(userId: string, companyId: string, active: boolean): Promise<void> {
    await invoke<{ ok: true }>({ action: "set-active", userId, companyId, active });
  },

  async logoutGlobal(): Promise<void> {
    await invoke<{ ok: true }>({ action: "logout-global" });
  },
};
