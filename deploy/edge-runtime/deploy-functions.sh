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

mkdir "${release}/functions"
cp -a "${previous}/." "${release}/functions/"
cp -a "${release}/supabase/functions/." "${release}/functions/"

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
  status="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST http://127.0.0.1:9000/dicom-bridge 2>/dev/null || true)"
  if test "$status" = "401"; then
    break
  fi
  test "$attempt" -lt 20
  sleep 2
done

docker compose -f "$compose" ps functions
trap - ERR
rm -f "$archive" "$checksum"
