import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const serverCandidates = [
  path.join(root, 'local-auth-server.mjs'),
  path.join(root, '..', 'local-auth-server.mjs'),
];
const serverPath = serverCandidates.find((candidate) => fs.existsSync(candidate));
if (!serverPath) throw new Error('local-auth-server.mjs ausente no projeto ou workspace coordenador');

function filesUnder(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(full));
    else if (/\.(ts|tsx)$/.test(full) && !full.includes('__tests__')) result.push(full);
  }
  return result;
}

const source = filesUnder(srcRoot).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const server = fs.readFileSync(serverPath, 'utf8');
const frontend = new Set([...source.matchAll(/(?:supabase\.)?rpc\(\s*["']([^"']+)["']/gi)].map((m) => m[1]));
const allowed = new Set([...server.matchAll(/^\s{2}([A-Za-z0-9_]+): \{ module:/gm)].map((m) => m[1]));
const missing = [...frontend].filter((name) => !allowed.has(name)).sort();
const result = { frontend_count: frontend.size, proxy_allowlist_count: allowed.size, missing };
console.log(JSON.stringify(result, null, 2));
if (missing.length) process.exitCode = 1;
