import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const migrationRoot = path.join(root, 'supabase', 'migrations');
const releaseMvpRoot = path.join(root, 'supabase', 'release-mvp');
const coordinatorRoot = path.resolve(root, '..');
const manifestPath = path.join(root, 'scripts', 'rpc-allowlist.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const contractPath = path.join(root, 'scripts', 'rpc-contract.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

function filesUnder(dir, predicate) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(full, predicate));
    else if (predicate(full)) result.push(full);
  }
  return result;
}

const sourceFiles = filesUnder(
  srcRoot,
  (file) => /\.(ts|tsx)$/.test(file) && !file.includes('__tests__'),
);
const projectMigrations = filesUnder(migrationRoot, (file) => file.endsWith('.sql'));
const releaseMvpMigrations = fs.existsSync(releaseMvpRoot)
  ? filesUnder(releaseMvpRoot, (file) => file.endsWith('.sql'))
  : [];
const coordinatorMigrationRoot = path.join(coordinatorRoot, 'migrations');
const coordinatorMigrations = [
  ...(fs.existsSync(coordinatorRoot)
    ? fs.readdirSync(coordinatorRoot)
      .filter((name) => /^\d{14}_.+\.sql$/.test(name))
      .map((name) => path.join(coordinatorRoot, name))
    : []),
  ...(fs.existsSync(coordinatorMigrationRoot)
    ? filesUnder(coordinatorMigrationRoot, (file) => /^\d{14}_.+\.sql$/.test(path.basename(file)))
    : []),
];
const migrationFiles = [...new Set([
  ...projectMigrations,
  ...releaseMvpMigrations,
  ...coordinatorMigrations,
])].sort();
const sourceText = sourceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const migrationText = migrationFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

function splitTopLevel(value) {
  const result = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1;
    if (value[index] === ')') depth -= 1;
    if (value[index] === ',' && depth === 0) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (value.slice(start).trim()) result.push(value.slice(start).trim());
  return result;
}

function normalizeTypeList(raw) {
  if (!raw.trim()) return '';
  return splitTopLevel(raw).map((part) => {
    const withoutDefault = part.replace(/\s+DEFAULT\s+[\s\S]*$/i, '').trim();
    const withoutMode = withoutDefault.replace(/^(INOUT|IN|OUT|VARIADIC)\s+/i, '').trim();
    const tokens = withoutMode.split(/\s+/);
    if (tokens.length > 1 && /^[a-z_][a-z0-9_]*$/i.test(tokens[0])) tokens.shift();
    return tokens.join(' ').replace(/\s+/g, ' ').trim().toUpperCase();
  }).join(', ');
}

function functionDefinitions(text) {
  const result = new Map();
  const pattern = /CREATE(?: OR REPLACE)? FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  for (const match of text.matchAll(pattern)) {
    let index = match.index + match[0].length;
    let depth = 1;
    while (index < text.length && depth > 0) {
      if (text[index] === '(') depth += 1;
      if (text[index] === ')') depth -= 1;
      index += 1;
    }
    const raw = text.slice(match.index + match[0].length, index - 1);
    const signatures = result.get(match[1]) || new Set();
    signatures.add(normalizeTypeList(raw));
    result.set(match[1], signatures);
  }
  return result;
}

const frontend = new Set(
  [...sourceText.matchAll(/(?:supabase\.)?rpc\(\s*["']([^"']+)["']/gi)].map((match) => match[1]),
);
const allowlist = new Set(manifest.required);
const declared = functionDefinitions(migrationText);
const granted = new Map();
for (const match of migrationText.matchAll(
  /GRANT EXECUTE ON FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)(?:\s*\(([^)]*)\))?\s+TO\s+([^;]+)/gi,
)) {
  const entry = granted.get(match[1]) || { qualified: new Map(), unqualified: new Set() };
  const roles = match[2] === undefined ? entry.unqualified : (entry.qualified.get(normalizeTypeList(match[2])) || new Set());
  for (const role of match[3].split(',').map((value) => value.trim().toLowerCase())) roles.add(role);
  if (match[2] === undefined) entry.unqualified = roles;
  else entry.qualified.set(normalizeTypeList(match[2]), roles);
  granted.set(match[1], entry);
}

const proxyCandidates = [
  path.join(root, 'local-auth-server.mjs'),
  path.join(root, '..', 'local-auth-server.mjs'),
];
const proxyPath = proxyCandidates.find((file) => fs.existsSync(file));
const proxyText = proxyPath ? fs.readFileSync(proxyPath, 'utf8') : '';
const proxyAllowlist = new Set(
  [...proxyText.matchAll(/^\s{2}([A-Za-z0-9_]+): \{ module:/gm)].map((match) => match[1]),
);

const blocked = {
  ALLOWLIST_MISSING: [...frontend].filter((name) => !allowlist.has(name)).sort(),
  PROXY_ALLOWLIST_MISSING: [...frontend].filter((name) => !proxyAllowlist.has(name)).sort(),
  CONTRACT_MISSING: [...frontend].filter((name) => !contract.contracts[name]).sort(),
  SQL_DEFINITION_MISSING: [...frontend].filter((name) => !(declared.get(name)?.size)).sort(),
  SIGNATURE_UNRESOLVED: [...frontend].filter((name) => {
    const item = contract.contracts[name];
    return item && (!Array.isArray(item.signatures) || item.signature_status === 'needs_catalog_signature');
  }).sort(),
  GRANT_UNPROVEN: [...frontend].filter((name) => {
    const item = contract.contracts[name];
    const definitionSet = declared.get(name);
    if (!item || !definitionSet || item.signature_status === 'unresolved_sql_missing') return false;
    const grant = granted.get(name);
    const expectedRoles = new Set(item.roles.map((role) => role.toLowerCase()));
    return item.signatures.some((signature) => {
      const roles = grant?.qualified.get(normalizeTypeList(signature));
      const unqualifiedRoles = grant?.unqualified;
      return !roles || [...expectedRoles].some((role) => !roles.has(role))
        && [...expectedRoles].some((role) => !unqualifiedRoles?.has(role));
    });
  }).sort(),
};

const blockedNames = [...new Set(Object.values(blocked).flat())].sort();
const result = {
  status: blockedNames.length ? 'BLOCKED' : 'READY',
  source_files: sourceFiles.length,
  frontend_rpc_count: frontend.size,
  contract_allowlist_count: allowlist.size,
  contract_rpc_count: Object.keys(contract.contracts).length,
  proxy_allowlist_count: proxyAllowlist.size,
  project_migration_count: projectMigrations.length,
  coordinator_migration_count: coordinatorMigrations.length,
  proxy_source: proxyPath || null,
  blocked,
  blocked_unique_count: blockedNames.length,
  blocked_unique: blockedNames,
};

console.log(JSON.stringify(result, null, 2));
if (blockedNames.length) {
  console.error(`RPC CONTRACT BLOCKED: ${blockedNames.length} names require explicit reconciliation.`);
  process.exitCode = 1;
}
