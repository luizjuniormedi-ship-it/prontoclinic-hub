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

export const userProfilesService = {
  async getAll(filters?: { search?: string; lg_ativo?: boolean }): Promise<UserProfileWithEmail[]> {
    let q = supabase
      .from("user_profiles")
      .select("id, full_name, role_id, company_id, primary_unit_id, lg_ativo, created_at, updated_at")
      .order("full_name");
    if (filters?.lg_ativo !== undefined) q = q.eq("lg_ativo", filters.lg_ativo);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao listar usuários: ${error.message}`);
    // Email não está em user_profiles — vem de auth.users (não acessível via client SDK)
    // Para admin, podemos usar a view auth.users ou uma coluna extra.
    // Por ora, retornamos com email placeholder se não houver join.
    return (data ?? []).map((row: { id: string; full_name: string; role_id: number | null; company_id: string | null; primary_unit_id: number | null; lg_ativo: boolean | null; created_at: string; updated_at: string }) => ({
      id: row.id,
      email: "", // preenchido se houver Edge Function ou join com auth.users
      full_name: row.full_name,
      role_id: row.role_id,
      role_name: null,
      company_id: row.company_id,
      primary_unit_id: row.primary_unit_id,
      phone: null,
      cpf: null,
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

  /**
   * Lista perfis de permissão disponíveis.
   * Em produção, viria de uma tabela permission_profiles com regras granulares.
   * Por ora, retorna lista estática baseada nos role_name comuns.
   */
  async getProfiles(): Promise<Array<{ id: string; name: string; description: string }>> {
    return [
      { id: "admin", name: "Administrador", description: "Acesso total ao sistema" },
      { id: "medico", name: "Médico", description: "Atendimento clínico e prescrição" },
      { id: "enfermeiro", name: "Enfermeiro", description: "Triagem, evolução e checagem" },
      { id: "farmaceutico", name: "Farmacêutico", description: "Dispensação e controle de estoque" },
      { id: "reception", name: "Recepção", description: "Agendamento e check-in" },
      { id: "financial", name: "Financeiro", description: "Faturamento e repasse" },
      { id: "lab_user", name: "Laboratório", description: "Coleta, análise e liberação" },
      { id: "imaging", name: "Imagem", description: "DICOM/PACS e laudos" },
    ];
  },
};