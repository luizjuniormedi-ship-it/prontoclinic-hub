import { normalizeRoleName, ROLES, type RoleName } from "@/config/routePermissions";

export type ClinicalModuleAction =
  | "m19.complete"
  | "m20.create"
  | "m20.manage"
  | "m20.review"
  | "m21.manageDefinitions"
  | "m21.execute"
  | "m22.create"
  | "m22.sign"
  | "m22.cancel"
  | "m22.dispatch"
  | "m22.transition";

const ACTION_ROLES: Record<ClinicalModuleAction, readonly RoleName[]> = {
  "m19.complete": [ROLES.ADMIN, ROLES.MEDICO, ROLES.ENFERMAGEM],
  "m20.create": [ROLES.ADMIN, ROLES.MEDICO],
  "m20.manage": [ROLES.ADMIN, ROLES.MEDICO],
  "m20.review": [ROLES.ADMIN, ROLES.FARMACIA],
  "m21.manageDefinitions": [ROLES.ADMIN, ROLES.MEDICO, ROLES.GESTOR],
  "m21.execute": [ROLES.ADMIN, ROLES.MEDICO, ROLES.ENFERMAGEM, ROLES.GESTOR],
  "m22.create": [ROLES.ADMIN, ROLES.MEDICO, ROLES.ENFERMAGEM],
  "m22.sign": [ROLES.ADMIN, ROLES.MEDICO, ROLES.ENFERMAGEM],
  "m22.cancel": [ROLES.ADMIN, ROLES.MEDICO, ROLES.ENFERMAGEM],
  "m22.dispatch": [
    ROLES.ADMIN,
    ROLES.MEDICO,
    ROLES.ENFERMAGEM,
    ROLES.DIAGNOSTICO,
    ROLES.LABORATORIO,
  ],
  "m22.transition": [
    ROLES.ADMIN,
    ROLES.MEDICO,
    ROLES.ENFERMAGEM,
    ROLES.DIAGNOSTICO,
    ROLES.LABORATORIO,
  ],
};

export function canPerformClinicalAction(
  roleName: string | null | undefined,
  action: ClinicalModuleAction,
): boolean {
  const role = normalizeRoleName(roleName);
  return role ? ACTION_ROLES[action].includes(role) : false;
}

export function clinicalPermissionsFor(roleName: string | null | undefined) {
  return {
    m19: {
      canCompleteTriage: canPerformClinicalAction(roleName, "m19.complete"),
    },
    m20: {
      canCreate: canPerformClinicalAction(roleName, "m20.create"),
      canManage: canPerformClinicalAction(roleName, "m20.manage"),
      canReview: canPerformClinicalAction(roleName, "m20.review"),
    },
    m21: {
      canManageDefinitions: canPerformClinicalAction(roleName, "m21.manageDefinitions"),
      canExecute: canPerformClinicalAction(roleName, "m21.execute"),
    },
    m22: {
      canCreate: canPerformClinicalAction(roleName, "m22.create"),
      canSign: canPerformClinicalAction(roleName, "m22.sign"),
      canCancel: canPerformClinicalAction(roleName, "m22.cancel"),
      canDispatch: canPerformClinicalAction(roleName, "m22.dispatch"),
      canTransition: canPerformClinicalAction(roleName, "m22.transition"),
    },
  } as const;
}
