#!/usr/bin/env bash
set -Eeuo pipefail

script="${BASH_SOURCE[0]%/*}/deploy-functions.sh"
workflow="${BASH_SOURCE[0]%/*}/../../.github/workflows/deploy-edge-functions.yml"
frontend_workflow="${BASH_SOURCE[0]%/*}/../../.github/workflows/deploy-frontend-vps.yml"
nginx_installer="${BASH_SOURCE[0]%/*}/install-nginx-routes.sh"

line_number=0
trap_line=""
release_line=""
cleanup_found=0
activation_found=0
audit_mode_found=0
nginx_contract_found=0
rpc_contract_found=0
while IFS= read -r line; do
  line_number=$((line_number + 1))
  case "$line" in
    'trap rollback ERR') trap_line="$line_number" ;;
    'mkdir "$release"') release_line="$line_number" ;;
    *'rm -rf -- "$release"'*) cleanup_found=1 ;;
    'activated=1') activation_found=1 ;;
    *'--audit-contract'*) audit_mode_found=1 ;;
    *'location = /functions/v1/${route}'*) nginx_contract_found=1 ;;
    *'public.current_context_is_company_admin(uuid)'*) rpc_contract_found=1 ;;
  esac
done < "$script"

test -n "$trap_line"
test -n "$release_line"
test "$trap_line" -lt "$release_line"
test "$cleanup_found" = "1"
test "$activation_found" = "1"
test "$audit_mode_found" = "1"
test "$nginx_contract_found" = "1"
test "$rpc_contract_found" = "1"
grep -Fq 'PRONTOMEDIC_GLOBAL_DEPLOY_LOCK:-/var/lock/prontomedic-deploy.lock' "$script"
! grep -Fq '${root}/.deploy.lock' "$script"
grep -Fq 'bootstrap_helper:' "$workflow"
grep -Fq 'sha256sum -c "$(basename "$checksum")"' "$workflow"
grep -Fq 'cp -a "$target" "$backup_dir/prontomedic-edge-deploy-${stamp}"' "$workflow"
grep -Fq 'mv -Tf "${target}.next" "$target"' "$workflow"
grep -Fq 'for attempt in $(seq 1 60)' "$script"
grep -Fq 'docker compose -f "$compose" logs --tail=200 functions' "$script"
grep -Fq 'Edge Runtime nao ficou saudavel apos 120 segundos' "$script"
grep -Fq 'test "$auth_status" = "401"' "$script"
grep -Fq 'supabase/functions/pre-cadastro/index.ts' "$script"
grep -Fq 'PRE_CADASTRO_TOKEN_SECRET' "$script"
grep -Fq 'for function_name in _shared auth-admin dicom-bridge telemedicina-daily pre-cadastro' "$script"
grep -Fq 'nginx_config="$(/usr/sbin/nginx -T 2>&1)"' "$script"
grep -Fq '"${PUBLIC_URL}/functions/v1/${function_name}" || true)' "$workflow"
grep -Fq 'install-nginx-routes.sh' "$workflow"
grep -Fq 'cp -a "$route_target" "$backup_dir/routes.conf"' "$nginx_installer"
grep -Fq 'cp -a "$route_target" "${route_target}.next"' "$nginx_installer"
grep -Fq 'Rota pre-cadastro nao gerenciada ja existe' "$nginx_installer"
! grep -Fq 'install -o root -g root -m 0644 "$route_source" "${route_target}.next"' "$nginx_installer"
grep -Fq 'trap restore ERR' "$nginx_installer"
grep -Fq '/usr/sbin/nginx -t' "$nginx_installer"
grep -Fq 'systemctl reload nginx' "$nginx_installer"
grep -Fq 'Recusando substituir arquivo que contem bloco http/server' "$nginx_installer"
grep -Fq 'test "$MIGRATION_VERSION" = 20260910223000' "$frontend_workflow"
grep -Fq 'test "$(basename "$(dirname "$edge_target")")" = "$EXPECTED_COMMIT"' "$frontend_workflow"
grep -Fq '/usr/local/sbin/prontomedic-edge-deploy --audit-contract' "$frontend_workflow"
grep -Fq 'functions/v1/pre-cadastro' "$frontend_workflow"
! grep -Fq "grep -Fq 'Não autorizado'" "$script"

echo "EDGE_DEPLOY_FAILURE_CLEANUP_CONTRACT_PASS"
bash "${BASH_SOURCE[0]%/*}/smoke.test.sh"
