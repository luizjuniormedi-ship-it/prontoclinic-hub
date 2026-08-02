#!/usr/bin/env bash
set -Eeuo pipefail

root="/opt/prontomedic/edge-runtime"
releases="${root}/releases"
current="${root}/current"
previous_link="${root}/previous"
compose="${root}/docker-compose.yml"

exec 9>"${root}/.deploy.lock"
flock -n 9 || {
  echo "Outra publicação Edge está em andamento" >&2
  exit 25
}

host_postgres() {
  docker run --rm --privileged -i -v /:/host alpine:3.20 \
    chroot /host runuser -u postgres -- "$@"
}

audit_runtime_contract() {
  local nginx_config
  nginx_config="$(nginx -T 2>&1)"
  for route in auth-admin dicom-bridge telemedicina-daily; do
    grep -Fq "location = /functions/v1/${route}" <<<"$nginx_config" || {
      echo "Rota Nginx ausente: /functions/v1/${route}" >&2
      exit 28
    }
    grep -Fq "proxy_pass http://127.0.0.1:9000/${route};" <<<"$nginx_config" || {
      echo "Proxy Nginx inválido para: ${route}" >&2
      exit 29
    }
  done

  host_postgres psql -X -d prontoclinic -v ON_ERROR_STOP=1 <<'SQL'
DO $audit$
DECLARE
  v_failure TEXT;
BEGIN
  WITH expected(signature, browser_role, service_role_access) AS (
    VALUES
      ('public.current_context_is_company_admin(uuid)', TRUE, FALSE),
      ('public.provision_user_access(uuid,text,text,uuid,integer,integer)', FALSE, TRUE),
      ('public.prepare_user_access_active(uuid,uuid,boolean)', FALSE, TRUE),
      ('public.restore_user_access_active(uuid,uuid,text,text,timestamp with time zone)', FALSE, TRUE),
      ('public.finalize_user_access_active(uuid,uuid,text,timestamp with time zone)', FALSE, TRUE)
  ), audited AS (
    SELECT
      expected.signature,
      procedure_record.oid IS NOT NULL AS present,
      COALESCE(procedure_record.prosecdef, FALSE) AS security_definer,
      COALESCE(procedure_record.proconfig @> ARRAY['search_path=public, auth, pg_temp'], FALSE) AS fixed_search_path,
      COALESCE(procedure_record.proconfig @> ARRAY['row_security=off'], FALSE) AS row_security_off,
      has_function_privilege('authenticated', expected.signature, 'EXECUTE') = expected.browser_role AS browser_acl,
      NOT has_function_privilege('anon', expected.signature, 'EXECUTE') AS anon_denied,
      has_function_privilege('service_role', expected.signature, 'EXECUTE') = expected.service_role_access AS service_acl
    FROM expected
    LEFT JOIN pg_proc AS procedure_record
      ON procedure_record.oid = to_regprocedure(expected.signature)
  )
  SELECT string_agg(signature, ', ' ORDER BY signature)
    INTO v_failure
  FROM audited
  WHERE NOT (
    present AND security_definer AND fixed_search_path AND row_security_off
    AND browser_acl AND anon_denied AND service_acl
  );

  IF v_failure IS NOT NULL THEN
    RAISE EXCEPTION 'Contrato administrativo inválido: %', v_failure;
  END IF;
END
$audit$;
SQL
  echo "EDGE_RUNTIME_CONTRACT_AUDIT_PASS"
}

if test "${1:-}" = "--audit-contract"; then
  audit_runtime_contract
  exit 0
fi

if test "${1:-}" = "--rollback"; then
  previous="$(readlink -f "$previous_link" 2>/dev/null || true)"
  test -n "$previous" && test -f "${previous}/main/index.ts" || {
    echo "Release anterior válida não encontrada" >&2
    exit 24
  }
  ln -sfn "$previous" "${current}.next"
  mv -Tf "${current}.next" "$current"
  docker compose -f "$compose" up -d --no-deps --force-recreate functions
  exit 0
fi

sha="${1:?commit SHA ausente}"
archive="${2:?arquivo da release ausente}"
checksum="${3:?checksum da release ausente}"
release="${releases}/${sha}"

[[ "$sha" =~ ^[0-9a-f]{40}$ ]]
test -f "$archive"
test -f "$checksum"
test "$(stat -c '%U:%G' "${root}/secrets/.env.functions")" = "root:root"
test "$(stat -c '%a' "${root}/secrets/.env.functions")" = "600"
for variable in \
  SUPABASE_URL \
  SUPABASE_ANON_KEY \
  SUPABASE_SERVICE_ROLE_KEY \
  JWT_SECRET \
  ALLOWED_ORIGINS; do
  grep -Eq "^${variable}=.+$" "${root}/secrets/.env.functions" || {
    echo "Configuração obrigatória ausente em .env.functions: ${variable}" >&2
    exit 27
  }
done
set -a
# shellcheck disable=SC1091
. "${root}/secrets/.env.functions"
set +a
(
  cd "$(dirname "$archive")"
  sha256sum -c "$(basename "$checksum")"
)
if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Arquivo de release contém caminho inseguro" >&2
  exit 26
fi
test -f "$compose" || {
  echo "Edge Runtime não provisionado em ${compose}" >&2
  exit 20
}
test -f "${root}/secrets/.env.functions" || {
  echo "Secrets das funções não provisionados na VPS" >&2
  exit 21
}

mkdir -p "$releases"
test ! -e "$release" || {
  echo "Release imutável já existe: ${release}" >&2
  exit 22
}

previous=""
activated=0
rollback() {
  status=$?
  trap - ERR
  set +e
  if test "$activated" = "1" && test -n "$previous"; then
    ln -sfn "$previous" "${current}.next"
    mv -Tf "${current}.next" "$current"
    docker compose -f "$compose" up -d --no-deps --force-recreate functions
  fi
  current_target="$(readlink -f "$current" 2>/dev/null || true)"
  if test "$current_target" != "${release}/functions"; then
    rm -rf -- "$release"
  fi
  exit "$status"
}
trap rollback ERR

mkdir "$release"
tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$release"

for path in \
  "$release/supabase/functions/_shared/cors.ts" \
  "$release/supabase/functions/auth-admin/index.ts" \
  "$release/supabase/functions/dicom-bridge/index.ts" \
  "$release/supabase/functions/telemedicina-daily/index.ts"; do
  test -f "$path"
done

if test -L "$current"; then
  previous="$(readlink -f "$current")"
fi
test -n "$previous" && test -f "${previous}/main/index.ts" || {
  echo "Runtime atual sem roteador main oficial; publicação bloqueada" >&2
  exit 23
}
ln -sfn "$previous" "${previous_link}.next"
mv -Tf "${previous_link}.next" "$previous_link"

mkdir -p "${release}/functions/main"
cp "${previous}/main/index.ts" "${release}/functions/main/index.ts"
for function_name in _shared auth-admin dicom-bridge telemedicina-daily; do
  cp -a "${release}/supabase/functions/${function_name}" "${release}/functions/${function_name}"
done

ln -sfn "$release/functions" "${current}.next"
mv -Tf "${current}.next" "$current"
activated=1
docker compose -f "$compose" up -d --no-deps --force-recreate functions

for attempt in $(seq 1 20); do
  all_healthy=1
  for function_name in auth-admin dicom-bridge telemedicina-daily; do
    status="$(curl -sS --connect-timeout 2 --max-time 5 \
      -D /tmp/prontomedic-edge-headers -o /dev/null -w '%{http_code}' \
      -X OPTIONS -H "Origin: ${ALLOWED_ORIGINS%%,*}" \
      "http://127.0.0.1:9000/${function_name}" 2>/dev/null || true)"
    grep -Fqi "Access-Control-Allow-Origin: ${ALLOWED_ORIGINS%%,*}" \
      /tmp/prontomedic-edge-headers 2>/dev/null || all_healthy=0
    test "$status" = "200" || all_healthy=0
  done
  auth_status="$(curl -sS --connect-timeout 2 --max-time 5 \
    -o /tmp/prontomedic-auth-admin-response -w '%{http_code}' \
    -X POST -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
    "http://127.0.0.1:9000/auth-admin" 2>/dev/null || true)"
  test "$auth_status" = "401" || all_healthy=0
  grep -Fq 'Não autorizado' /tmp/prontomedic-auth-admin-response 2>/dev/null || all_healthy=0
  if test "$all_healthy" = "1"; then
    break
  fi
  test "$attempt" -lt 20
  sleep 2
done

docker compose -f "$compose" ps functions
trap - ERR
rm -f "$archive" "$checksum"
