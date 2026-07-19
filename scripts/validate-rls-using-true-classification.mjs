import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  ...fs.readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => path.join(root, 'supabase', 'migrations', name)),
  path.join(root, 'supabase', 'release-mvp', '016_service_only_password_resets.sql'),
];
const expected = new Set([
  'mnct_classificacao_risco', 'mnct_fluxograma', 'exames_lab_catalogo',
  'exames_lab_valor_referencia', 'exames_lab_pedido', 'exames_lab_pedido_itens',
  'exames_lab_resultado', 'exames_lab_alerta_critico', 'pre_cadastro',
  'nps_respostas', 'notification_templates', 'password_resets',
]);
const hits = [];
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const re = /(?:ON\s+public\.([a-z_][a-z0-9_]*)\s+)?[^;\n]*?(?:USING|WITH\s+CHECK)\s*\(\s*true\s*\)/gi;
  for (const match of text.matchAll(re)) {
    if (match[1]) hits.push({ file: path.relative(root, file), object: match[1] });
  }
}
const unknown = [...new Set(hits.map((hit) => hit.object))].filter((name) => !expected.has(name));
const result = { status: unknown.length ? 'BLOCKED' : 'READY', occurrences: hits.length, objects: [...new Set(hits.map((hit) => hit.object))].sort(), unknown_objects: unknown };
console.log(JSON.stringify(result, null, 2));
if (unknown.length) process.exitCode = 1;
