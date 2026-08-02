#!/usr/bin/env bash
set -Eeuo pipefail

sha="${1:?commit SHA ausente}"
source_root="${2:?raiz do checkout ausente}"
output_dir="${3:?diretorio de saida ausente}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]]
case "$source_root" in /*) ;; *) echo "source_root deve ser absoluto" >&2; exit 64 ;; esac
case "$output_dir" in /*) ;; *) echo "output_dir deve ser absoluto" >&2; exit 64 ;; esac

stage="$(mktemp -d)"
cleanup() { rm -rf -- "$stage"; }
trap cleanup EXIT

for file in \
  local-auth-server.mjs local-auth-admin.mjs local-auth-admin.d.ts \
  local-auth-projection.mjs local-auth-projection.d.ts package.json package-lock.json; do
  test -f "${source_root}/${file}"
  cp -- "${source_root}/${file}" "${stage}/${file}"
done
cp -- "${source_root}/deploy/auth-service/ecosystem.config.cjs" "${stage}/ecosystem.config.cjs"

(
  cd "$stage"
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
)

node - "$stage/release-manifest.json" "$sha" <<'NODE'
const fs = require('node:fs');
const [path, sha] = process.argv.slice(2);
const manifest = {
  schemaVersion: 1,
  commitSha: sha,
  migrationStrategy: 'forward-compatible-additive',
  builtAt: '1970-01-01T00:00:00.000Z',
  files: [
    'local-auth-server.mjs', 'local-auth-admin.mjs', 'local-auth-admin.d.ts',
    'local-auth-projection.mjs', 'local-auth-projection.d.ts', 'package.json',
    'package-lock.json', 'ecosystem.config.cjs', 'node_modules'
  ]
};
fs.writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

mkdir -p "$output_dir"
find "$stage" -exec touch -h -d '@0' {} +
archive="${output_dir}/auth-${sha}.tgz"
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
  -czf "${archive}.next" -C "$stage" .
mv -f "${archive}.next" "$archive"
(
  cd "$output_dir"
  sha256sum "$(basename "$archive")" >"$(basename "$archive").sha256"
)
printf 'AUTH_ARTIFACT_OK %s\n' "$archive"
