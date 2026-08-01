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
mkdir "$release"
tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$release"

for path in \
  "$release/supabase/functions/_shared/cors.ts" \
  "$release/supabase/functions/auth-admin/index.ts" \
  "$release/supabase/functions/dicom-bridge/index.ts" \
  "$release/supabase/functions/telemedicina-daily/index.ts"; do
  test -f "$path"
done

previous=""
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

rollback() {
  if test -n "$previous"; then
    ln -sfn "$previous" "${current}.next"
    mv -Tf "${current}.next" "$current"
    docker compose -f "$compose" up -d --no-deps --force-recreate functions
  fi
}
trap rollback ERR

ln -sfn "$release/functions" "${current}.next"
mv -Tf "${current}.next" "$current"
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
