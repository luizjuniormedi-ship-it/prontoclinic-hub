#!/usr/bin/env bash
set -Eeuo pipefail

script="${BASH_SOURCE[0]%/*}/deploy-functions.sh"
workflow="${BASH_SOURCE[0]%/*}/../../.github/workflows/deploy-edge-functions.yml"

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
grep -Fq 'bootstrap_helper:' "$workflow"
grep -Fq 'sha256sum -c "$(basename "$checksum")"' "$workflow"
grep -Fq 'cp -a "$target" "$backup_dir/prontomedic-edge-deploy-${stamp}"' "$workflow"
grep -Fq 'mv -Tf "${target}.next" "$target"' "$workflow"
grep -Fq 'for attempt in $(seq 1 60)' "$script"
grep -Fq 'docker compose -f "$compose" logs --tail=200 functions' "$script"
grep -Fq 'Edge Runtime nao ficou saudavel apos 120 segundos' "$script"
grep -Fq 'test "$auth_status" = "401"' "$script"
grep -Fq 'nginx_config="$(/usr/sbin/nginx -T 2>&1)"' "$script"
grep -Fq '"${PUBLIC_URL}/functions/v1/${function_name}" || true)' "$workflow"
! grep -Fq "grep -Fq 'Não autorizado'" "$script"

echo "EDGE_DEPLOY_FAILURE_CLEANUP_CONTRACT_PASS"
