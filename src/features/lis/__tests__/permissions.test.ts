import { describe, expect, it } from 'vitest';

import {
  M23_ROLE_CAPABILITIES,
  actorHasCapability,
  canReleaseResult,
  canValidateResult,
  roleHasCapability,
  type LabActor,
  type M23Capability,
  type M23Role,
} from '../model/permissions';

const now = '2026-07-24T12:00:00.000Z';

describe('M23 capability matrix', () => {
  it('defines exactly the five operational roles', () => {
    expect(Object.keys(M23_ROLE_CAPABILITIES).sort()).toEqual([
      'admin',
      'diagnostico',
      'gestor',
      'laboratorio',
      'medico',
    ]);
  });

  it('grants every capability to admin', () => {
    const capabilities = new Set<M23Capability>(
      Object.values(M23_ROLE_CAPABILITIES).flat(),
    );
    expect(new Set(M23_ROLE_CAPABILITIES.admin)).toEqual(capabilities);
  });

  it('keeps operational specimen actions restricted to laboratory staff', () => {
    const specimenCapabilities: M23Capability[] = [
      'collect_specimen',
      'receive_specimen',
      'triage_specimen',
      'reject_specimen',
      'process_specimen',
    ];
    const nonAdminRoles: M23Role[] = [
      'medico',
      'laboratorio',
      'diagnostico',
      'gestor',
    ];

    for (const capability of specimenCapabilities) {
      expect(roleHasCapability('laboratorio', capability)).toBe(true);
      for (const role of nonAdminRoles.filter((item) => item !== 'laboratorio')) {
        expect(roleHasCapability(role, capability)).toBe(false);
      }
    }
  });

  it('allows clinical validation but denies catalog management to clinicians', () => {
    expect(roleHasCapability('medico', 'validate_result')).toBe(true);
    expect(roleHasCapability('diagnostico', 'validate_result')).toBe(true);
    expect(roleHasCapability('laboratorio', 'release_result')).toBe(false);
    expect(roleHasCapability('diagnostico', 'release_result')).toBe(false);
    expect(roleHasCapability('medico', 'manage_catalog')).toBe(false);
    expect(roleHasCapability('diagnostico', 'manage_catalog')).toBe(false);
  });

  it('limits gestor to oversight, communication, delivery and catalog duties', () => {
    expect(M23_ROLE_CAPABILITIES.gestor).toEqual([
      'view_order',
      'communicate_critical',
      'deliver_result',
      'manage_catalog',
      'audit_workflow',
    ]);
    expect(roleHasCapability('gestor', 'enter_result')).toBe(false);
    expect(roleHasCapability('gestor', 'validate_result')).toBe(false);
  });

  it('combines multiple actor roles without changing the base matrix', () => {
    const actor: LabActor = {
      id: 'actor-1',
      roles: ['gestor', 'medico'],
    };
    expect(actorHasCapability(actor, 'manage_catalog')).toBe(true);
    expect(actorHasCapability(actor, 'validate_result')).toBe(true);
    expect(actorHasCapability(actor, 'collect_specimen')).toBe(false);
  });
});

describe('M23 digitizer and validator segregation', () => {
  const result = {
    enteredBy: 'operator-1',
    correctedBy: undefined,
  };

  it('denies validation when the actor lacks the capability', () => {
    expect(
      canValidateResult({ id: 'manager-1', roles: ['gestor'] }, result),
    ).toEqual({
      allowed: false,
      code: 'capability_denied',
    });
  });

  it('denies validation when result authorship is missing', () => {
    expect(
      canValidateResult(
        { id: 'doctor-1', roles: ['medico'] },
        { enteredBy: undefined, correctedBy: undefined },
      ),
    ).toEqual({
      allowed: false,
      code: 'result_authorship_missing',
    });
  });

  it('denies self-validation even for admin', () => {
    expect(
      canValidateResult({ id: 'operator-1', roles: ['admin'] }, result),
    ).toEqual({
      allowed: false,
      code: 'same_user_cannot_validate',
    });
  });

  it('denies validation by the last corrector', () => {
    expect(
      canValidateResult(
        { id: 'corrector-1', roles: ['diagnostico'] },
        { enteredBy: 'operator-1', correctedBy: 'corrector-1' },
      ),
    ).toEqual({
      allowed: false,
      code: 'same_user_cannot_validate',
    });
  });

  it.each<M23Role>(['admin', 'medico', 'laboratorio', 'diagnostico'])(
    'allows a distinct authorized %s validator',
    (role) => {
      expect(
        canValidateResult({ id: `validator-${role}`, roles: [role] }, result),
      ).toEqual({
        allowed: true,
        code: 'allowed',
      });
    },
  );
});

describe('M23 release permission', () => {
  it('requires a release-capable actor and completed validation', () => {
    const validation = {
      status: 'validated' as const,
      validatorId: 'validator-1',
      validatedAt: now,
    };
    expect(
      canReleaseResult({ id: 'manager-1', roles: ['gestor'] }, validation).code,
    ).toBe('capability_denied');
    expect(
      canReleaseResult(
        { id: 'doctor-1', roles: ['medico'] },
        { ...validation, status: 'pending' },
      ).code,
    ).toBe('validation_incomplete');
    expect(
      canReleaseResult({ id: 'doctor-1', roles: ['medico'] }, validation),
    ).toEqual({
      allowed: true,
      code: 'allowed',
    });
  });
});
