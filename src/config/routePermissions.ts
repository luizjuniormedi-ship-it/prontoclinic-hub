// Central permission map — single source of truth for route-level RBAC.
// Role names are normalized to lowercase for matching.
// Backend/RLS policies remain authoritative; this map controls navigation and route gates.

export const ROLES = {
  ADMIN: "admin",
  RECEPCAO: "recepcao",
  MEDICO: "medico",
  FINANCEIRO: "financeiro",
  FATURAMENTO: "faturamento",
  CALL_CENTER: "call_center",
  DIAGNOSTICO: "diagnostico",
  GESTOR: "gestor",
  ADMINISTRATIVO: "administrativo",
  ENFERMAGEM: "enfermagem",
  LABORATORIO: "laboratorio",
  FARMACIA: "farmacia",
  DPO: "dpo",
  PACIENTE: "paciente",
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

const ROLE_ALIASES: Record<string, RoleName> = {
  administrador: ROLES.ADMIN,
  admin: ROLES.ADMIN,
  superadmin: ROLES.ADMIN,
  super_admin: ROLES.ADMIN,
  "recepção": ROLES.RECEPCAO,
  recepcao: ROLES.RECEPCAO,
  recepcionista: ROLES.RECEPCAO,
  "médico": ROLES.MEDICO,
  medico: ROLES.MEDICO,
  doutor: ROLES.MEDICO,
  financeiro: ROLES.FINANCEIRO,
  faturamento: ROLES.FATURAMENTO,
  faturista: ROLES.FATURAMENTO,
  billing: ROLES.FATURAMENTO,
  call_center: ROLES.CALL_CENTER,
  callcenter: ROLES.CALL_CENTER,
  "call center": ROLES.CALL_CENTER,
  teleatendimento: ROLES.CALL_CENTER,
  "diagnóstico": ROLES.DIAGNOSTICO,
  diagnostico: ROLES.DIAGNOSTICO,
  "técnico": ROLES.DIAGNOSTICO,
  tecnico: ROLES.DIAGNOSTICO,
  imagem: ROLES.DIAGNOSTICO,
  radiologia: ROLES.DIAGNOSTICO,
  gestor: ROLES.GESTOR,
  gerente: ROLES.GESTOR,
  administrativo: ROLES.ADMINISTRATIVO,
  enfermagem: ROLES.ENFERMAGEM,
  enfermeiro: ROLES.ENFERMAGEM,
  enfermeira: ROLES.ENFERMAGEM,
  "técnico de enfermagem": ROLES.ENFERMAGEM,
  "tecnico de enfermagem": ROLES.ENFERMAGEM,
  laboratorio: ROLES.LABORATORIO,
  "laboratório": ROLES.LABORATORIO,
  bioquimico: ROLES.LABORATORIO,
  "bioquímico": ROLES.LABORATORIO,
  farmacia: ROLES.FARMACIA,
  "farmácia": ROLES.FARMACIA,
  farmaceutico: ROLES.FARMACIA,
  "farmacêutico": ROLES.FARMACIA,
  dpo: ROLES.DPO,
  privacidade: ROLES.DPO,
  paciente: ROLES.PACIENTE,
  patient: ROLES.PACIENTE,
};

export function normalizeRoleName(dbRoleName: string | null | undefined): RoleName | null {
  if (!dbRoleName) return null;
  return ROLE_ALIASES[dbRoleName.trim().toLowerCase()] || null;
}

type PermissionEntry = "*" | RoleName[];

// More specific prefixes win because canAccessRoute sorts prefixes by length.
const routePermissionMap: Record<string, PermissionEntry> = {
  "/": "*",
  "/patients": [ROLES.ADMIN, ROLES.RECEPCAO, ROLES.CALL_CENTER, ROLES.MEDICO, ROLES.GESTOR],
  "/professionals": [ROLES.ADMIN, ROLES.GESTOR, ROLES.ADMINISTRATIVO],
  "/schedule": [ROLES.ADMIN, ROLES.RECEPCAO, ROLES.CALL_CENTER, ROLES.MEDICO, ROLES.GESTOR],
  "/callcenter": [ROLES.ADMIN, ROLES.RECEPCAO, ROLES.CALL_CENTER],
  "/reception": [ROLES.ADMIN, ROLES.RECEPCAO, ROLES.GESTOR],
  "/records": [ROLES.ADMIN, ROLES.MEDICO],
  "/encounters": [ROLES.ADMIN, ROLES.MEDICO],
  "/clinical-timeline": [ROLES.ADMIN, ROLES.MEDICO],
  "/attendance": [ROLES.ADMIN, ROLES.MEDICO],
  "/worklist": [ROLES.ADMIN, ROLES.DIAGNOSTICO, ROLES.LABORATORIO],
  "/pacs": [ROLES.ADMIN, ROLES.DIAGNOSTICO, ROLES.MEDICO],
  "/dicom/reports": [ROLES.ADMIN, ROLES.DIAGNOSTICO, ROLES.MEDICO, ROLES.GESTOR],
  "/dicom": [ROLES.ADMIN, ROLES.DIAGNOSTICO],
  "/financial": [ROLES.ADMIN, ROLES.FINANCEIRO, ROLES.GESTOR],
  "/billing-production": [ROLES.ADMIN, ROLES.FATURAMENTO, ROLES.FINANCEIRO, ROLES.GESTOR],
  "/billing-accounts": [ROLES.ADMIN, ROLES.FATURAMENTO, ROLES.FINANCEIRO, ROLES.GESTOR],
  "/professional-payment": [ROLES.ADMIN, ROLES.FINANCEIRO],
  "/settings": [ROLES.ADMIN, ROLES.GESTOR, ROLES.ADMINISTRATIVO],
  "/master-data": [ROLES.ADMIN, ROLES.ADMINISTRATIVO],
  "/companies": [ROLES.ADMIN, ROLES.GESTOR, ROLES.ADMINISTRATIVO],
  "/admin/lgpd": [ROLES.ADMIN, ROLES.DPO],
  "/admin/audit": [ROLES.ADMIN, ROLES.DPO],
  "/admin/notifications": [ROLES.ADMIN, ROLES.DPO, ROLES.ADMINISTRATIVO],
  "/admin/insurances": [ROLES.ADMIN, ROLES.ADMINISTRATIVO, ROLES.GESTOR],
  "/admin/credentialing": [ROLES.ADMIN, ROLES.ADMINISTRATIVO, ROLES.GESTOR],
  "/admin/price-tables": [ROLES.ADMIN, ROLES.ADMINISTRATIVO, ROLES.GESTOR, ROLES.FATURAMENTO, ROLES.FINANCEIRO],
  "/admin/tiss": [ROLES.ADMIN, ROLES.FATURAMENTO, ROLES.FINANCEIRO, ROLES.ADMINISTRATIVO],
  "/admin/report-templates": [ROLES.ADMIN, ROLES.DIAGNOSTICO],
  "/admin/dicom": [ROLES.ADMIN, ROLES.DIAGNOSTICO],
  "/admin/users": [ROLES.ADMIN],
  "/admin/profiles": [ROLES.ADMIN],
  "/admin/permissions": [ROLES.ADMIN],
  "/admin": [ROLES.ADMIN],
  "/meus-agendamentos": [ROLES.PACIENTE],
  "/nursing/triage": [ROLES.ADMIN, ROLES.MEDICO, ROLES.ENFERMAGEM],
  "/nursing/care": [ROLES.ADMIN, ROLES.MEDICO, ROLES.ENFERMAGEM],
  "/nursing/queue": [ROLES.ADMIN, ROLES.RECEPCAO, ROLES.ENFERMAGEM],
  "/nursing": [ROLES.ADMIN, ROLES.MEDICO, ROLES.ENFERMAGEM],
  "/pharmacy": [ROLES.ADMIN, ROLES.MEDICO, ROLES.GESTOR, ROLES.ADMINISTRATIVO, ROLES.FARMACIA],
  "/bi": [ROLES.ADMIN, ROLES.GESTOR, ROLES.MEDICO, ROLES.FINANCEIRO],
  "/telemedicina": [ROLES.ADMIN, ROLES.MEDICO, ROLES.GESTOR],
  "/lab": [ROLES.ADMIN, ROLES.MEDICO, ROLES.GESTOR, ROLES.DIAGNOSTICO, ROLES.LABORATORIO],
  "/internacao": [ROLES.ADMIN, ROLES.MEDICO, ROLES.GESTOR, ROLES.ENFERMAGEM],
  "/cirurgia": [ROLES.ADMIN, ROLES.MEDICO, ROLES.GESTOR, ROLES.ENFERMAGEM],
  "/pa": [ROLES.ADMIN, ROLES.RECEPCAO, ROLES.MEDICO, ROLES.GESTOR, ROLES.ENFERMAGEM],
  "/assinatura": [ROLES.ADMIN, ROLES.MEDICO],
  "/ia-clinica": [ROLES.ADMIN, ROLES.MEDICO, ROLES.GESTOR],
  "/purchases": [ROLES.ADMIN, ROLES.GESTOR, ROLES.ADMINISTRATIVO, ROLES.FARMACIA],
  "/transport": [ROLES.ADMIN, ROLES.RECEPCAO, ROLES.GESTOR, ROLES.ADMINISTRATIVO, ROLES.ENFERMAGEM],
  "/nps": [ROLES.ADMIN, ROLES.GESTOR],
};

export function canAccessRoute(roleName: string | null | undefined, path: string): boolean {
  const normalized = normalizeRoleName(roleName);
  if (normalized === ROLES.ADMIN) return true;

  const sortedPrefixes = Object.keys(routePermissionMap).sort((a, b) => b.length - a.length);
  for (const prefix of sortedPrefixes) {
    const matches = prefix === "/"
      ? path === "/"
      : path === prefix || path.startsWith(`${prefix}/`);
    if (!matches) continue;
    const entry = routePermissionMap[prefix];
    if (entry === "*") return true;
    if (!normalized) return false;
    return entry.includes(normalized);
  }
  return false;
}

export function getAccessiblePrefixes(roleName: string | null | undefined): string[] {
  const normalized = normalizeRoleName(roleName);
  if (normalized === ROLES.ADMIN) return Object.keys(routePermissionMap);
  return Object.entries(routePermissionMap)
    .filter(([, entry]) => entry === "*" || Boolean(normalized && entry.includes(normalized)))
    .map(([prefix]) => prefix);
}
