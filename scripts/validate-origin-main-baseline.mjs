#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const strict = args.has("--strict");
const rootArg = process.argv.find((value) => value.startsWith("--root="));
const root = path.resolve(rootArg ? rootArg.slice("--root=".length) : process.cwd());
const migrationsDir = path.join(root, "supabase", "migrations");
const sourceDirs = [path.join(root, "src"), path.join(root, "supabase", "functions")];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function collectMigrations() {
  const files = walk(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => ({ file, name: path.basename(file) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const timestamps = new Map();
  for (const migration of files) {
    const timestamp = migration.name.match(/^(\d{14})/i)?.[1];
    if (!timestamp) continue;
    const list = timestamps.get(timestamp) ?? [];
    list.push(migration.name);
    timestamps.set(timestamp, list);
  }
  const duplicateTimestamps = [...timestamps.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([timestamp, names]) => ({ timestamp, names }));
  return { files, duplicateTimestamps };
}

function collectSqlContracts(files) {
  const functions = new Set();
  const policies = [];
  for (const { file } of files) {
    const sql = readText(file);
    for (const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:[\w$]+\.)?([\w$]+)/gi)) {
      functions.add(match[1].toLowerCase());
    }
    for (const match of sql.matchAll(/create\s+policy\s+([\w$-]+)[\s\S]{0,800}?using\s*\(\s*true\s*\)/gi)) {
      policies.push({ name: match[1], file: relative(file) });
    }
  }
  return { functions: [...functions].sort(), policies };
}

function collectRpcCalls() {
  const calls = new Map();
  for (const dir of sourceDirs) {
    for (const file of walk(dir).filter((candidate) => /\.(ts|tsx|js|mjs)$/.test(candidate))) {
      const source = readText(file);
      for (const match of source.matchAll(/\.rpc\(\s*["']([a-zA-Z0-9_]+)["']/g)) {
        const name = match[1].toLowerCase();
        const callers = calls.get(name) ?? new Set();
        callers.add(relative(file));
        calls.set(name, callers);
      }
    }
  }
  return [...calls.entries()]
    .map(([name, callers]) => ({ name, callers: [...callers].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const { files, duplicateTimestamps } = collectMigrations();
const { functions, policies } = collectSqlContracts(files);
const calls = collectRpcCalls();
const functionSet = new Set(functions);
const unresolvedRpcCalls = calls.filter((call) => !functionSet.has(call.name));
const result = {
  status: strict && (duplicateTimestamps.length > 0 || unresolvedRpcCalls.length > 0) ? "BLOCKED" : "REVIEW",
  root,
  migration_count: files.length,
  duplicate_migration_timestamps: duplicateTimestamps,
  sql_function_count: functions.length,
  frontend_rpc_call_count: calls.length,
  unresolved_rpc_calls: unresolvedRpcCalls,
  using_true_policies: policies,
  notes: [
    "Ausência de uma função SQL exige reconciliação de contrato; este script não cria migrations automaticamente.",
    "USING(true) é inventariado para revisão; este script não classifica nem altera policies.",
    "Replay PostgreSQL, grants efetivos e isolamento multiempresa exigem banco descartável ou ambiente autorizado.",
  ],
};

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`origin-main baseline: ${result.status}`);
  console.log(`migrations: ${result.migration_count}`);
  console.log(`SQL functions: ${result.sql_function_count}`);
  console.log(`frontend RPC calls: ${result.frontend_rpc_call_count}`);
  console.log(`unresolved RPC calls: ${result.unresolved_rpc_calls.length}`);
  for (const call of result.unresolved_rpc_calls) console.log(`  - ${call.name}: ${call.callers.join(", ")}`);
  console.log(`USING(true) policies for review: ${result.using_true_policies.length}`);
}

if (strict && result.status === "BLOCKED") process.exitCode = 2;
