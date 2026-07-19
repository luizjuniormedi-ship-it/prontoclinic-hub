import { supabase } from "@/lib/supabase";

export interface UnitAccess {
  id: number;
  user_id: string;
  company_id: string;
  unit_id: number;
  valid_from: string;
  valid_until: string | null;
}

export interface UserPermissionOverride {
  id: number;
  user_id: string;
  company_id: string;
  permission_id: number;
  effect: "grant" | "deny";
  unit_id: number | null;
  sector_code: string | null;
  valid_from: string;
  valid_until: string | null;
  reason: string;
}

export interface Delegation {
  id: number;
  company_id: string;
  delegator_user_id: string;
  delegate_user_id: string;
  module: string;
  actions: string[];
  unit_id: number | null;
  starts_at: string;
  ends_at: string;
  approval_status: "pending" | "approved" | "rejected" | "revoked";
  reason: string;
}

export interface AccessExpiration {
  id: number;
  user_id: string;
  company_id: string;
  expires_at: string;
  revoked_at: string | null;
  reason: string;
}

export const accessControlService = {
  async listUnitAccess(userId: string): Promise<UnitAccess[]> {
    const { data, error } = await supabase.from("unit_access").select("*").eq("user_id", userId).order("unit_id");
    if (error) throw new Error("Erro ao carregar acessos de unidade: " + error.message);
    return (data ?? []) as UnitAccess[];
  },

  async grantUnitAccess(input: { user_id: string; company_id: string; unit_id: number; valid_until?: string | null }): Promise<UnitAccess> {
    const { data, error } = await supabase.from("unit_access").upsert(input, { onConflict: "user_id,unit_id" }).select().single();
    if (error) throw new Error("Erro ao conceder acesso de unidade: " + error.message);
    return data as UnitAccess;
  },

  async revokeUnitAccess(id: number): Promise<void> {
    const { error } = await supabase.from("unit_access").delete().eq("id", id);
    if (error) throw new Error("Erro ao revogar acesso de unidade: " + error.message);
  },

  async listOverrides(userId: string): Promise<UserPermissionOverride[]> {
    const { data, error } = await supabase.from("user_permissions").select("*").eq("user_id", userId).order("permission_id");
    if (error) throw new Error("Erro ao carregar exceções: " + error.message);
    return (data ?? []) as UserPermissionOverride[];
  },

  async saveOverride(input: Omit<UserPermissionOverride, "id"> & { id?: number }): Promise<UserPermissionOverride> {
    const { id, ...payload } = input;
    const query = id
      ? supabase.from("user_permissions").update(payload).eq("id", id)
      : supabase.from("user_permissions").insert(payload);
    const { data, error } = await query.select().single();
    if (error) throw new Error("Erro ao salvar exceção de permissão: " + error.message);
    return data as UserPermissionOverride;
  },

  async listDelegations(userId: string): Promise<Delegation[]> {
    const { data, error } = await supabase.from("delegations").select("*").or("delegator_user_id.eq." + userId + ",delegate_user_id.eq." + userId).order("starts_at", { ascending: false });
    if (error) throw new Error("Erro ao carregar delegações: " + error.message);
    return (data ?? []) as Delegation[];
  },

  async createDelegation(input: Omit<Delegation, "id">): Promise<Delegation> {
    const { data, error } = await supabase.from("delegations").insert(input).select().single();
    if (error) throw new Error("Erro ao criar delegação: " + error.message);
    return data as Delegation;
  },

  async updateDelegationStatus(id: number, approval_status: Delegation["approval_status"], approvedBy?: string): Promise<void> {
    const payload = approval_status === "approved" && approvedBy
      ? { approval_status, approved_by: approvedBy }
      : { approval_status };
    const { error } = await supabase.from("delegations").update(payload).eq("id", id);
    if (error) throw new Error("Erro ao atualizar delegação: " + error.message);
  },

  async listExpirations(userId: string): Promise<AccessExpiration[]> {
    const { data, error } = await supabase.from("access_expirations").select("*").eq("user_id", userId).order("expires_at");
    if (error) throw new Error("Erro ao carregar expirações: " + error.message);
    return (data ?? []) as AccessExpiration[];
  },

  async createExpiration(input: Omit<AccessExpiration, "id" | "revoked_at">): Promise<AccessExpiration> {
    const { data, error } = await supabase.from("access_expirations").insert(input).select().single();
    if (error) throw new Error("Erro ao criar expiração: " + error.message);
    return data as AccessExpiration;
  },

  async revokeExpiration(id: number): Promise<void> {
    const { error } = await supabase.from("access_expirations").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error("Erro ao revogar expiração: " + error.message);
  },
};
