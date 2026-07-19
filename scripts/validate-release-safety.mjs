import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertE2ESafety } from './e2e-safety.mjs';

const local = assertE2ESafety({ E2E_BASE_URL: 'http://127.0.0.1:4173', E2E_ENV: 'local' });
assert.equal(local.mode, 'readonly');
assert.throws(() => assertE2ESafety({ E2E_BASE_URL: 'https://production.example.com', E2E_ENV: 'staging' }), /allowlist|produtiva/);
assert.throws(() => assertE2ESafety({ CI: 'true', E2E_BASE_URL: 'https://staging.example.com', E2E_ALLOWED_HOSTS: 'staging.example.com', E2E_ENV: 'staging', E2E_MODE: 'mutating' }), /E2E_AUTH_READY/);
assert.throws(() => assertE2ESafety({ E2E_BASE_URL: 'https://staging.example.com', E2E_ALLOWED_HOSTS: 'staging.example.com', E2E_ENV: 'staging', E2E_MODE: 'destructive', E2E_AUTH_READY: 'true' }), /E2E_ALLOW_DESTRUCTIVE/);

const globalSetup = fs.readFileSync('e2e/global-setup.ts', 'utf8');
assert.doesNotMatch(globalSetup, /auth\/v1\/admin\/users|SUPABASE_SERVICE_ROLE_KEY|reset_e2e_data/);
assert.match(globalSetup, /pré-provisionad[oa]/);
const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
assert.doesNotMatch(ci, /reset_e2e_data|SUPABASE_SERVICE_ROLE_KEY/);
assert.match(ci, /E2E_MODE: readonly/);
const deploy = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
assert.match(deploy, /run: npm run lint\n/);
assert.match(deploy, /DEPLOY_PRODUCTION/);
console.log('release safety policy: OK');
