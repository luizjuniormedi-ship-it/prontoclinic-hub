import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./local-auth-server.mjs', import.meta.url), 'utf8');
const ecosystem = await readFile(
  new URL('./scripts/prontomedic-auth.ecosystem.config.cjs', import.meta.url),
  'utf8'
);

test('backend does not expose raw database errors in JSON responses', () => {
  assert.doesNotMatch(source, /json\(res,\s*\{\s*error:\s*e\.message/);
  assert.match(source, /function databaseFailure\(res, error, code\)/);
});

test('backend keeps database error details in server logs', () => {
  assert.match(source, /console\.error\(`\[DB_ERROR:\$\{code\}\]`, error\)/);
});

test('backend supports protected secret files without requiring secret values in PM2 env', () => {
  assert.match(source, /readFileSync\(filePath, 'utf8'\)/);
  assert.match(source, /readSecret\('JWT_SECRET', 'JWT_SECRET_FILE'\)/);
  assert.match(source, /readSecret\('PGPASSWORD', 'PGPASSWORD_FILE'\)/);
});

test('PM2 manifest passes secret file paths instead of secret values', () => {
  assert.match(ecosystem, /JWT_SECRET_FILE/);
  assert.match(ecosystem, /PGPASSWORD_FILE/);
  assert.doesNotMatch(ecosystem, /JWT_SECRET\s*:/);
  assert.doesNotMatch(ecosystem, /PGPASSWORD\s*:/);
});
