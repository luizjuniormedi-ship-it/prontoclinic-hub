#!/usr/bin/env bash
set -Eeuo pipefail

helper="${BASH_SOURCE[0]%/*}/deploy-migration.sh"
workflow="${BASH_SOURCE[0]%/*}/../../.github/workflows/deploy-database-migration.yml"
auth_workflow="${BASH_SOURCE[0]%/*}/../../.github/workflows/deploy-edge-functions.yml"
rollback="${BASH_SOURCE[0]%/*}/../../supabase/rollbacks/20260804033225_secure_companies_units_admin_contract.sql"

bash -n "$helper"
test -f "$workflow"
test -f "$auth_workflow"
test -f "$rollback"
grep -Fq 'PRONTOMEDIC_GLOBAL_DEPLOY_LOCK' "$helper"
grep -Fq 'exec 9>"$global_lock"' "$helper"
test "$(grep -Fc 'group: prontomedic-production-deploy' "$workflow")" = 1
test "$(grep -Fc 'group: prontomedic-production-deploy' "$auth_workflow")" = 1
grep -Fq 'pg_dump -Fc' "$helper"
grep -Fq 'pg_restore --exit-on-error' "$helper"
grep -Fq 'supabase_migrations.schema_migrations' "$helper"
grep -Fq 'rollback_on_error' "$helper"
grep -Fq 'history_absent' "$helper"
grep -Fq 'history_present' "$helper"
grep -Fq 'merge-base --is-ancestor' "$workflow"
grep -Fq 'environment: Production' "$workflow"
grep -Fq '/etc/sudoers.d/prontomedic-db-deploy' "$workflow"
grep -Fq '/usr/sbin/visudo -cf' "$workflow"
grep -Eq '^[[:space:]]*BEGIN;' "$rollback"
grep -Eq '^[[:space:]]*COMMIT;' "$rollback"
! grep -Fq 'prontomedic-auth-deploy' "$workflow"
! grep -Fq 'prontomedic-edge-deploy' "$workflow"

echo 'DATABASE_DEPLOY_STATIC_CONTRACT_PASS'
