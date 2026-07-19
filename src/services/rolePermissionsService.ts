/**
 * rolePermissionsService — matriz de permissões perfil × módulo × ação.
 *
 * Lê e escreve na tabela public.role_permissions, criada durante a migração SIGH.
 * Cada linha representa o que um perfil (role) pode fazer em um módulo.
 */

import { supabase } from "@/lib/supabase";

export interface RolePermission {
  id: number;
  role_id: number;
  module: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
}

export type PermissionAction = "can_view" | "can_create" | "can_edit" | "can_delete" | "can_export";

export const rolePermissionsService = {
  async getAll(): Promise<RolePermission[]> {
    const { data, error } = await supabase
      .from("role_permissions")
      .select("id, role_id, module, can_view, can_create, can_edit, can_delete, can_export")
      .order("role_id")
      .order("module");
    if (error) throw new Error(`Erro ao carregar matriz: ${error.message}`);
    return (data ?? []) as RolePermission[];
  },

  async listModules(): Promise<string[]> {
    const { data, error } = await supabase
      .from("role_permissions")
      .select("module");
    if (error) throw new Error(`Erro ao listar modulos: ${error.message}`);
    const set = new Set<string>();
    for (const r of data ?? []) set.add((r as { module: string }).module);
    return Array.from(set).sort();
  },

  async updateAction(id: number, action: PermissionAction, value: boolean): Promise<void> {
    const { error } = await supabase
      .from("role_permissions")
      .update({ [action]: value })
      .eq("id", id);
    if (error) throw new Error(`Erro ao atualizar: ${error.message}`);
  },

  async upsert(row: Omit<RolePermission, "id"> & { id?: number }): Promise<RolePermission> {
    if (row.id) {
      const { data, error } = await supabase
        .from("role_permissions")
        .update({
          can_view: row.can_view,
          can_create: row.can_create,
          can_edit: row.can_edit,
          can_delete: row.can_delete,
          can_export: row.can_export,
        })
        .eq("id", row.id)
        .select()
        .single();
      if (error) throw new Error(`Erro: ${error.message}`);
      return data as RolePermission;
    }
    const { data, error } = await supabase
      .from("role_permissions")
      .insert({
        role_id: row.role_id,
        module: row.module,
        can_view: row.can_view,
        can_create: row.can_create,
        can_edit: row.can_edit,
        can_delete: row.can_delete,
        can_export: row.can_export,
      })
      .select()
      .single();
    if (error) throw new Error(`Erro: ${error.message}`);
    return data as RolePermission;
  },
};

export const MODULE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  pacientes: "Pacientes",
  agenda: "Agenda",
  recepcao: "Recepção",
  prontuario: "Prontuário",
  enfermagem: "Enfermagem",
  farmacia: "Farmácia",
  laboratorio: "Laboratório",
  dicom: "DICOM/PACS",
  faturamento: "Faturamento",
  financeiro: "Financeiro",
  internacao: "Internação",
  cirurgia: "Cirurgia",
  telemedicina: "Telemedicina",
  whatsapp: "WhatsApp",
  portal: "Portal do Paciente",
  bi: "BI/Relatórios",
  ia: "IA Clínica",
  auditoria: "Auditoria",
  admin: "Administração",
};

export const ACTION_LABELS: Record<PermissionAction, string> = {
  can_view: "Ver",
  can_create: "Criar",
  can_edit: "Editar",
  can_delete: "Excluir",
  can_export: "Exportar",
};
