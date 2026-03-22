export type SystemUserStatus = "active" | "inactive";

export interface SystemUser {
  id: string;
  name: string;
  email: string;
  login: string;
  phone: string;
  cpf: string;
  role: string; // cargo/função
  unit: string;
  status: SystemUserStatus;
  profileId: string;
  profileName: string;
  linkedProfessionalId?: string;
  linkedProfessionalName?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface PermissionAction {
  key: string;
  label: string;
}

export interface ModulePermissions {
  moduleKey: string;
  moduleLabel: string;
  actions: PermissionAction[];
}

export interface PermissionProfile {
  id: string;
  name: string;
  description: string;
  isSystem: boolean; // perfis de sistema não podem ser excluídos
  permissions: Record<string, string[]>; // moduleKey -> action keys[]
  createdAt: string;
  updatedAt: string;
}

export interface UserPermissionOverride {
  userId: string;
  grants: Record<string, string[]>; // moduleKey -> action keys granted beyond profile
  blocks: Record<string, string[]>; // moduleKey -> action keys blocked despite profile
}

export interface AdminAuditEntry {
  id: string;
  userId: string;
  userName: string;
  action: "create_user" | "edit_user" | "toggle_user_status" | "create_profile" | "edit_profile" | "change_permissions";
  entity: string;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

// Permission modules and actions definition
export const PERMISSION_MODULES: ModulePermissions[] = [
  {
    moduleKey: "dashboard",
    moduleLabel: "Dashboard",
    actions: [{ key: "view", label: "Visualizar" }],
  },
  {
    moduleKey: "patients",
    moduleLabel: "Pacientes",
    actions: [
      { key: "view", label: "Visualizar" },
      { key: "create", label: "Cadastrar" },
      { key: "edit", label: "Editar" },
      { key: "delete", label: "Excluir" },
      { key: "sensitive_data", label: "Dados sensíveis" },
    ],
  },
  {
    moduleKey: "professionals",
    moduleLabel: "Profissionais",
    actions: [
      { key: "view", label: "Visualizar" },
      { key: "create", label: "Cadastrar" },
      { key: "edit", label: "Editar" },
      { key: "deactivate", label: "Inativar" },
    ],
  },
  {
    moduleKey: "schedule",
    moduleLabel: "Agenda",
    actions: [
      { key: "view", label: "Visualizar" },
      { key: "create", label: "Agendar" },
      { key: "reschedule", label: "Remarcar" },
      { key: "cancel", label: "Cancelar" },
      { key: "squeeze_in", label: "Encaixar" },
      { key: "override_interval", label: "Liberar antes (30 dias)" },
    ],
  },
  {
    moduleKey: "reception",
    moduleLabel: "Recepção",
    actions: [
      { key: "checkin", label: "Check-in" },
      { key: "start", label: "Iniciar atendimento" },
      { key: "change_status", label: "Alterar status" },
    ],
  },
  {
    moduleKey: "records",
    moduleLabel: "Prontuário",
    actions: [
      { key: "view", label: "Visualizar" },
      { key: "create", label: "Criar registro" },
      { key: "edit", label: "Editar registro" },
      { key: "view_history", label: "Visualizar histórico" },
      { key: "attachments", label: "Anexar documentos" },
    ],
  },
  {
    moduleKey: "financial",
    moduleLabel: "Financeiro",
    actions: [
      { key: "view", label: "Visualizar" },
      { key: "create_billing", label: "Lançar cobrança" },
      { key: "register_payment", label: "Registrar pagamento" },
      { key: "cancel_billing", label: "Cancelar cobrança" },
      { key: "view_reports", label: "Visualizar relatórios" },
    ],
  },
  {
    moduleKey: "settings",
    moduleLabel: "Configurações",
    actions: [
      { key: "view", label: "Visualizar" },
      { key: "edit_clinical", label: "Editar parâmetros clínicos" },
      { key: "edit_financial", label: "Editar parâmetros financeiros" },
      { key: "edit_schedule_rules", label: "Editar regras da agenda" },
    ],
  },
  {
    moduleKey: "admin",
    moduleLabel: "Administrativo",
    actions: [
      { key: "create_user", label: "Cadastrar usuário" },
      { key: "edit_user", label: "Editar usuário" },
      { key: "toggle_user", label: "Ativar/inativar usuário" },
      { key: "create_profile", label: "Criar perfil" },
      { key: "edit_permissions", label: "Alterar permissões" },
    ],
  },
];

// All possible actions flat
export function getAllPermissionKeys(): { module: string; action: string }[] {
  return PERMISSION_MODULES.flatMap((m) =>
    m.actions.map((a) => ({ module: m.moduleKey, action: a.key }))
  );
}
