import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const manifestPath = path.resolve(root, '..', 'docs', 'ai-execution', 'MVP_BASELINE_MANIFEST.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const errors = [];
const contentChecks = [];
const orders = new Set();
const entries = manifest.entries ?? manifest.baseline_mvp?.selected_migrations ?? [];
const sourceRoots = [path.resolve(root, '..', 'prontomedic-working'), root];
for (const entry of entries) {
  if (orders.has(entry.order)) errors.push(`duplicate order: ${entry.order}`);
  orders.add(entry.order);
  if (entry.status && !['APLICÁVEL', 'ADAPTAR', 'MVP_CANDIDATE'].includes(entry.status)) errors.push(`baseline entry not releasable: ${entry.path}`);
  for (const dependency of entry.depends_on ?? []) if (!orders.has(dependency)) errors.push(`${entry.path} depends on future/missing order ${dependency}`);
  const candidates = sourceRoots.map((sourceRoot) => path.resolve(sourceRoot, entry.path)).filter((candidate) => fs.existsSync(candidate));
  const absolute = candidates.find((candidate) => entry.sha256 && crypto.createHash('sha256').update(fs.readFileSync(candidate)).digest('hex').toUpperCase() === entry.sha256.toUpperCase()) ?? candidates[0];
  if (!absolute) errors.push(`baseline artifact missing: ${entry.path}`);
  else {
    if (entry.sha256) {
      const actual = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex').toUpperCase();
      if (actual !== entry.sha256.toUpperCase()) errors.push(`baseline hash mismatch: ${entry.path}`);
    } else errors.push(`baseline hash missing: ${entry.path}`);
    const sql = fs.readFileSync(absolute, 'utf8');
    if (entry.path.endsWith('007_mvp_operational_tables.sql')) {
      for (const pattern of [/CREATE TABLE public\.medical_records/i, /CREATE TABLE public\.billings/i, /billings_company_appointment_fkey/i, /appointments_company_id_id_key/i]) {
        if (!pattern.test(sql)) errors.push(`operational baseline assertion missing in ${entry.path}: ${pattern}`);
      }
      contentChecks.push({ path: entry.path, assertions: ['CREATE TABLE medical_records', 'CREATE TABLE billings', 'billing composite FK', 'appointments tenant key'] });
    }
    if (entry.path.endsWith('008_canonical_insurance.sql')) {
      for (const pattern of [/CREATE TABLE public\.insurance_authorizations/i, /CREATE TABLE public\.insurance_eligibility_checks/i, /insurance_plan_id INTEGER/i]) {
        if (!pattern.test(sql)) errors.push(`canonical assertion missing in ${entry.path}: ${pattern}`);
      }
      contentChecks.push({ path: entry.path, assertions: ['CREATE TABLE insurance_authorizations', 'CREATE TABLE insurance_eligibility_checks', 'insurance_plan_id INTEGER'] });
    }
    if (entry.path.endsWith('014_tenant_policy_replacements.sql')) {
      if (/USING\s*\(\s*true\s*\)/i.test(sql)) errors.push(`tenant policy artifact contains USING(true): ${entry.path}`);
      if (!/get_my_company_id/i.test(sql)) errors.push(`tenant helper missing in ${entry.path}`);
      contentChecks.push({ path: entry.path, assertions: ['no USING(true)', 'get_my_company_id'] });
    }
    if (entry.path.endsWith('016_service_only_password_resets.sql')) {
      if (!/TO\s+service_role/i.test(sql)) errors.push(`password reset policy is not service-only: ${entry.path}`);
      contentChecks.push({ path: entry.path, assertions: ['TO service_role'] });
    }
  }
}
for (const gate of manifest.required_gates) {
  const absolute = path.resolve(root, gate.startsWith('validate-') ? `scripts/${gate}` : `supabase/tests/${gate}`);
  if (!fs.existsSync(absolute)) errors.push(`required gate missing: ${gate}`);
}
const result = { status: errors.length ? 'BLOCKED' : (manifest.status ?? 'READY'), source_inventory: manifest.source_inventory ?? manifest.inventory_status, baseline_entries: entries.length, content_checks: contentChecks, errors };
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
