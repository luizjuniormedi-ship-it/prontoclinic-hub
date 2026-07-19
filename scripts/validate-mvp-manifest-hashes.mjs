import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.resolve(root, '..', 'docs', 'ai-execution', 'MVP_BASELINE_MANIFEST.json'), 'utf8'));
const baselineEntries = manifest.entries ?? manifest.baseline_mvp?.selected_release_artifacts ?? [];
const artifactRoots = [path.resolve(root, '..', 'prontomedic-working'), root];
const resolveArtifact = (relativePath) => artifactRoots.map((candidate) => path.resolve(candidate, relativePath)).find((candidate) => fs.existsSync(candidate));
const results = baselineEntries.map((entry) => {
  const file = resolveArtifact(entry.path);
  const exists = Boolean(file);
  const actual = exists ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase() : null;
  return { order: entry.order, path: entry.path, expected: entry.sha256 || null, actual, equal: exists && actual === (entry.sha256 || '').toUpperCase() };
});
const result = { status: results.every((item) => item.equal) ? 'READY' : 'BLOCKED', algorithm: manifest.hash_algorithm, entries: results };
console.log(JSON.stringify(result, null, 2));
if (result.status !== 'READY') process.exitCode = 1;
