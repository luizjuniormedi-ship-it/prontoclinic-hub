/**
 * userProfilesService — Gestão de usuários do sistema
 *
 * Substitui adminMockData.ts (que retornava 10 usuários mock fixos).
 *
 * Por que existe: páginas Admin (Users, Profiles, Permissions) precisam
 * ler e atualizar os perfis reais dos usuários cadastrados no Supabase Auth.
 *
 * IMPORTANTE: Apenas admins podem listar/criar/atualizar usuários.
 * A gestão de permissões finais é feita via RLS + role_name em user_profiles.
 *
 * Tabelas:
 *   - auth.users (Supabase managed — leitura via admin API)
 *   - public.user_profiles (perfil estendido com role_id, company_id, etc)
 */

import { z } from "zod";
import { supabase } from "@/lib/supabase";

export const userProfileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().min(2, "Nome obrigatório").max(200),
  email: z.string().email(),
  role_id: z.number().int().positive().nullable().optional(),
  role_name: z.string().nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  primary_unit_id: z.number().int().positive().nullable().optional(),
  phone: z.string().nullable().optional(),
  cpf: z.string().nullable().optional(),
  lg_ativo: z.boolean().default(true),
});

export type UserProfileInput = z.infer<typeof userProfileSchema>;

export interface UserProfileWithEmail {
  id: string;
  email: string;
  full_name: string;
  role_id: number | null;
  role_name: string | null;
  company_id: string | null;
  primary_unit_id: number | null;
  phone: string | null;
  cpf: string | null;
  lg_ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface PermissionRole {
  id: number;
  name: string;
  description: string;
  is_system: boolean;
  company_id: string | null;
}

export interface InviteUserInput {
  email: string;
  full_name: string;
  role_name: string;
  phone?: string | null;
  cpf?: string | null;
  primary_unit_id?: number | null;
}

export const userProfilesService = {
  async getAll(filters?: { search?: string; lg_ativo?: boolean }): Promise<UserProfileWithEmail[]> {
    let q = supabase
      .from("user_profiles")
      .select("id, full_name, email, role_id, role_name, company_id, primary_unit_id, phone, cpf, lg_ativo, created_at, updated_at")
      .order("full_name");
    if (filters?.lg_ativo !== undefined) q = q.eq("lg_ativo", filters.lg_ativo);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao listar usuários: ${error.message}`);
    return (data ?? []).map((row: { id: string; full_name: string; email: string | null; role_id: number | null; role_name: string | null; company_id: string | null; primary_unit_id: number | null; phone: string | null; cpf: string | null; lg_ativo: boolean | null; created_at: string; updated_at: string }) => ({
      id: row.id,
      email: row.email ?? "",
      full_name: row.full_name,
      role_id: row.role_id,
      role_name: row.role_name,
      company_id: row.company_id,
      primary_unit_id: row.primary_unit_id,
      phone: row.phone,
      cpf: row.cpf,
      lg_ativo: row.lg_ativo ?? true,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  },

  async getById(id: string): Promise<UserProfileWithEmail | null> {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Erro: ${error.message}`);
    if (!data) return null;
    return {
      id: data.id,
      email: (data as Record<string, unknown>).email as string ?? "",
      full_name: (data as Record<string, unknown>).full_name as string,
      role_id: (data as Record<string, unknown>).role_id as number | null,
      role_name: (data as Record<string, unknown>).role_name as string | null ?? null,
      company_id: (data as Record<string, unknown>).company_id as string | null,
      primary_unit_id: (data as Record<string, unknown>).primary_unit_id as number | null,
      phone: (data as Record<string, unknown>).phone as string | null ?? null,
      cpf: (data as Record<string, unknown>).cpf as string | null ?? null,
      lg_ativo: (data as Record<string, unknown>).lg_ativo as boolean ?? true,
      created_at: (data as Record<string, unknown>).created_at as string,
      updated_at: (data as Record<string, unknown>).updated_at as string,
    };
  },

  async update(id: string, input: Partial<UserProfileInput>): Promise<UserProfileWithEmail> {
    const parsed = userProfileSchema.partial().parse(input);
    const { data, error } = await supabase
      .from("user_profiles")
      .update(parsed)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as UserProfileWithEmail;
  },

  async toggleAtivo(id: string, lg_ativo: boolean): Promise<UserProfileWithEmail> {
    return userProfilesService.update(id, { lg_ativo });
  },

  async requirePasswordChange(id: string): Promise<void> {
    const { error } = await supabase
      .from("auth_account_security")
      .upsert({ user_id: id, must_change_password: true }, { onConflict: "user_id" });
    if (error) throw new Error(`Erro ao exigir troca de senha: ${error.message}`);
  },

  async invite(input: InviteUserInput): Promise<{ user_id: string; company_id: string; role_name: string }> {
    const parsed = z.object({
      email: z.string().email(),
      full_name: z.string().min(2).max(200),
      role_name: z.string().min(1).max(80),
      phone: z.string().max(30).nullable().optional(),
      cpf: z.string().max(20).nullable().optional(),
      primary_unit_id: z.number().int().positive().nullable().optional(),
    }).parse(input);
    const { data, error } = await supabase.functions.invoke("admin-user-invite", { body: parsed });
    if (error) throw new Error(`Erro ao convidar usuário: ${error.message}`);
    if (!data?.user_id) throw new Error("Convite não retornou um usuário provisionado.");
    return data as { user_id: string; company_id: string; role_name: string };
  },

  /**
   * Lista perfis de permissão disponíveis, direto da tabela `roles`
   * (fonte real usada em user_profiles.role_name e role_permissions).
   */
  async getProfiles(): Promise<Array<{ id: string; name: string; description: string }>> {
    const { data, error } = await supabase
      .from("roles")
      .select("id, name, description")
      .order("id");
    if (error) throw new Error(`Erro ao listar perfis: ${error.message}`);
    const LABELS: Record<string, string> = {
      admin: "Administrador",
      medico: "Médico",
      recepcao: "Recepção",
      enfermagem: "Enfermagem",
      laboratorio: "Laboratório",
      financeiro: "Financeiro",
      farmacia: "Farmácia",
    };
    return (data ?? []).map((r: { id: number; name: string; description: string | null }) => ({
      id: r.name,
      name: LABELS[r.name] ?? r.name,
      description: r.description ?? "",
    }));
  },

  async getRoles(): Promise<PermissionRole[]> {
    const { data, error } = await supabase
      .from("roles")
      .select("id, name, description, is_system, company_id")
      .order("id");
    if (error) throw new Error(`Erro ao listar papéis: ${error.message}`);
    return (data ?? []) as PermissionRole[];
  },
};
