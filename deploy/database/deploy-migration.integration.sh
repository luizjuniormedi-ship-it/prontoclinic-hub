#!/usr/bin/env bash
set -Eeuo pipefail

database="${PRONTOMEDIC_DATABASE:-prontoclinic_dbdeploy}"
root="${PRONTOMEDIC_DB_INTEGRATION_ROOT:-/tmp/prontomedic-dbdeploy}"
sha="${PRONTOMEDIC_TEST_COMMIT_SHA:-$(git rev-parse HEAD)}"

[[ "$root" = /tmp/prontomedic-dbdeploy* ]] || {
  echo 'diretorio de integracao fora do prefixo descartavel permitido' >&2
  exit 1
}

if ! command -v flock >/dev/null 2>&1; then
  [[ "${PRONTOMEDIC_DB_TEST_MODE:-0}" == "1" ]] || {
    echo 'flock e obrigatorio fora do modo de teste' >&2
    exit 1
  }
  flock() { return 0; }
  export -f flock
fi

contracts=(
  '20260804033225|secure_companies_units_admin_contract|20260802183000|inverse|smoke'
  '20260804143000|rbac_active_context_aal2|20260804033225|inverse|rbac'
  '20260805123000|auth_admin_suspension_invariants|20260804143000|inverse|auth-admin'
  '20260811120000|reception_worklist_handoff|20260805123000|inverse|worklist-handoff'
  '20260811210000|dicom_worklist_rls_hardening|20260811120000|forward_only|dicom-hardening'
  '20260812021457|pharmacy_runtime_closure|20260811210000|preserve_schema|pharmacy'
  '20260812150000|medical_attendance_atomic_completion|20260812021457|preserve_schema|medical-attendance'
)

cleanup() {
  if [[ "${PRONTOMEDIC_KEEP_TEST_DATABASE:-0}" != "1" ]]; then
    dropdb --if-exists "$database" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

rm -rf "$root"
dropdb --if-exists "$database"
createdb "$database"
REPLAY_STOP_BEFORE=20260804033225_secure_companies_units_admin_contract.sql \
  scripts/replay-migrations.sh "$database"

psql -X -v ON_ERROR_STOP=1 -d "$database" <<'SQL'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[] NOT NULL DEFAULT '{}',
  name text NOT NULL DEFAULT ''
);
INSERT INTO supabase_migrations.schema_migrations(version, name)
VALUES ('20260802183000', 'ci_predecessor') ON CONFLICT DO NOTHING;
SQL

for contract in "${contracts[@]}"; do
  IFS='|' read -r version name predecessor rollback_mode smoke_prefix <<<"$contract"
  export PRONTOMEDIC_DATABASE="$database"
  export PRONTOMEDIC_DB_BACKUP_ROOT="$root/$version/backups"
  export PRONTOMEDIC_DB_STATE_ROOT="$root/state"
  export PRONTOMEDIC_GLOBAL_DEPLOY_LOCK="$root/global.lock"
  stage="$root/$version/stage"
  bundle="$root/$version/database-${sha}.tgz"
  checksum="${bundle}.sha256"
  install -d "$stage"
  cp "supabase/migrations/${version}_${name}.sql" "$stage/migration.sql"
  cp "supabase/rollbacks/${version}_${name}.sql" "$stage/rollback.sql"
  cp "deploy/database/${smoke_prefix}-before.sql" "$stage/smoke-before.sql"
  cp "deploy/database/${smoke_prefix}-applied.sql" "$stage/smoke-applied.sql"
  cp "deploy/database/${smoke_prefix}-rollback.sql" "$stage/smoke-rollback.sql"
  node - "$stage" "$sha" "$version" "$name" "$predecessor" "$rollback_mode" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [stage, commitSha, migrationVersion, migrationName, predecessorVersion, rollbackMode] = process.argv.slice(2);
const files = {};
for (const file of ['migration.sql', 'rollback.sql', 'smoke-before.sql', 'smoke-applied.sql', 'smoke-rollback.sql']) {
  files[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(stage, file))).digest('hex');
}
fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify({
  schemaVersion: 2, commitSha, migrationVersion, migrationName,
  predecessorVersion, rollbackMode, files
}, null, 2) + '\n');
NODE
  tar -C "$stage" -czf "$bundle" .
  (cd "$(dirname "$bundle")" && sha256sum "$(basename "$bundle")" > "$(basename "$checksum")")
  bash deploy/database/deploy-migration.sh audit
  bash deploy/database/deploy-migration.sh preflight "$sha" "$bundle" "$checksum"
  bash deploy/database/deploy-migration.sh deploy "$sha" "$bundle" "$checksum"
  if bash deploy/database/deploy-migration.sh preflight "$sha" "$bundle" "$checksum"; then
    echo "migration aplicada aceitou novo preflight: $version" >&2
    exit 1
  fi
done

bash deploy/database/deploy-migration.sh rollback
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260812150000'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260812021457'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260811210000'" -d "$database")" = 1
# shellcheck disable=SC1090
. "$root/state/last-deploy.env"
test "$MIGRATION_VERSION" = 20260812021457
bash deploy/database/deploy-migration.test.sh
echo "DATABASE_DEPLOY_INTEGRATION_PASS"
