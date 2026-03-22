import { SystemUser, PermissionProfile, UserPermissionOverride, AdminAuditEntry } from "@/types/admin";

export const mockPermissionProfiles: PermissionProfile[] = [
  {
    id: "pf1", name: "Administrador", description: "Acesso total ao sistema", isSystem: true,
    permissions: {
      dashboard: ["view"],
      patients: ["view", "create", "edit", "delete", "sensitive_data"],
      professionals: ["view", "create", "edit", "deactivate"],
      schedule: ["view", "create", "reschedule", "cancel", "squeeze_in", "override_interval"],
      reception: ["checkin", "start", "change_status"],
      records: ["view", "create", "edit", "view_history", "attachments"],
      financial: ["view", "create_billing", "register_payment", "cancel_billing", "view_reports"],
      settings: ["view", "edit_clinical", "edit_financial", "edit_schedule_rules"],
      admin: ["create_user", "edit_user", "toggle_user", "create_profile", "edit_permissions"],
    },
    createdAt: "2026-01-01", updatedAt: "2026-01-01",
  },
  {
    id: "pf2", name: "Recepção", description: "Gestão de agenda e recepção de pacientes", isSystem: true,
    permissions: {
      dashboard: ["view"],
      patients: ["view", "create", "edit"],
      professionals: ["view"],
      schedule: ["view", "create", "reschedule", "cancel"],
      reception: ["checkin", "start", "change_status"],
      records: ["view"],
      financial: ["view"],
      settings: ["view"],
      admin: [],
    },
    createdAt: "2026-01-01", updatedAt: "2026-01-01",
  },
  {
    id: "pf3", name: "Médico", description: "Atendimento clínico e prontuário", isSystem: true,
    permissions: {
      dashboard: ["view"],
      patients: ["view", "sensitive_data"],
      professionals: ["view"],
      schedule: ["view"],
      reception: [],
      records: ["view", "create", "edit", "view_history", "attachments"],
      financial: ["view"],
      settings: ["view"],
      admin: [],
    },
    createdAt: "2026-01-01", updatedAt: "2026-01-01",
  },
  {
    id: "pf4", name: "Enfermagem", description: "Triagem e sinais vitais", isSystem: true,
    permissions: {
      dashboard: ["view"],
      patients: ["view"],
      professionals: ["view"],
      schedule: ["view"],
      reception: ["checkin", "change_status"],
      records: ["view", "create", "view_history"],
      financial: [],
      settings: ["view"],
      admin: [],
    },
    createdAt: "2026-01-01", updatedAt: "2026-01-01",
  },
  {
    id: "pf5", name: "Financeiro", description: "Faturamento e cobranças", isSystem: true,
    permissions: {
      dashboard: ["view"],
      patients: ["view"],
      professionals: ["view"],
      schedule: ["view"],
      reception: [],
      records: [],
      financial: ["view", "create_billing", "register_payment", "cancel_billing", "view_reports"],
      settings: ["view", "edit_financial"],
      admin: [],
    },
    createdAt: "2026-01-01", updatedAt: "2026-01-01",
  },
  {
    id: "pf6", name: "Supervisor", description: "Supervisão operacional com acesso ampliado", isSystem: false,
    permissions: {
      dashboard: ["view"],
      patients: ["view", "create", "edit", "sensitive_data"],
      professionals: ["view", "create", "edit"],
      schedule: ["view", "create", "reschedule", "cancel", "squeeze_in", "override_interval"],
      reception: ["checkin", "start", "change_status"],
      records: ["view", "view_history"],
      financial: ["view", "view_reports"],
      settings: ["view", "edit_clinical", "edit_schedule_rules"],
      admin: ["create_user", "edit_user", "toggle_user"],
    },
    createdAt: "2026-02-01", updatedAt: "2026-02-15",
  },
  {
    id: "pf7", name: "Terapias", description: "Profissionais de terapias e reabilitação", isSystem: false,
    permissions: {
      dashboard: ["view"],
      patients: ["view"],
      professionals: ["view"],
      schedule: ["view", "create"],
      reception: [],
      records: ["view", "create", "view_history"],
      financial: ["view"],
      settings: ["view"],
      admin: [],
    },
    createdAt: "2026-02-01", updatedAt: "2026-02-01",
  },
  {
    id: "pf8", name: "Faturamento", description: "Faturamento de convênios e glosas", isSystem: false,
    permissions: {
      dashboard: ["view"],
      patients: ["view"],
      professionals: ["view"],
      schedule: ["view"],
      reception: [],
      records: [],
      financial: ["view", "create_billing", "register_payment", "cancel_billing", "view_reports"],
      settings: ["view", "edit_financial"],
      admin: [],
    },
    createdAt: "2026-02-01", updatedAt: "2026-02-01",
  },
];

export const mockSystemUsers: SystemUser[] = [
  { id: "su1", name: "Dr. Ricardo Mendes", email: "ricardo@prontomedic.com", login: "ricardo.mendes", phone: "(11) 99999-0001", cpf: "111.222.333-44", role: "Médico", unit: "Unidade Centro", status: "active", profileId: "pf1", profileName: "Administrador", linkedProfessionalId: "d1", linkedProfessionalName: "Dr. Ricardo Mendes", createdAt: "2026-01-01", updatedAt: "2026-03-01", createdBy: "Sistema" },
  { id: "su2", name: "Juliana Costa", email: "juliana@prontomedic.com", login: "juliana.costa", phone: "(11) 99999-1001", cpf: "222.333.444-01", role: "Recepcionista", unit: "Unidade Centro", status: "active", profileId: "pf2", profileName: "Recepção", createdAt: "2026-01-15", updatedAt: "2026-02-20" },
  { id: "su3", name: "Dra. Camila Ferreira", email: "camila@prontomedic.com", login: "camila.ferreira", phone: "(11) 99999-0002", cpf: "222.333.444-55", role: "Médica", unit: "Unidade Centro", status: "active", profileId: "pf3", profileName: "Médico", linkedProfessionalId: "d2", linkedProfessionalName: "Dra. Camila Ferreira", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { id: "su4", name: "Roberto Almeida", email: "roberto@prontomedic.com", login: "roberto.almeida", phone: "(11) 99999-2001", cpf: "333.444.555-01", role: "Enfermeiro", unit: "Unidade Centro", status: "active", profileId: "pf4", profileName: "Enfermagem", createdAt: "2026-01-20", updatedAt: "2026-02-10" },
  { id: "su5", name: "Fernanda Oliveira", email: "fernanda.fin@prontomedic.com", login: "fernanda.oliveira", phone: "(11) 99999-3001", cpf: "444.555.666-01", role: "Analista Financeiro", unit: "Unidade Centro", status: "active", profileId: "pf5", profileName: "Financeiro", createdAt: "2026-02-01", updatedAt: "2026-02-01" },
  { id: "su6", name: "Marcos Pereira", email: "marcos@prontomedic.com", login: "marcos.pereira", phone: "(11) 99999-4001", cpf: "555.666.777-01", role: "Supervisor", unit: "Unidade Centro", status: "active", profileId: "pf6", profileName: "Supervisor", createdAt: "2026-02-15", updatedAt: "2026-03-01" },
  { id: "su7", name: "Dra. Patrícia Lima", email: "patricia@prontomedic.com", login: "patricia.lima", phone: "(11) 99999-0004", cpf: "444.555.666-77", role: "Fisioterapeuta", unit: "Unidade Centro", status: "active", profileId: "pf7", profileName: "Terapias", linkedProfessionalId: "d4", linkedProfessionalName: "Dra. Patrícia Lima", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { id: "su8", name: "Carla Santos", email: "carla@prontomedic.com", login: "carla.santos", phone: "(11) 99999-5001", cpf: "666.777.888-01", role: "Recepcionista", unit: "Unidade Sul", status: "inactive", profileId: "pf2", profileName: "Recepção", notes: "Desligada em fevereiro/2026", createdAt: "2026-01-01", updatedAt: "2026-02-28" },
];

export const mockUserOverrides: UserPermissionOverride[] = [
  {
    userId: "su2",
    grants: { schedule: ["squeeze_in"] }, // Juliana pode encaixar, mesmo recepção não tendo
    blocks: {},
  },
  {
    userId: "su4",
    grants: {},
    blocks: { records: ["edit"] }, // Roberto não pode editar prontuário, mesmo enfermagem tendo
  },
];

export const mockAdminAuditLogs: AdminAuditEntry[] = [
  { id: "aal1", userId: "su1", userName: "Dr. Ricardo Mendes", action: "create_user", entity: "SystemUser", entityId: "su2", details: { userName: "Juliana Costa", profile: "Recepção" }, createdAt: "2026-01-15T10:00:00" },
  { id: "aal2", userId: "su1", userName: "Dr. Ricardo Mendes", action: "create_profile", entity: "PermissionProfile", entityId: "pf6", details: { profileName: "Supervisor" }, createdAt: "2026-02-01T14:30:00" },
  { id: "aal3", userId: "su6", userName: "Marcos Pereira", action: "edit_user", entity: "SystemUser", entityId: "su8", details: { field: "status", from: "active", to: "inactive" }, createdAt: "2026-02-28T16:00:00" },
  { id: "aal4", userId: "su1", userName: "Dr. Ricardo Mendes", action: "change_permissions", entity: "UserOverride", entityId: "su2", details: { granted: "schedule.squeeze_in" }, createdAt: "2026-03-10T09:15:00" },
];
