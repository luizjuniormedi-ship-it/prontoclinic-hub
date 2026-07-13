import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bootstrap = await readFile(new URL('./scripts/bootstrap-base-tables.sql', import.meta.url), 'utf8');

test('bootstrap auth helpers fail closed without JWT claims', () => {
  assert.match(bootstrap, /SELECT nullif\(current_setting\('request\.jwt\.claim\.sub', true\), ''\)::uuid/);
  assert.doesNotMatch(bootstrap, /SELECT id FROM auth\.users LIMIT 1/);
  assert.match(bootstrap, /current_setting\('request\.jwt\.claim\.role', true\), ''\), 'anon'/);
  assert.doesNotMatch(bootstrap, /current_setting\('request\.jwt\.claim\.role', true\), ''\), 'service_role'/);
});

test('bootstrap does not grant broad table rights to anon', () => {
  assert.doesNotMatch(bootstrap, /GRANT ALL ON ALL TABLES IN SCHEMA public TO [^;]*\banon\b/);
  assert.match(bootstrap, /GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon/);
});
