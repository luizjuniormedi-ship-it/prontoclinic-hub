import type { LabResult, ResultValidation } from './types';

export type M23Role = 'admin' | 'medico' | 'laboratorio' | 'diagnostico' | 'gestor';

export type M23Capability =
  | 'view_order'
  | 'create_order'
  | 'update_order'
  | 'cancel_order'
  | 'collect_specimen'
  | 'receive_specimen'
  | 'triage_specimen'
  | 'reject_specimen'
  | 'process_specimen'
  | 'enter_result'
  | 'validate_result'
  | 'release_result'
  | 'manage_quality_control'
  | 'acknowledge_critical'
  | 'communicate_critical'
  | 'deliver_result'
  | 'manage_catalog'
  | 'audit_workflow';

const allCapabilities = [
  'view_order',
  'create_order',
  'update_order',
  'cancel_order',
  'collect_specimen',
  'receive_specimen',
  'triage_specimen',
  'reject_specimen',
  'process_specimen',
  'enter_result',
  'validate_result',
  'release_result',
  'manage_quality_control',
  'acknowledge_critical',
  'communicate_critical',
  'deliver_result',
  'manage_catalog',
  'audit_workflow',
] as const satisfies readonly M23Capability[];

export const M23_ROLE_CAPABILITIES = {
  admin: allCapabilities,
  medico: [
    'view_order',
    'create_order',
    'validate_result',
    'release_result',
    'acknowledge_critical',
    'communicate_critical',
  ],
  laboratorio: [
    'view_order',
    'create_order',
    'update_order',
    'cancel_order',
    'collect_specimen',
    'receive_specimen',
    'triage_specimen',
    'reject_specimen',
    'process_specimen',
    'enter_result',
    'validate_result',
    'manage_quality_control',
    'acknowledge_critical',
    'communicate_critical',
    'deliver_result',
  ],
  diagnostico: [
    'view_order',
    'enter_result',
    'validate_result',
    'acknowledge_critical',
    'communicate_critical',
  ],
  gestor: [
    'view_order',
    'communicate_critical',
    'deliver_result',
    'manage_catalog',
    'audit_workflow',
  ],
} as const satisfies Record<M23Role, readonly M23Capability[]>;

export interface LabActor {
  readonly id: string;
  readonly roles: readonly M23Role[];
}

export type PermissionCode =
  | 'allowed'
  | 'capability_denied'
  | 'same_user_cannot_validate'
  | 'result_authorship_missing'
  | 'validation_incomplete';

export interface PermissionDecision {
  readonly allowed: boolean;
  readonly code: PermissionCode;
}

function allow(): PermissionDecision {
  return { allowed: true, code: 'allowed' };
}

function deny(code: Exclude<PermissionCode, 'allowed'>): PermissionDecision {
  return { allowed: false, code };
}

export function roleHasCapability(
  role: M23Role,
  capability: M23Capability,
): boolean {
  return (M23_ROLE_CAPABILITIES[role] as readonly M23Capability[]).includes(
    capability,
  );
}

export function actorHasCapability(
  actor: LabActor,
  capability: M23Capability,
): boolean {
  return actor.roles.some((role) => roleHasCapability(role, capability));
}

export function canValidateResult(
  actor: LabActor,
  result: Pick<LabResult, 'enteredBy' | 'correctedBy'>,
): PermissionDecision {
  if (!actorHasCapability(actor, 'validate_result')) {
    return deny('capability_denied');
  }

  if (!result.enteredBy) {
    return deny('result_authorship_missing');
  }

  if (result.enteredBy === actor.id || result.correctedBy === actor.id) {
    return deny('same_user_cannot_validate');
  }

  return allow();
}

export function canReleaseResult(
  actor: LabActor,
  validation: Pick<ResultValidation, 'status' | 'validatorId' | 'validatedAt'>,
): PermissionDecision {
  if (!actorHasCapability(actor, 'release_result')) {
    return deny('capability_denied');
  }

  if (
    validation.status !== 'validated' ||
    !validation.validatorId ||
    !validation.validatedAt
  ) {
    return deny('validation_incomplete');
  }

  return allow();
}
