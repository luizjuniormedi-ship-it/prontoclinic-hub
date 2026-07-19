import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const releaseRoot = path.resolve(root, '..', 'prontomedic-working', 'supabase', 'migrations');
const manifestPath = path.resolve(root, '..', 'docs', 'ai-execution', 'MVP_BASELINE_MANIFEST.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const baselineEntries = manifest.entries ?? manifest.baseline_mvp?.selected_release_artifacts ?? [];
const artifactRoots = [path.resolve(root, '..', 'prontomedic-working'), root];
const resolveArtifact = (relativePath) => artifactRoots.map((candidate) => path.resolve(candidate, relativePath)).find((candidate) => fs.existsSync(candidate)) ?? path.resolve(root, relativePath);
const names = fs.readdirSync(releaseRoot).filter((name) => name.endsWith('.sql')).sort();
const expectedLegacy20251231 = [
  '20251231001000_drop_lgpd_stub_tables.sql',
  '20251231003000_create_medical_records_stub.sql',
  '20251231004000_cleanup_lgpd_pre_apply.sql',
  '20251231005000_create_billings_stub.sql',
  '20251231006000_cleanup_tiss_pre_apply.sql',
  '20251231009000_drop_bad_indexes.sql',
  '20251231012000_create_cid_salas_stubs.sql',
  '20251231013000_more_columns.sql',
  '20251231014000_more_columns_v2.sql',
];
const errors = [];
if (names.length !== 71) errors.push(`expected 71 migrations, found ${names.length}`);
for (const name of expectedLegacy20251231) if (!names.includes(name)) errors.push(`missing declared legacy: ${name}`);
const legacy = names.filter((name) => /(?:stub|cleanup|drop_|more_columns|replace_demo|centralize_insurance)/i.test(name));
const usingTrue = [];
for (const name of names) {
  const sql = fs.readFileSync(path.join(releaseRoot, name), 'utf8');
  if (/USING\s*\(\s*true\s*\)/i.test(sql)) usingTrue.push(name);
}
const baselineFilesRead = [];
const baselineErrors = [];
for (const entry of baselineEntries) {
  const absolute = resolveArtifact(entry.path);
  if (!fs.existsSync(absolute)) {
    baselineErrors.push(`baseline artifact missing: ${entry.path}`);
    continue;
  }
  const sql = fs.readFileSync(absolute, 'utf8');
  baselineFilesRead.push(entry.path);
  if (entry.path.endsWith('007_mvp_operational_tables.sql')) {
    for (const pattern of [/CREATE TABLE public\.medical_records/i, /CREATE TABLE public\.billings/i, /billings_company_appointment_fkey/i, /appointments_company_id_id_key/i]) {
      if (!pattern.test(sql)) baselineErrors.push(`operational baseline content missing: ${entry.path}`);
    }
  }
  if (entry.path.endsWith('008_canonical_insurance.sql')) {
    for (const pattern of [/CREATE TABLE public\.insurance_authorizations/i, /CREATE TABLE public\.insurance_eligibility_checks/i, /insurance_plan_id INTEGER/i]) {
      if (!pattern.test(sql)) baselineErrors.push(`canonical content missing: ${entry.path}`);
    }
  }
  if (entry.path.endsWith('014_tenant_policy_replacements.sql') && /USING\s*\(\s*true\s*\)/i.test(sql)) {
    baselineErrors.push(`baseline tenant policy contains USING(true): ${entry.path}`);
  }
}
const result = {
  status: errors.length || usingTrue.length || baselineErrors.length ? 'BLOCKED' : 'REVIEW',
  inventory_count: names.length,
  baseline_manifest_entries: baselineEntries.length,
  baseline_files_read: baselineFilesRead.length,
  legacy_20251231: expectedLegacy20251231,
  legacy_all: legacy,
  using_true_blocked: usingTrue,
  errors: [...errors, ...baselineErrors],
};
console.log(JSON.stringify(result, null, 2));
if (errors.length || usingTrue.length || baselineErrors.length) process.exitCode = 1;
