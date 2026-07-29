#!/usr/bin/env bash
set -Eeuo pipefail

sha="${1:?commit SHA ausente}"
archive="${2:?arquivo da release ausente}"
root="/opt/prontomedic/edge-runtime"
releases="${root}/releases"
release="${releases}/${sha}"
current="${root}/current"
compose="${root}/docker-compose.yml"

test "$sha" != "main"
test -f "$archive"
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
tar -xzf "$archive" -C "$release"

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
  if curl -fsS --max-time 2 http://127.0.0.1:9000/ >/dev/null 2>&1; then
    break
  fi
  test "$attempt" -lt 20
  sleep 2
done

docker compose -f "$compose" ps functions
trap - ERR
rm -f "$archive"
