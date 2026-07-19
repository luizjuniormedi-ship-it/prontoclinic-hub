import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationRoot = path.join(root, 'supabase', 'migrations');
const files = fs.readdirSync(migrationRoot).filter((name) => name.endsWith('.sql')).sort();
const coordinatorRoot = path.resolve(root, '..');
const coordinatorFiles = fs.existsSync(coordinatorRoot)
  ? fs.readdirSync(coordinatorRoot).filter((name) => /^\d{14}_.+\.sql$/.test(name))
  : [];
const allNames = [...new Set([...files, ...coordinatorFiles])].sort();
const index = new Map(allNames.map((name, i) => [name, i]));
const errors = [];

function before(a, b, reason) {
  if (index.has(a) && index.has(b) && index.get(a) >= index.get(b)) {
    errors.push(`${a} deve vir antes de ${b}: ${reason}`);
  }
}

before('20251231010000_add_user_profile_user_id.sql', '20260708090000_scheduling_phase1.sql', 'get_scheduling_actor usa user_profiles.user_id');
before('20260101001200_security_hardening.sql', '20260711090000_base_tables_rls_tenant_hardening.sql', 'RLS usa get_my_company_id');
before('20260708090000_scheduling_phase1.sql', '20260711090000_base_tables_rls_tenant_hardening.sql', 'RLS usa get_scheduling_actor');
before('20260710000050_reception_insurance_canonical_foundation.sql', '20260710001000_reception_authorization_center.sql', 'funcoes legacy exigem relacoes canonicas');
before('20260710000050_reception_insurance_canonical_foundation.sql', '20260710004000_insurance_authoritative_ledgers.sql', 'triggers de historico exigem relacoes canonicas');
before('20260710004000_insurance_authoritative_ledgers.sql', '20260710010000_centralize_insurance_records.sql', 'centralizacao nao deve renomear apos triggers');
before('20260711090000_base_tables_rls_tenant_hardening.sql', '20260711140000_rls_owner_bypass_hardening.sql', 'owner/BYPASSRLS hardening deve vir depois do RLS base');
before('20260711130000_billing_appointment_tenant_constraint.sql', '20260711150000_billing_tenant_composite_fk.sql', 'FK composta depende do contrato billing inicial');

if (!index.has('20260710000050_reception_insurance_canonical_foundation.sql')) {
  errors.push('migration P0 ausente: 20260710000050_reception_insurance_canonical_foundation.sql');
}

const sql = [
  ...files.map((name) => fs.readFileSync(path.join(migrationRoot, name), 'utf8')),
  ...coordinatorFiles.map((name) => fs.readFileSync(path.join(coordinatorRoot, name), 'utf8')),
].join('\n');
if ((sql.match(/CREATE TABLE(?: IF NOT EXISTS)?\s+public\.reception_authorizations/gi) || []).length > 0) {
  errors.push('reception_authorizations nao deve ter tabela fisica duplicada');
}
if ((sql.match(/CREATE TABLE(?: IF NOT EXISTS)?\s+public\.reception_eligibility_checks/gi) || []).length > 0) {
  errors.push('reception_eligibility_checks nao deve ter tabela fisica duplicada');
}
if (/REFERENCES\s+public\.reception_(?:authorizations|eligibility_checks)/i.test(sql)) {
  errors.push('FK nao pode apontar para views reception_*');
}
if (/CREATE\s+TRIGGER[\s\S]{0,240}\bON\s+public\.reception_(?:authorizations|eligibility_checks)/i.test(sql)) {
  errors.push('trigger de historico nao pode ser criado sobre views reception_*');
}
if (/INSERT\s+INTO\s+public\.(?:insurance_authorization_history|insurance_eligibility_history)/i.test(sql)) {
  errors.push('migration de ledger nao pode executar backfill automatico');
}

console.log(JSON.stringify({
  project_migration_count: files.length,
  coordinator_candidate_count: coordinatorFiles.length,
  errors,
  order: allNames.filter((name) => /reception|insurance|rls|scheduling/.test(name)),
}, null, 2));
if (errors.length) process.exitCode = 1;
