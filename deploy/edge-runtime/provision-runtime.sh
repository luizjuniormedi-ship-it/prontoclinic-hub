#!/usr/bin/env bash
set -Eeuo pipefail

root="/opt/prontomedic/edge-runtime"
upstream_sha="67c983caefb722a1a1c9760bacb089d2185c9713"
main_sha256="5fb63babd5ebe7fda6f2e541fa9b4e3513a7514f8fa511ad7fdb37f46d2b9a95"
main_url="https://raw.githubusercontent.com/supabase/supabase/${upstream_sha}/docker/volumes/functions/main/index.ts"

test "$(id -u)" -eq 0 || {
  echo "Provisionamento exige root" >&2
  exit 30
}
test -f "${root}/docker-compose.yml"
test -f "${root}/secrets/.env.functions"
test ! -e "${root}/current" || {
  echo "Runtime já provisionado; use o workflow de deploy" >&2
  exit 31
}

install -d -m 0750 "${root}/releases/bootstrap/main"
curl --fail --silent --show-error --location \
  "$main_url" \
  --output "${root}/releases/bootstrap/main/index.ts"
echo "${main_sha256}  ${root}/releases/bootstrap/main/index.ts" | sha256sum -c -

ln -s "${root}/releases/bootstrap" "${root}/current"
docker compose -f "${root}/docker-compose.yml" pull functions
docker compose -f "${root}/docker-compose.yml" up -d functions

for attempt in $(seq 1 30); do
  if timeout 1 bash -c '</dev/tcp/127.0.0.1/9000' 2>/dev/null; then
    docker compose -f "${root}/docker-compose.yml" ps functions
    exit 0
  fi
  test "$attempt" -lt 30
  sleep 2
done
