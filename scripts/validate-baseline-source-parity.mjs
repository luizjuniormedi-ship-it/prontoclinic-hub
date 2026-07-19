import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(process.cwd(), '..');
const projectRoot = path.join(root, 'prontoclinic-hub');
const russellRoot = path.join(root, 'prontomedic-working');
const names = [
  '008_canonical_insurance.sql',
  '014_tenant_policy_replacements.sql',
  '016_service_only_password_resets.sql',
];

const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const results = names.map((name) => {
  const project = path.join(projectRoot, 'supabase', 'release-mvp', name);
  const russell = path.join(russellRoot, 'supabase', 'release-mvp', name);
  const exists = fs.existsSync(project) && fs.existsSync(russell);
  const projectSha256 = fs.existsSync(project) ? hash(project) : null;
  const russellSha256 = fs.existsSync(russell) ? hash(russell) : null;
  return { name, projectSha256, russellSha256, equal: exists && projectSha256 === russellSha256 };
});
const output = { status: results.every((item) => item.equal) ? 'READY' : 'BLOCKED', source: 'project-review-vs-russell-release-mvp', files: results };
console.log(JSON.stringify(output, null, 2));
if (output.status !== 'READY') process.exitCode = 1;
