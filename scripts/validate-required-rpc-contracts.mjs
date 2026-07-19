import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const contractPath = path.join(root, 'scripts', 'rpc-required-contracts.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const migrationRoot = path.join(root, 'supabase', 'migrations');
const sql = fs.readdirSync(migrationRoot)
  .filter((name) => name.endsWith('.sql'))
  .map((name) => fs.readFileSync(path.join(migrationRoot, name), 'utf8'))
  .join('\n');

const proven = contract.contracts.filter((item) => item.status === 'PROVEN');
const errors = [];
for (const item of proven) {
  const definition = new RegExp(`CREATE(?: OR REPLACE)? FUNCTION\\s+(?:public\\.)?${item.name}\\s*\\(`, 'i');
  const grant = new RegExp(`GRANT EXECUTE ON FUNCTION\\s+(?:public\\.)?${item.name}\\b[\\s\\S]*?\\bTO\\s+${item.grant_role}\\b`, 'i');
  if (!definition.test(sql)) errors.push(`${item.name}: SQL_DEFINITION_MISSING`);
  if (!grant.test(sql)) errors.push(`${item.name}: GRANT_MISSING:${item.grant_role}`);
}
const blocked = contract.contracts.filter((item) => item.status === 'BLOCKED').map((item) => ({ name: item.name, domain: item.domain, reason: item.reason }));
const result = { status: errors.length ? 'BLOCKED' : 'READY_WITH_BLOCKED_GAPS', proven_checked: proven.length, blocked_declared: blocked.length, errors, blocked };
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
