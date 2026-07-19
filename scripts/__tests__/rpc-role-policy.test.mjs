import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGING_RPC_ROLE_POLICY, isRpcRoleAllowed } from '../rpc-role-policy.mjs';

const createOrderRoles = IMAGING_RPC_ROLE_POLICY.create_imaging_order_from_attendance;
const signReportRoles = IMAGING_RPC_ROLE_POLICY.sign_and_release_radiology_report;

test('pedido de imagem aceita somente médico e administração explícitos', () => {
  for (const role of createOrderRoles) assert.equal(isRpcRoleAllowed(createOrderRoles, role), true, role);
  for (const role of ['reception', 'technician', 'nurse', 'billing', '', '*']) {
    assert.equal(isRpcRoleAllowed(createOrderRoles, role), false, role);
  }
});

test('assinatura aceita radiologia, médico e administração, mas não perfis operacionais', () => {
  for (const role of signReportRoles) assert.equal(isRpcRoleAllowed(signReportRoles, role), true, role);
  for (const role of ['reception', 'technician', 'nurse', 'billing', '', '*']) {
    assert.equal(isRpcRoleAllowed(signReportRoles, role), false, role);
  }
});

test('comparação normaliza caixa e espaços sem aceitar curingas', () => {
  assert.equal(isRpcRoleAllowed(signReportRoles, '  RADIOLOGIST '), true);
  assert.equal(isRpcRoleAllowed(['*'], 'doctor'), false);
  assert.equal(isRpcRoleAllowed([], 'admin'), false);
});
