/**
 * rolePermissionsService — matriz de permissões perfil × módulo × ação.
 *
 * Lê a tabela public.role_permissions e escreve apenas pela RPC administrativa AAL2.
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

  async upsert(row: Omit<RolePermission, "id"> & { id?: number }): Promise<RolePermission> {
    const { data, error } = await supabase.rpc("upsert_role_permission", {
      p_role_id: row.role_id,
      p_module: row.module,
      p_can_view: row.can_view,
      p_can_create: row.can_create,
      p_can_edit: row.can_edit,
      p_can_delete: row.can_delete,
      p_can_export: row.can_export,
    });
    if (error || !data) throw new Error("Não foi possível atualizar a permissão.");
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
