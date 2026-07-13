import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./local-auth-server.mjs', import.meta.url), 'utf8');

test('backend does not expose raw database errors in JSON responses', () => {
  assert.doesNotMatch(source, /json\(res,\s*\{\s*error:\s*e\.message/);
  assert.match(source, /function databaseFailure\(res, error, code\)/);
});

test('backend keeps database error details in server logs', () => {
  assert.match(source, /console\.error\(`\[DB_ERROR:\$\{code\}\]`, error\)/);
});
