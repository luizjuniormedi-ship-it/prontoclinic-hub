import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('./supabase/migrations/20251231000050_auth_compatibility.sql', import.meta.url),
  'utf8'
);

test('clean replay auth compatibility contains fields required by E2E seed and local auth', () => {
  for (const column of [
    'instance_id', 'aud', 'role', 'email', 'encrypted_password',
    'email_confirmed_at', 'raw_app_meta_data', 'raw_user_meta_data',
    'created_at', 'updated_at', 'confirmation_token', 'email_change',
    'email_change_token_new', 'recovery_token'
  ]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`), column);
  }
});

test('auth compatibility does not replace an existing Supabase auth implementation', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS auth\.users/);
  assert.match(migration, /IF to_regprocedure\('auth\.uid\(\)'\) IS NULL/);
});
