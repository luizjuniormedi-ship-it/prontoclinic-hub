import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const migrationRoot = path.join(root, 'supabase', 'migrations');
const coordinatorRoot = path.resolve(root, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'rpc-allowlist.json'), 'utf8'));

function filesUnder(dir, predicate = () => true) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full, predicate));
    else if (predicate(full)) out.push(full);
  }
  return out;
}

const sourceFiles = filesUnder(srcRoot, (file) => /\.(ts|tsx)$/.test(file) && !file.includes('__tests__'));
const projectMigrationFiles = filesUnder(migrationRoot, (file) => file.endsWith('.sql'));
const coordinatorMigrationFiles = fs.existsSync(coordinatorRoot)
  ? fs.readdirSync(coordinatorRoot)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .map((name) => path.join(coordinatorRoot, name))
  : [];
const migrationFiles = [...new Set([...projectMigrationFiles, ...coordinatorMigrationFiles])].sort();
const sourceText = sourceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const migrationText = migrationFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const frontend = new Set([...sourceText.matchAll(/(?:supabase\.)?rpc\(\s*["']([^"']+)["']/gi)].map((m) => m[1]));
const declared = new Set([...migrationText.matchAll(/CREATE(?: OR REPLACE)? FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)].map((m) => m[1]));
const granted = new Map();
for (const match of migrationText.matchAll(/GRANT EXECUTE ON FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\([^)]*\)\s+TO\s+([^;\r\n]+)/gi)) {
  const roles = granted.get(match[1]) || new Set();
  for (const role of match[2].split(',').map((value) => value.trim().toLowerCase())) roles.add(role);
  granted.set(match[1], roles);
}
const required = new Set(manifest.required);
const errors = [];
const warnings = [];
for (const name of frontend) if (!required.has(name)) errors.push(`frontend RPC fora da allowlist: ${name}`);
for (const name of required) {
  if (!declared.has(name)) errors.push(`RPC da allowlist sem CREATE FUNCTION nas migrations: ${name}`);
  const expected = new Set((manifest.grantee_exceptions[name] || manifest.default_grantees).map((v) => v.toLowerCase()));
  const actual = granted.get(name) || new Set();
  for (const role of expected) if (!actual.has(role)) warnings.push(`grant ausente ou nao detectado: ${name} -> ${role}`);
}
for (const name of required) if (!frontend.has(name)) warnings.push(`allowlist sem chamada frontend atual: ${name}`);

const result = {
  frontend: [...frontend].sort(),
  declared: [...declared].sort(),
  project_migration_count: projectMigrationFiles.length,
  coordinator_migration_count: coordinatorMigrationFiles.length,
  errors,
  warnings,
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
