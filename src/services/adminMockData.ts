import { SystemUser, PermissionProfile, UserPermissionOverride, AdminAuditEntry } from "@/types/admin";

export const mockPermissionProfiles: PermissionProfile[] = [
  {
    id: "pf1", name: "Administrador", description: "Acesso total ao sistema", isSystem: true,
    permissions: {
      dashboard: ["view"], companies: ["view", "create", "edit", "deactivate"],
      patients: ["view", "create", "edit", "delete", "sensitive_data"],
      professionals: ["view", "create", "edit", "deactivate"],
      specialties: ["view", "create", "edit"],
      schedule: ["view", "create", "reschedule", "cancel", "squeeze_in", "block_slot", "override_interval"],
      callcenter: ["view", "pre_register", "create", "reschedule", "cancel", "confirm", "notes"],
      reception: ["checkin", "start", "change_status"],
      records: ["view", "create", "edit", "view_history", "attachments"],
      worklist: ["view", "create", "edit", "execute", "complete", "cancel", "send_pacs"],
      pacs: ["view", "view_status", "external_link", "link_report", "admin_integration"],
      billing_production: ["view", "create", "cancel", "view_reports"],
      financial: ["view", "create_billing", "register_payment", "cancel_billing", "view_reports", "config_professional_payment"],
      settings: ["view", "edit_clinical", "edit_financial", "edit_schedule_rules"],
      admin: ["create_user", "edit_user", "toggle_user", "create_profile", "edit_permissions"],
    },
    createdAt: "2026-01-01", updatedAt: "2026-01-01",
  },
  {
    id: "pf2", name: "Recepção", description: "Gestão de agenda e recepção de pacientes", isSystem: true,
    permissions: {
      dashboard: ["view"], patients: ["view", "create", "edit"],
      professionals: ["view"], schedule: ["view", "create", "reschedule", "cancel"],
      callcenter: ["view"], reception: ["checkin", "start", "change_status"],
      records: ["view"], financial: ["view"], settings: ["view"],
      admin: [], companies: [], specialties: ["view"], worklist: ["view"],
      pacs: ["view"], billing_production: ["view"],
    },
    createdAt: "2026-01-01", updatedAt: "2026-01-01",
  },
  {
    id: "pf3", name: "Médico", description: "Atendimento clínico e prontuário", isSystem: true,
    permissions: {
      dashboard: ["view"], patients: ["view", "sensitive_data"],
      professionals: ["view"], schedule: ["view"],
      records: ["view", "create", "edit", "view_history", "attachments"],
      worklist: ["view", "create"], pacs: ["view", "view_status", "external_link"],
      financial: ["view"], settings: ["view"],
      admin: [], companies: [], specialties: ["view"], callcenter: [],
      reception: [], billing_production: ["view"],
    },
    createdAt: "2026-01-01", updatedAt: "2026-01-01",
  },
  {
    id: "pf4", name: "Enfermagem", description: "Triagem e sinais vitais", isSystem: true,
    permissions: {
      dashboard: ["view"], patients: ["view"], professionals: ["view"],
      schedule: ["view"], reception: ["checkin", "change_status"],
      records: ["view", "create", "view_history"],
      financial: [], settings: ["view"], admin: [], companies: [],
      specialties: ["view"], callcenter: [], worklist: ["view"],
      pacs: ["view"], billing_production: [],
    },
    createdAt: "2026-01-01", updatedAt: "2026-01-01",
  },
  {
    id: "pf5", name: "Financeiro", description: "Faturamento e cobranças", isSystem: true,
    permissions: {
      dashboard: ["view"], patients: ["view"], professionals: ["view"],
      schedule: ["view"], financial: ["view", "create_billing", "register_payment", "cancel_billing", "view_reports"],
      billing_production: ["view", "create", "cancel", "view_reports"],
      settings: ["view", "edit_financial"], admin: [], companies: [],
      specialties: ["view"], callcenter: [], reception: [], records: [],
      worklist: [], pacs: [],
    },
    createdAt: "2026-01-01", updatedAt: "2026-01-01",
  },
  {
    id: "pf6", name: "Supervisor", description: "Supervisão operacional com acesso ampliado", isSystem: false,
    permissions: {
      dashboard: ["view"], companies: ["view"],
      patients: ["view", "create", "edit", "sensitive_data"],
      professionals: ["view", "create", "edit"], specialties: ["view", "create", "edit"],
      schedule: ["view", "create", "reschedule", "cancel", "squeeze_in", "override_interval"],
      callcenter: ["view", "pre_register", "create", "reschedule", "cancel", "confirm", "notes"],
      reception: ["checkin", "start", "change_status"],
      records: ["view", "view_history"],
      worklist: ["view", "create", "edit"], pacs: ["view", "view_status"],
      billing_production: ["view", "view_reports"],
      financial: ["view", "view_reports"],
      settings: ["view", "edit_clinical", "edit_schedule_rules"],
      admin: ["create_user", "edit_user", "toggle_user"],
    },
    createdAt: "2026-02-01", updatedAt: "2026-02-15",
  },
  {
    id: "pf7", name: "Terapias", description: "Profissionais de terapias e reabilitação", isSystem: false,
    permissions: {
      dashboard: ["view"], patients: ["view"], professionals: ["view"],
      schedule: ["view", "create"], records: ["view", "create", "view_history"],
      financial: ["view"], settings: ["view"], admin: [], companies: [],
      specialties: ["view"], callcenter: [], reception: [],
      worklist: [], pacs: [], billing_production: ["view"],
    },
    createdAt: "2026-02-01", updatedAt: "2026-02-01",
  },
  {
    id: "pf8", name: "Faturamento", description: "Faturamento de convênios e glosas", isSystem: false,
    permissions: {
      dashboard: ["view"], patients: ["view"], professionals: ["view"],
      schedule: ["view"],
      financial: ["view", "create_billing", "register_payment", "cancel_billing", "view_reports"],
      billing_production: ["view", "create", "cancel", "view_reports"],
      settings: ["view", "edit_financial"], admin: [], companies: [],
      specialties: ["view"], callcenter: [], reception: [], records: [],
      worklist: [], pacs: [],
    },
    createdAt: "2026-02-01", updatedAt: "2026-02-01",
  },
  {
    id: "pf9", name: "Call Center", description: "Operações de agendamento e confirmação", isSystem: false,
    permissions: {
      dashboard: ["view"], patients: ["view", "create"],
      schedule: ["view", "create", "reschedule", "cancel"],
      callcenter: ["view", "pre_register", "create", "reschedule", "cancel", "confirm", "notes"],
      professionals: ["view"], specialties: ["view"],
      admin: [], companies: [], reception: [], records: [],
      financial: [], settings: ["view"], worklist: [], pacs: [],
      billing_production: [],
    },
    createdAt: "2026-03-01", updatedAt: "2026-03-01",
  },
  {
    id: "pf10", name: "Imagem/Diagnóstico", description: "Worklist, execução de exames e PACS", isSystem: false,
    permissions: {
      dashboard: ["view"], patients: ["view"],
      worklist: ["view", "create", "edit", "execute", "complete", "cancel", "send_pacs"],
      pacs: ["view", "view_status", "external_link", "link_report", "admin_integration"],
      professionals: ["view"], specialties: ["view"],
      schedule: ["view"], admin: [], companies: [],
      callcenter: [], reception: [], records: ["view"],
      financial: [], settings: ["view"], billing_production: ["view"],
    },
    createdAt: "2026-03-01", updatedAt: "2026-03-01",
  },
];

export const mockSystemUsers: SystemUser[] = [
  { id: "su1", name: "Dr. Ricardo Mendes", email: "ricardo@prontomedic.com", login: "ricardo.mendes", phone: "(11) 99999-0001", cpf: "111.222.333-44", role: "Médico", companyId: "c1", companyName: "ProntoMedic", unit: "Unidade Centro", unitIds: ["u1", "u2"], status: "active", profileId: "pf1", profileName: "Administrador", linkedProfessionalId: "d1", linkedProfessionalName: "Dr. Ricardo Mendes", createdAt: "2026-01-01", updatedAt: "2026-03-01", createdBy: "Sistema" },
  { id: "su2", name: "Juliana Costa", email: "juliana@prontomedic.com", login: "juliana.costa", phone: "(11) 99999-1001", cpf: "222.333.444-01", role: "Recepcionista", companyId: "c1", companyName: "ProntoMedic", unit: "Unidade Centro", unitIds: ["u1"], status: "active", profileId: "pf2", profileName: "Recepção", createdAt: "2026-01-15", updatedAt: "2026-02-20" },
  { id: "su3", name: "Dra. Camila Ferreira", email: "camila@prontomedic.com", login: "camila.ferreira", phone: "(11) 99999-0002", cpf: "222.333.444-55", role: "Médica", companyId: "c1", companyName: "ProntoMedic", unit: "Unidade Centro", unitIds: ["u1"], status: "active", profileId: "pf3", profileName: "Médico", linkedProfessionalId: "d2", linkedProfessionalName: "Dra. Camila Ferreira", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { id: "su4", name: "Roberto Almeida", email: "roberto@prontomedic.com", login: "roberto.almeida", phone: "(11) 99999-2001", cpf: "333.444.555-01", role: "Enfermeiro", companyId: "c1", companyName: "ProntoMedic", unit: "Unidade Centro", unitIds: ["u1"], status: "active", profileId: "pf4", profileName: "Enfermagem", createdAt: "2026-01-20", updatedAt: "2026-02-10" },
  { id: "su5", name: "Fernanda Oliveira", email: "fernanda.fin@prontomedic.com", login: "fernanda.oliveira", phone: "(11) 99999-3001", cpf: "444.555.666-01", role: "Analista Financeiro", companyId: "c1", companyName: "ProntoMedic", unit: "Unidade Centro", unitIds: ["u1", "u2"], status: "active", profileId: "pf5", profileName: "Financeiro", createdAt: "2026-02-01", updatedAt: "2026-02-01" },
  { id: "su6", name: "Marcos Pereira", email: "marcos@prontomedic.com", login: "marcos.pereira", phone: "(11) 99999-4001", cpf: "555.666.777-01", role: "Supervisor", companyId: "c1", companyName: "ProntoMedic", unit: "Unidade Centro", unitIds: ["u1", "u2", "u3"], status: "active", profileId: "pf6", profileName: "Supervisor", createdAt: "2026-02-15", updatedAt: "2026-03-01" },
  { id: "su7", name: "Dra. Patrícia Lima", email: "patricia@prontomedic.com", login: "patricia.lima", phone: "(11) 99999-0004", cpf: "444.555.666-77", role: "Fisioterapeuta", companyId: "c1", companyName: "ProntoMedic", unit: "Unidade Centro", unitIds: ["u1"], status: "active", profileId: "pf7", profileName: "Terapias", linkedProfessionalId: "d4", linkedProfessionalName: "Dra. Patrícia Lima", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { id: "su8", name: "Carla Santos", email: "carla@prontomedic.com", login: "carla.santos", phone: "(11) 99999-5001", cpf: "666.777.888-01", role: "Recepcionista", companyId: "c1", companyName: "ProntoMedic", unit: "Unidade Sul", unitIds: ["u2"], status: "inactive", profileId: "pf2", profileName: "Recepção", notes: "Desligada em fevereiro/2026", createdAt: "2026-01-01", updatedAt: "2026-02-28" },
  { id: "su9", name: "Lucas Operador", email: "lucas@prontomedic.com", login: "lucas.operador", phone: "(11) 99999-6001", cpf: "777.888.999-01", role: "Operador de Call Center", companyId: "c1", companyName: "ProntoMedic", unit: "Unidade Centro", unitIds: ["u1", "u2"], status: "active", profileId: "pf9", profileName: "Call Center", createdAt: "2026-03-01", updatedAt: "2026-03-01" },
  { id: "su10", name: "Técnico Imagem", email: "tecnico@prontomedic.com", login: "tecnico.imagem", phone: "(11) 99999-7001", cpf: "888.999.000-01", role: "Técnico em Radiologia", companyId: "c2", companyName: "ProntoMedic Imagem", unit: "Centro de Imagem", unitIds: ["u3"], status: "active", profileId: "pf10", profileName: "Imagem/Diagnóstico", createdAt: "2026-03-01", updatedAt: "2026-03-01" },
];

export const mockUserOverrides: UserPermissionOverride[] = [
  {
    userId: "su2",
    grants: { schedule: ["squeeze_in"] },
    blocks: {},
  },
  {
    userId: "su4",
    grants: {},
    blocks: { records: ["edit"] },
  },
];

export const mockAdminAuditLogs: AdminAuditEntry[] = [
  { id: "aal1", userId: "su1", userName: "Dr. Ricardo Mendes", action: "create_user", entity: "SystemUser", entityId: "su2", details: { userName: "Juliana Costa", profile: "Recepção" }, createdAt: "2026-01-15T10:00:00" },
  { id: "aal2", userId: "su1", userName: "Dr. Ricardo Mendes", action: "create_profile", entity: "PermissionProfile", entityId: "pf6", details: { profileName: "Supervisor" }, createdAt: "2026-02-01T14:30:00" },
  { id: "aal3", userId: "su6", userName: "Marcos Pereira", action: "edit_user", entity: "SystemUser", entityId: "su8", details: { field: "status", from: "active", to: "inactive" }, createdAt: "2026-02-28T16:00:00" },
  { id: "aal4", userId: "su1", userName: "Dr. Ricardo Mendes", action: "change_permissions", entity: "UserOverride", entityId: "su2", details: { granted: "schedule.squeeze_in" }, createdAt: "2026-03-10T09:15:00" },
];
