// Central permission map — single source of truth for RBAC
// Role names are normalized to lowercase for matching.
// DB role names like "Administrador", "Recepção", "Médico" are mapped here.

export const ROLES = {
  ADMIN: "admin",
  RECEPCAO: "recepcao",
  MEDICO: "medico",
  FINANCEIRO: "financeiro",
  DIAGNOSTICO: "diagnostico",
  LABORATORIO: "laboratorio",
  GESTOR: "gestor",
  ADMINISTRATIVO: "administrativo",
  ENFERMAGEM: "enfermagem",
  FARMACIA: "farmacia",
  CALL_CENTER: "callcenter",
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

// Map DB role names (Portuguese, mixed case) to internal role keys
const ROLE_ALIASES: Record<string, RoleName> = {
  administrador: "admin",
  admin: "admin",
  superadmin: "admin",
  super_admin: "admin",
  "recepção": "recepcao",
  recepcao: "recepcao",
  recepcionista: "recepcao",
  supervisor_recepcao: "recepcao",
  "supervisor de recepção": "recepcao",
  "supervisor de recepcao": "recepcao",
  "médico": "medico",
  medico: "medico",
  doutor: "medico",
  financeiro: "financeiro",
  "diagnóstico": "diagnostico",
  diagnostico: "diagnostico",
  radiologia: "diagnostico",
  radiologista: "diagnostico",
  laboratorio: "laboratorio",
  "laboratório": "laboratorio",
  tecnico_radiologia: "diagnostico",
  "técnico de radiologia": "diagnostico",
  tecnico_laboratorio: "laboratorio",
  "técnico de laboratório": "laboratorio",
  "técnico": "diagnostico",
  tecnico: "diagnostico",
  imagem: "diagnostico",
  enfermagem: "enfermagem",
  enfermeiro: "enfermagem",
  enfermeira: "enfermagem",
  "técnico de enfermagem": "enfermagem",
  "tecnico de enfermagem": "enfermagem",
  farmacia: "farmacia",
  "farmácia": "farmacia",
  farmaceutico: "farmacia",
  "farmacêutico": "farmacia",
  farmaceutica: "farmacia",
  "farmacêutica": "farmacia",
  gestor: "gestor",
  gerente: "gestor",
  administrativo: "administrativo",
  callcenter: "callcenter",
  "call center": "callcenter",
};

/**
 * Normalize a DB role name to an internal role key.
 * Falls back to the lowercase version if no alias matches.
 */
export function normalizeRoleName(dbRoleName: string | null | undefined): RoleName | null {
  if (!dbRoleName) return null;
  const key = dbRoleName.trim().toLowerCase();
  return ROLE_ALIASES[key] || null;
}

// "*" means any authenticated user can access
type PermissionEntry = "*" | RoleName[];

// Each key is a route prefix. Order matters: more specific prefixes first.
const routePermissionMap: Record<string, PermissionEntry> = {
  "/": "*",
  "/patients": [ROLES.ADMIN, ROLES.RECEPCAO, ROLES.MEDICO, ROLES.GESTOR],
  "/professionals": [ROLES.ADMIN, ROLES.GESTOR, ROLES.ADMINISTRATIVO],
  "/schedule": [ROLES.ADMIN, ROLES.RECEPCAO, ROLES.MEDICO, ROLES.GESTOR],
  "/callcenter": [ROLES.ADMIN, ROLES.RECEPCAO, ROLES.CALL_CENTER],
  "/reception": [ROLES.ADMIN, ROLES.RECEPCAO],
  "/records": [ROLES.ADMIN, ROLES.MEDICO],
  "/encounters": [ROLES.ADMIN, ROLES.MEDICO],
  "/clinical-timeline": [ROLES.ADMIN, ROLES.MEDICO],
  "/attendance": [ROLES.ADMIN, ROLES.MEDICO],
  "/worklist": [ROLES.ADMIN, ROLES.DIAGNOSTICO],
  "/pacs": [ROLES.ADMIN, ROLES.DIAGNOSTICO],
  "/dicom/reports": [ROLES.ADMIN, ROLES.DIAGNOSTICO, ROLES.MEDICO, ROLES.GESTOR],
  "/dicom": [ROLES.ADMIN, ROLES.DIAGNOSTICO],
  "/financial": [ROLES.ADMIN, ROLES.FINANCEIRO, ROLES.GESTOR],
  "/billing-production": [ROLES.ADMIN, ROLES.FINANCEIRO, ROLES.GESTOR],
  "/billing-accounts": [ROLES.ADMIN, ROLES.FINANCEIRO, ROLES.GESTOR],
  "/professional-payment": [ROLES.ADMIN, ROLES.FINANCEIRO],
  "/settings": [ROLES.ADMIN, ROLES.GESTOR, ROLES.ADMINISTRATIVO],
  "/master-data": [ROLES.ADMIN, ROLES.ADMINISTRATIVO],
  "/companies": [ROLES.ADMIN, ROLES.GESTOR, ROLES.ADMINISTRATIVO],
  "/admin": [ROLES.ADMIN, ROLES.ADMINISTRATIVO],
  "/meus-agendamentos": "*", // portal do paciente (qualquer usuario logado)
  "/nursing/clinical": [ROLES.ADMIN, ROLES.MEDICO, ROLES.ENFERMAGEM],
  "/prescriptions": [ROLES.ADMIN, ROLES.MEDICO, ROLES.FARMACIA],
  "/care-protocols": [ROLES.ADMIN, ROLES.MEDICO, ROLES.ENFERMAGEM, ROLES.GESTOR],
  "/exam-requests": [ROLES.ADMIN, ROLES.MEDICO, ROLES.ENFERMAGEM, ROLES.DIAGNOSTICO, ROLES.LABORATORIO],
  "/nursing/triage": [ROLES.ADMIN, ROLES.MEDICO, ROLES.ENFERMAGEM],
  "/nursing/queue": [ROLES.ADMIN, ROLES.MEDICO, ROLES.RECEPCAO, ROLES.ENFERMAGEM],
  "/nursing/care": [ROLES.ADMIN, ROLES.MEDICO, ROLES.ENFERMAGEM],
  "/nursing": [ROLES.ADMIN, ROLES.MEDICO, ROLES.ENFERMAGEM],
  "/pharmacy": [ROLES.ADMIN, ROLES.MEDICO, ROLES.FARMACIA, ROLES.GESTOR, ROLES.ADMINISTRATIVO],
  "/bi": [ROLES.ADMIN, ROLES.GESTOR, ROLES.MEDICO, ROLES.FINANCEIRO],
  "/telemedicina": [ROLES.ADMIN, ROLES.MEDICO, ROLES.GESTOR],
  "/lab": [ROLES.ADMIN, ROLES.MEDICO, ROLES.GESTOR, ROLES.LABORATORIO],
  // Agente 38
  "/internacao": [ROLES.ADMIN, ROLES.MEDICO, ROLES.GESTOR],
  "/cirurgia": [ROLES.ADMIN, ROLES.MEDICO, ROLES.GESTOR],
  "/pa": [ROLES.ADMIN, ROLES.RECEPCAO, ROLES.MEDICO, ROLES.GESTOR],
  "/assinatura": [ROLES.ADMIN, ROLES.MEDICO],
  "/ia-clinica": [ROLES.ADMIN, ROLES.MEDICO, ROLES.GESTOR],
  // Agente 37: Compras + Transporte + NPS
  "/purchases": [ROLES.ADMIN, ROLES.GESTOR, ROLES.ADMINISTRATIVO],
  "/transport": [ROLES.ADMIN, ROLES.RECEPCAO, ROLES.GESTOR, ROLES.ADMINISTRATIVO],
  "/nps": [ROLES.ADMIN, ROLES.GESTOR],
  // /nps/:token é público (link enviado a pacientes); não passa por este gate.
};

/**
 * Check if a role can access a given path.
 * Accepts raw DB role names — normalizes internally.
 */
export function canAccessRoute(roleName: string | null | undefined, path: string): boolean {
  const normalized = normalizeRoleName(roleName);
  if (normalized === ROLES.ADMIN) return true;

  // Find the best matching prefix (longest first)
  const sortedPrefixes = Object.keys(routePermissionMap).sort(
    (a, b) => b.length - a.length
  );

  for (const prefix of sortedPrefixes) {
    const matches = prefix === "/" ? path === "/" : path.startsWith(prefix);
    if (matches) {
      const entry = routePermissionMap[prefix];
      if (entry === "*") return true;
      if (!normalized) return false;
      return entry.includes(normalized);
    }
  }

  return false;
}

/**
 * Get all route prefixes a role can access (for sidebar filtering).
 */
export function getAccessiblePrefixes(roleName: string | null | undefined): string[] {
  const normalized = normalizeRoleName(roleName);
  if (normalized === ROLES.ADMIN) return Object.keys(routePermissionMap);

  return Object.entries(routePermissionMap)
    .filter(([, entry]) => {
      if (entry === "*") return true;
      if (!normalized) return false;
      return entry.includes(normalized);
    })
    .map(([prefix]) => prefix);
}
