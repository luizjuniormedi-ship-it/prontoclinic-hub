import assert from 'node:assert/strict';
import test from 'node:test';
import { scopeInsertBody, scopePatchBody } from './local-auth-security.mjs';

test('insert always uses the authenticated tenant', () => {
  assert.deepEqual(
    scopeInsertBody({ full_name: 'Teste' }, 'tenant-a'),
    { full_name: 'Teste', company_id: 'tenant-a' },
  );
  assert.deepEqual(
    scopeInsertBody({ full_name: 'Teste', company_id: 'tenant-a' }, 'tenant-a'),
    { full_name: 'Teste', company_id: 'tenant-a' },
  );
});

test('insert rejects a cross-tenant company_id', () => {
  assert.throws(
    () => scopeInsertBody({ full_name: 'Teste', company_id: 'tenant-b' }, 'tenant-a'),
    (error) => error?.statusCode === 403,
  );
});

test('patch removes company_id from the mutable column set', () => {
  assert.deepEqual(
    scopePatchBody({ full_name: 'Atualizado', company_id: 'tenant-a' }, 'tenant-a'),
    { full_name: 'Atualizado' },
  );
});

test('patch rejects a cross-tenant company_id', () => {
  assert.throws(
    () => scopePatchBody({ company_id: 'tenant-b' }, 'tenant-a'),
    (error) => error?.statusCode === 403,
  );
});
