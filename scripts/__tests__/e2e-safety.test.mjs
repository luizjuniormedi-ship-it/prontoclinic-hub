import test from 'node:test';
import assert from 'node:assert/strict';
import { assertE2ESafety } from '../e2e-safety.mjs';

test('defaults to a read-only loopback runtime on the managed frontend port', () => {
  const result = assertE2ESafety({});
  assert.equal(result.baseURL, 'http://127.0.0.1:8080/');
  assert.equal(result.mode, 'readonly');
  assert.equal(result.environment, 'local');
});

test('rejects local mutations without explicit disposable-environment acknowledgement', () => {
  assert.throws(
    () => assertE2ESafety({ E2E_MODE: 'mutating', E2E_ENV: 'local' }),
    /E2E_ALLOW_LOCAL_MUTATIONS=true/,
  );
});

test('allows explicitly acknowledged mutations only on loopback', () => {
  const result = assertE2ESafety({
    E2E_MODE: 'mutating',
    E2E_ENV: 'local',
    E2E_ALLOW_LOCAL_MUTATIONS: 'true',
    E2E_BASE_URL: 'http://localhost:8080',
  });
  assert.equal(result.mode, 'mutating');
});

test('rejects production-like and credential-bearing URLs', () => {
  assert.throws(
    () => assertE2ESafety({ E2E_BASE_URL: 'https://prod.prontomedic.example' }),
    /fora da allowlist|potencialmente produtiva/,
  );
  assert.throws(
    () => assertE2ESafety({ E2E_BASE_URL: 'http://user:pass@127.0.0.1:8080' }),
    /sem credenciais embutidas/,
  );
});
