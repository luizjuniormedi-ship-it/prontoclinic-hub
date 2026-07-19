import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const releaseRoot = path.resolve(projectRoot, '..', 'prontomedic-working');
const migrationRoot = path.join(releaseRoot, 'supabase', 'migrations');
const expectedCount = 71;

if (!fs.existsSync(migrationRoot)) throw new Error(`release migration root missing: ${migrationRoot}`);
const names = fs.readdirSync(migrationRoot)
  .filter((name) => name.endsWith('.sql'))
  .sort();
if (names.length !== expectedCount) {
  throw new Error(`release inventory mismatch: expected ${expectedCount}, found ${names.length}`);
}

const legacyName = /(?:stub|cleanup|drop_|more_columns|_pre_apply|replace_demo)/i;
const dependencyRules = [
  ['20260708090000_scheduling_phase1.sql', ['20251231010000_add_user_profile_user_id.sql', '20260101001200_security_hardening.sql']],
  ['20260708093000_call_center_phase1.sql', ['20260708090000_scheduling_phase1.sql']],
  ['20260709210000_scheduling_operations.sql', ['20260708090000_scheduling_phase1.sql']],
  ['20260709223000_scheduling_requirements.sql', ['20260709210000_scheduling_operations.sql']],
  ['20260709232000_scheduling_confirmations.sql', ['20260709210000_scheduling_operations.sql']],
  ['20260709235000_reception_checkin_core.sql', ['20260710000050_reception_insurance_canonical_foundation.sql']],
  ['20260710001000_reception_authorization_center.sql', ['20260710000050_reception_insurance_canonical_foundation.sql']],
  ['20260710004000_insurance_authoritative_ledgers.sql', ['20260710000050_reception_insurance_canonical_foundation.sql']],
  ['20260710193000_insurance_contract_rules_foundation.sql', ['20260710000050_reception_insurance_canonical_foundation.sql']],
  ['20260710213000_tiss_operational_compatibility.sql', ['20260101000010_tiss.sql']],
  ['20260710220000_auth_function_hardening.sql', ['20260101001200_security_hardening.sql']],
];

const manifest = names.map((name, index) => {
  const sql = fs.readFileSync(path.join(migrationRoot, name), 'utf8');
  const reasons = [];
  let status = 'APLICÁVEL';
  if (legacyName.test(name)) {
    status = 'LEGACY';
    reasons.push('legacy preparatory/stub/cleanup migration');
  }
  if (/USING\s*\(\s*true\s*\)/i.test(sql)) {
    status = 'BLOQUEADA';
    reasons.push('RLS policy USING(true) requires tenant-scoped replacement');
  }
  if (/20260710010000_centralize|centralize_insurance_records/i.test(name)) {
    status = 'LEGACY';
    reasons.push('legacy rename/view strategy conflicts with canonical insurance tables');
  }
  if (/20260710213000_tiss_operational_compatibility/i.test(name) && /\bUPDATE\b/i.test(sql)) {
    status = 'BLOQUEADA';
    reasons.push('contains data update/backfill; no automatic approximation');
  }
  if (/REFERENCES\s+public\.reception_(?:authorizations|eligibility_checks)/i.test(sql)
    || /CREATE\s+TRIGGER[\s\S]{0,240}\bON\s+public\.reception_(?:authorizations|eligibility_checks)/i.test(sql)) {
    status = 'BLOQUEADA';
    reasons.push('FK/trigger targets reception_* view instead of canonical insurance_* table');
  }
  const dependencies = dependencyRules.find(([file]) => file === name)?.[1] || [];
  for (const dependency of dependencies) {
    if (!names.includes(dependency)) reasons.push(`missing dependency: ${dependency}`);
  }
  if (dependencies.some((dependency) => !names.includes(dependency))) status = 'BLOQUEADA';
  return { order: index + 1, name, status, dependencies, reasons };
});

const result = {
  source: releaseRoot,
  inventory_count: names.length,
  status: manifest.some((entry) => entry.status === 'BLOQUEADA') ? 'BLOCKED' : 'REVIEW',
  applicable_count: manifest.filter((entry) => entry.status === 'APLICÁVEL').length,
  blocked_count: manifest.filter((entry) => entry.status === 'BLOQUEADA').length,
  legacy_count: manifest.filter((entry) => entry.status === 'LEGACY').length,
  policy_using_true: manifest.filter((entry) => entry.reasons.some((reason) => reason.includes('USING(true)'))).map((entry) => entry.name),
  migrations: manifest,
};
console.log(JSON.stringify(result, null, 2));
if (result.inventory_count !== expectedCount) process.exitCode = 1;
