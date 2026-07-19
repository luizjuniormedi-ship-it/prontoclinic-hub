import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.resolve(root, '..', 'docs', 'ai-execution', 'MVP_BASELINE_MANIFEST.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const errors = [];
const baselineEntries = manifest.entries ?? manifest.baseline_mvp?.selected_release_artifacts ?? [];
const artifactRoots = [path.resolve(root, '..', 'prontomedic-working'), root];
const resolveArtifact = (relativePath) => artifactRoots.map((candidate) => path.resolve(candidate, relativePath)).find((candidate) => fs.existsSync(candidate));
const entries = [...baselineEntries].sort((a, b) => a.order - b.order);
const names = new Set();
for (const entry of entries) {
  if (names.has(entry.path)) errors.push(`duplicate baseline path: ${entry.path}`);
  names.add(entry.path);
  if (/20251231/i.test(entry.path)) errors.push(`legacy stub entered baseline: ${entry.path}`);
  if (!resolveArtifact(entry.path)) errors.push(`missing baseline path: ${entry.path}`);
}
const baselineMigrations = manifest.baseline_mvp?.selected_migrations ?? [];
const actor = baselineMigrations.find((entry) => entry.path.endsWith('20260708090000_scheduling_phase1.sql'));
if (!actor) errors.push('get_scheduling_actor source is absent from baseline');
for (const entry of baselineMigrations) {
  const file = path.resolve(root, entry.path);
  if (!fs.existsSync(file)) continue;
  const sql = fs.readFileSync(file, 'utf8');
  if (/get_scheduling_actor\s*\(\)/i.test(sql) && !entry.path.endsWith('20260708090000_scheduling_phase1.sql') && actor && entry.order <= actor.order) {
    errors.push(`scheduling actor consumer precedes actor definition: ${entry.path}`);
  }
}
const result = {
  status: errors.length ? 'BLOCKED' : 'READY_WITH_REPLAY_PENDING',
  package_root: manifest.package_root,
  entry_count: entries.length,
  actor_order: actor?.order ?? null,
  errors,
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
