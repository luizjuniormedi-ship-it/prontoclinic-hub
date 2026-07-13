import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const normalize = (values) => [...new Set(values)].sort();
const difference = (left, right) => left.filter((value) => !right.includes(value));

function walk(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') result.push(...walk(fullPath));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) result.push(fullPath);
  }
  return result;
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  return null;
}

function collectFrontendRpcs() {
  const names = [];
  const dynamicCalls = [];
  const shapeErrors = [];
  const argumentNames = new Map();
  const isRpcMember = (node) => (
    (ts.isPropertyAccessExpression(node) && node.name.text === 'rpc')
    || (ts.isElementAccessExpression(node)
      && ts.isStringLiteralLike(node.argumentExpression)
      && node.argumentExpression.text === 'rpc')
  );
  for (const file of walk(path.join(root, 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (propertyName(element.propertyName || element.name) === 'rpc') {
            shapeErrors.push(`RPC_DESTRUCTURING_FORBIDDEN ${path.relative(root, file)}`);
          }
        }
      }
      if (ts.isVariableDeclaration(node) && node.initializer && isRpcMember(node.initializer)) {
        shapeErrors.push(`RPC_ALIAS_FORBIDDEN ${path.relative(root, file)}`);
      }
      if (ts.isBinaryExpression(node) && isRpcMember(node.right)) {
        shapeErrors.push(`RPC_ALIAS_FORBIDDEN ${path.relative(root, file)}`);
      }
      if (ts.isBinaryExpression(node) && /\brpc\b/.test(node.left.getText(sourceFile))) {
        shapeErrors.push(`RPC_DESTRUCTURING_ASSIGNMENT_FORBIDDEN ${path.relative(root, file)}`);
      }
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        if (ts.isPropertyAccessExpression(expression)
          && expression.name.text === 'bind'
          && isRpcMember(expression.expression)) {
          shapeErrors.push(`RPC_BIND_FORBIDDEN ${path.relative(root, file)}`);
        }
        if (ts.isPropertyAccessExpression(expression)
          && expression.expression.getText(sourceFile) === 'Reflect'
          && expression.name.text === 'get'
          && node.arguments[1]
          && ts.isStringLiteralLike(node.arguments[1])
          && node.arguments[1].text === 'rpc') {
          shapeErrors.push(`RPC_REFLECT_GET_FORBIDDEN ${path.relative(root, file)}`);
        }
        if (isRpcMember(expression)) {
          const argument = node.arguments[0];
          if (argument && ts.isStringLiteralLike(argument)) {
            const name = argument.text;
            names.push(name);
            const params = node.arguments[1];
            let callArguments = [];
            if (params) {
              if (!ts.isObjectLiteralExpression(params)) {
                shapeErrors.push(`RPC_ARGUMENT_OBJECT_REQUIRED ${name} ${path.relative(root, file)}`);
              } else {
                for (const item of params.properties) {
                  if (!ts.isPropertyAssignment(item) && !ts.isShorthandPropertyAssignment(item)) {
                    shapeErrors.push(`RPC_ARGUMENT_DYNAMIC_MEMBER_FORBIDDEN ${name} ${path.relative(root, file)}`);
                    continue;
                  }
                  const key = propertyName(item.name);
                  if (!key) shapeErrors.push(`RPC_ARGUMENT_COMPUTED_MEMBER_FORBIDDEN ${name} ${path.relative(root, file)}`);
                  else callArguments.push(key);
                }
              }
            }
            callArguments = normalize(callArguments);
            const previous = argumentNames.get(name);
            argumentNames.set(name, normalize([...(previous || []), ...callArguments]));
          } else dynamicCalls.push(path.relative(root, file));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return {
    names: normalize(names),
    dynamicCalls: normalize(dynamicCalls),
    shapeErrors: normalize(shapeErrors),
    argumentNames: Object.fromEntries([...argumentNames.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function collectProxyPermissions() {
  const file = path.join(root, 'local-auth-server.mjs');
  const source = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let permissions = null;
  const shapeErrors = [];
  const readField = (object, field) => {
    const property = object.properties.find((item) => ts.isPropertyAssignment(item) && propertyName(item.name) === field);
    return property && ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer)
      ? property.initializer.text
      : null;
  };
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'RPC_PERMISSIONS'
      && node.initializer
      && ts.isObjectLiteralExpression(node.initializer)) {
      permissions = {};
      for (const item of node.initializer.properties) {
        if (!ts.isPropertyAssignment(item) || !ts.isObjectLiteralExpression(item.initializer)) {
          shapeErrors.push('RPC_PERMISSIONS_DYNAMIC_MEMBER_FORBIDDEN');
          continue;
        }
        const name = propertyName(item.name);
        if (!name) {
          shapeErrors.push('RPC_PERMISSIONS_COMPUTED_MEMBER_FORBIDDEN');
          continue;
        }
        permissions[name] = {
          module: readField(item.initializer, 'module'),
          action: readField(item.initializer, 'action'),
        };
      }
    }
    if (ts.isBinaryExpression(node)
      && ((ts.isPropertyAccessExpression(node.left)
          && ts.isIdentifier(node.left.expression)
          && node.left.expression.text === 'RPC_PERMISSIONS')
        || (ts.isElementAccessExpression(node.left)
          && ts.isIdentifier(node.left.expression)
          && node.left.expression.text === 'RPC_PERMISSIONS'))) {
      shapeErrors.push('RPC_PERMISSIONS_MUTATION_FORBIDDEN');
    }
    if (ts.isVariableDeclaration(node)
      && node.initializer
      && ts.isIdentifier(node.initializer)
      && node.initializer.text === 'RPC_PERMISSIONS') {
      shapeErrors.push('RPC_PERMISSIONS_ALIAS_FORBIDDEN');
    }
    if (ts.isBinaryExpression(node)
      && ts.isIdentifier(node.right)
      && node.right.text === 'RPC_PERMISSIONS') {
      shapeErrors.push('RPC_PERMISSIONS_ALIAS_FORBIDDEN');
    }
    if (ts.isDeleteExpression(node)
      && ((ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression)
          && node.expression.expression.text === 'RPC_PERMISSIONS')
        || (ts.isElementAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression)
          && node.expression.expression.text === 'RPC_PERMISSIONS'))) {
      shapeErrors.push('RPC_PERMISSIONS_DELETE_FORBIDDEN');
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const owner = node.expression.expression.getText(sourceFile);
      const method = node.expression.name.text;
      const mutator = (owner === 'Object' && ['assign', 'defineProperty', 'defineProperties'].includes(method))
        || (owner === 'Reflect' && ['set', 'deleteProperty', 'defineProperty'].includes(method));
      if (mutator && node.arguments[0]?.getText(sourceFile) === 'RPC_PERMISSIONS') {
        shapeErrors.push('RPC_PERMISSIONS_REFLECTIVE_MUTATION_FORBIDDEN');
      }
      if (owner === 'Reflect'
        && method === 'get'
        && node.arguments[0]?.getText(sourceFile) === 'RPC_PERMISSIONS') {
        shapeErrors.push('RPC_PERMISSIONS_REFLECTIVE_READ_FORBIDDEN');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!permissions) throw new Error('RPC_PERMISSIONS nao encontrado em local-auth-server.mjs');
  return { permissions, shapeErrors: normalize(shapeErrors) };
}

function collectRepositorySqlDefinitions() {
  const names = [];
  const migrations = path.join(root, 'supabase', 'migrations');
  for (const entry of fs.readdirSync(migrations, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) continue;
    const source = fs.readFileSync(path.join(migrations, entry.name), 'utf8');
    const expression = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(?:"?public"?)\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(/gi;
    for (const match of source.matchAll(expression)) names.push(match[1]);
  }
  return normalize(names);
}

async function validateRuntime(proxyNames, classifiedNames, forbiddenNames, frontendArgumentNames, report, errors) {
  const pool = new pg.Pool();
  try {
    const runtimeNames = normalize([...proxyNames, ...classifiedNames, ...forbiddenNames]);
    const result = await pool.query(
      `SELECT p.proname,
              pg_get_function_identity_arguments(p.oid) AS signature,
              p.prosecdef AS security_definer,
              COALESCE(p.proconfig, ARRAY[]::text[]) AS function_config,
              owner.rolname AS owner_name,
              owner.rolsuper AS owner_superuser,
              owner.rolbypassrls AS owner_bypassrls,
              p.proargnames AS argument_names,
              p.proargmodes AS argument_modes,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
              EXISTS (
                SELECT 1
                  FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
                 WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
              ) AS public_execute
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_roles owner ON owner.oid = p.proowner
        WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])
        ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)`,
      [runtimeNames],
    );
    const schemaAcl = await pool.query(
      `SELECT COALESCE(array_agg(COALESCE(grantee.rolname, 'PUBLIC')) FILTER (
                WHERE acl.privilege_type = 'CREATE' AND acl.grantee <> n.nspowner
              ), ARRAY[]::text[]) AS untrusted_create_roles
         FROM pg_namespace n
         CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) acl
         LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
        WHERE n.nspname = 'public'
        GROUP BY n.oid`,
    );
    const writableRoles = schemaAcl.rows[0]?.untrusted_create_roles || [];
    const publicSchemaWritable = writableRoles.length > 0;
    if (publicSchemaWritable) errors.push(`RUNTIME_PUBLIC_SCHEMA_WRITABLE roles=${writableRoles.join(',')}`);
    const byName = new Map();
    const observedSignatures = {};
    for (const row of result.rows) {
      const rows = byName.get(row.proname) || [];
      rows.push(row);
      byName.set(row.proname, rows);
      observedSignatures[row.proname] = [...(observedSignatures[row.proname] || []), row.signature];
    }
    const validateFunctionSafety = (name, row) => {
      if (!row.security_definer) return;
      if (row.owner_superuser || row.owner_bypassrls) errors.push(`RUNTIME_UNSAFE_FUNCTION_OWNER ${name} owner=${row.owner_name}`);
      const searchPath = row.function_config.find((setting) => setting.startsWith('search_path='));
      if (!searchPath) errors.push(`RUNTIME_SECURITY_DEFINER_SEARCH_PATH_MISSING ${name}`);
      else {
        const schemas = searchPath.slice('search_path='.length).split(',').map((item) => item.trim().replaceAll('"', ''));
        if (schemas.some((schema) => !['pg_catalog', 'public'].includes(schema))) errors.push(`RUNTIME_UNSAFE_SECURITY_DEFINER_SEARCH_PATH ${name} value=${searchPath}`);
        if (schemas.includes('public') && publicSchemaWritable) errors.push(`RUNTIME_WRITABLE_SCHEMA_IN_SECURITY_DEFINER_PATH ${name}`);
      }
    };
    const validateFrontendArguments = (name, row) => {
      const expected = frontendArgumentNames[name];
      if (!expected) return;
      const names = row.argument_names || [];
      const modes = row.argument_modes || names.map(() => 'i');
      const inputs = names.filter((_, index) => ['i', 'b', 'v'].includes(modes[index] || 'i'));
      for (const argument of expected) {
        if (!inputs.includes(argument)) errors.push(`RUNTIME_RPC_ARGUMENT_MISSING ${name} argument=${argument} signature=${row.signature}`);
      }
    };
    for (const name of proxyNames) {
      const rows = byName.get(name) || [];
      if (rows.length === 0) {
        errors.push(`RUNTIME_PROXY_RPC_MISSING ${name}`);
        continue;
      }
      if (rows.length > 1) errors.push(`RUNTIME_PROXY_RPC_OVERLOAD_UNDECLARED ${name} count=${rows.length}`);
      for (const row of rows) {
        const expectedSignature = allowlist.signatures?.[name];
        if (!expectedSignature) errors.push(`RUNTIME_SIGNATURE_CONTRACT_MISSING ${name} observed=${row.signature}`);
        else if (expectedSignature !== row.signature) {
          errors.push(`RUNTIME_SIGNATURE_DRIFT ${name} expected=${expectedSignature} actual=${row.signature}`);
        }
        validateFunctionSafety(name, row);
        validateFrontendArguments(name, row);
        if (row.public_execute) errors.push(`RUNTIME_PUBLIC_EXECUTE ${name}(${row.signature})`);
        if (!row.authenticated_execute) errors.push(`RUNTIME_AUTHENTICATED_EXECUTE_MISSING ${name}(${row.signature})`);
      }
    }
    for (const name of normalize([...classifiedNames, ...forbiddenNames])) {
      const rows = byName.get(name) || [];
      const classification = contract.classifications?.[name];
      if (classification?.status === 'candidate' && rows.length === 0) errors.push(`RUNTIME_CANDIDATE_RPC_MISSING ${name}`);
      if (rows.length > 1) errors.push(`RUNTIME_NONPROXY_RPC_OVERLOAD_UNDECLARED ${name} count=${rows.length}`);
      for (const row of rows) {
        validateFunctionSafety(name, row);
        validateFrontendArguments(name, row);
        if (row.public_execute || row.authenticated_execute || row.anon_execute) {
          errors.push(`RUNTIME_NONPROXY_RPC_EXPOSED ${name}(${row.signature})`);
        }
      }
    }
    report.runtimeCatalogFunctionCount = result.rows.length;
    report.runtimeClassifiedMissingCount = classifiedNames.filter((name) => !byName.has(name)).length;
    report.runtimeObservedSignatures = observedSignatures;
  } finally {
    await pool.end();
  }
}

const allowlist = readJson('scripts/rpc-allowlist.json');
const contract = readJson('scripts/rpc-contract.json');
const frontendInventory = collectFrontendRpcs();
const frontend = frontendInventory.names;
const proxyInventory = collectProxyPermissions();
const proxyPermissions = proxyInventory.permissions;
const proxy = normalize(Object.keys(proxyPermissions));
const sqlDefinitions = collectRepositorySqlDefinitions();
const snapshot = normalize(allowlist.functions || []);
const classified = normalize(Object.keys(contract.classifications || {}));
const forbidden = normalize(Object.keys(contract.forbiddenFrontendRpcs || {}));
const errors = [];

for (const file of frontendInventory.dynamicCalls) errors.push(`DYNAMIC_FRONTEND_RPC ${file}`);
errors.push(...frontendInventory.shapeErrors, ...proxyInventory.shapeErrors);
for (const name of forbidden) {
  if (frontend.includes(name)) errors.push(`FORBIDDEN_FRONTEND_RPC ${name}`);
  if (proxy.includes(name)) errors.push(`FORBIDDEN_PROXY_RPC ${name}`);
}
if (frontend.length !== contract.expectedFrontendCount) errors.push(`FRONTEND_COUNT_DRIFT expected=${contract.expectedFrontendCount} actual=${frontend.length}`);
if (proxy.length !== allowlist.expectedCount) errors.push(`PROXY_COUNT_DRIFT expected=${allowlist.expectedCount} actual=${proxy.length}`);
for (const name of difference(proxy, snapshot)) errors.push(`ALLOWLIST_SNAPSHOT_MISSING ${name}`);
for (const name of difference(snapshot, proxy)) errors.push(`ALLOWLIST_SNAPSHOT_STALE ${name}`);
for (const name of proxy) {
  const expected = allowlist.permissions?.[name];
  const actual = proxyPermissions[name];
  if (!expected) errors.push(`ALLOWLIST_PERMISSION_MISSING ${name}`);
  else if (expected.module !== actual.module || expected.action !== actual.action) {
    errors.push(`ALLOWLIST_PERMISSION_DRIFT ${name} expected=${expected.module}/${expected.action} actual=${actual.module}/${actual.action}`);
  }
}
for (const name of Object.keys(allowlist.permissions || {})) {
  if (!proxyPermissions[name]) errors.push(`ALLOWLIST_PERMISSION_STALE ${name}`);
}

const frontendGaps = difference(frontend, proxy);
if (frontendGaps.length !== contract.expectedClassifiedGapCount) errors.push(`CLASSIFIED_GAP_COUNT_DRIFT expected=${contract.expectedClassifiedGapCount} actual=${frontendGaps.length}`);
for (const name of difference(frontendGaps, classified)) errors.push(`UNCLASSIFIED_FRONTEND_RPC ${name}`);
for (const name of difference(classified, frontendGaps)) errors.push(`STALE_RPC_CLASSIFICATION ${name}`);
for (const name of frontend.filter((rpc) => !sqlDefinitions.includes(rpc))) errors.push(`REPOSITORY_SQL_DEFINITION_MISSING ${name}`);

const validStatuses = new Set(['candidate', 'contract_fix']);
const classificationCounts = { candidate: 0, contract_fix: 0, replacement_required: 0 };
for (const [name, entry] of Object.entries(contract.classifications || {})) {
  if (!validStatuses.has(entry.status)) errors.push(`INVALID_CLASSIFICATION_STATUS ${name}`);
  else classificationCounts[entry.status] += 1;
  if (!entry.module || !entry.action) errors.push(`INCOMPLETE_RPC_CLASSIFICATION ${name}`);
}
for (const [status, expected] of Object.entries(contract.expectedClassificationCounts || {})) {
  if (classificationCounts[status] !== expected) errors.push(`CLASSIFICATION_COUNT_DRIFT status=${status} expected=${expected} actual=${classificationCounts[status]}`);
}

const report = {
  mode: process.argv.includes('--runtime') ? 'runtime' : 'static',
  frontendRpcCount: frontend.length,
  dynamicFrontendRpcCount: frontendInventory.dynamicCalls.length,
  proxyAllowlistCount: proxy.length,
  proxyFrontendIntersectionCount: frontend.filter((rpc) => proxy.includes(rpc)).length,
  classifiedGapCount: frontendGaps.length,
  classificationCounts,
  forbiddenFrontendRpcCount: forbidden.length,
  repositorySqlDefinitionMissingCount: frontend.filter((rpc) => !sqlDefinitions.includes(rpc)).length,
  errors,
};

if (process.argv.includes('--runtime')) {
  await validateRuntime(proxy, classified, forbidden, frontendInventory.argumentNames, report, errors);
}
console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) process.exitCode = 1;

