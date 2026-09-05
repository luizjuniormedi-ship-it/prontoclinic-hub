#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 deploy <built-dist-directory> <release-id> | rollback <release-id>" >&2
  exit 64
fi

operation="$1"
shift
if [[ "$operation" = "deploy" && $# -eq 2 ]]; then
  dist_dir="$(cd "$1" && pwd)"
  release_id="$2"
elif [[ "$operation" = "rollback" && $# -eq 1 ]]; then
  release_id="$1"
else
  echo "usage: $0 deploy <built-dist-directory> <release-id> | rollback <release-id>" >&2
  exit 64
fi
[[ "$release_id" =~ ^[a-zA-Z0-9._-]+$ ]] || {
  echo "invalid release id" >&2
  exit 64
}
root_prefix="${PRONTOMEDIC_ROOT_PREFIX:-}"
release_root="${root_prefix}${PRONTOMEDIC_RELEASE_ROOT:-/var/www/prontomedic/releases}"
current_link="${root_prefix}${PRONTOMEDIC_CURRENT_LINK:-/var/www/prontomedic/current}"
release_dir="${release_root}/${release_id}"
release_target="${PRONTOMEDIC_RELEASE_ROOT:-/var/www/prontomedic/releases}/${release_id}"
previous_target_file="${release_dir}/.previous-target"

validate_release_target() {
  local target="$1"
  local configured_root="${PRONTOMEDIC_RELEASE_ROOT:-/var/www/prontomedic/releases}"
  [[ "$target" = "${configured_root}/"* ]] || return 1
  local physical_target="${root_prefix}${target}"
  test -f "${physical_target}/index.html"
  test -d "${physical_target}/assets"
}

activate_target() {
  local target="$1"
  local temporary_link="${current_link}.next"
  ln -sfn "$target" "$temporary_link"
  mv -Tf "$temporary_link" "$current_link"
  test "$(readlink "$current_link")" = "$target"
}

if [[ "$operation" = "rollback" ]]; then
  test "$(readlink "$current_link")" = "$release_target" || {
    echo "refusing rollback: release is not current" >&2
    exit 65
  }
  test -s "$previous_target_file"
  previous_target="$(cat "$previous_target_file")"
  validate_release_target "$previous_target" || {
    echo "refusing rollback: previous release is invalid" >&2
    exit 65
  }
  activate_target "$previous_target"
  echo "rollback=${previous_target}"
  echo "current=$(readlink "$current_link")"
  exit 0
fi

test -f "${dist_dir}/index.html"
test -d "${dist_dir}/assets"
test ! -e "${release_dir}"

previous_target="$(readlink "${current_link}" 2>/dev/null || true)"
validate_release_target "$previous_target" || {
  echo "refusing deploy: current release is not a valid rollback target" >&2
  exit 65
}
activated=0
rollback_on_error() {
  status=$?
  trap - ERR
  if [[ "$activated" = 1 && -n "$previous_target" ]]; then
    activate_target "$previous_target"
    echo "rollback=${previous_target}" >&2
  fi
  exit "$status"
}
trap rollback_on_error ERR

mkdir -p "${release_root}" "${release_dir}"
cp -a "${dist_dir}/." "${release_dir}/"

# Abas abertas podem solicitar chunks de qualquer release ainda retido depois
# da troca do symlink. Agregamos os assets imutáveis de todos eles.
while IFS= read -r previous_release; do
  if [[ "${previous_release}" != "${release_dir}" && -d "${previous_release}/assets" ]]; then
    while IFS= read -r -d '' previous_asset; do
      relative_asset="${previous_asset#"${previous_release}/assets/"}"
      retained_asset="${release_dir}/assets/${relative_asset}"
      if [[ ! -e "${retained_asset}" ]]; then
        mkdir -p "$(dirname "${retained_asset}")"
        cp -a "${previous_asset}" "${retained_asset}"
      fi
    done < <(find "${previous_release}/assets" -type f -print0)
  fi
done < <(find "${release_root}" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null || true)

printf '%s\n' "${release_id}" > "${release_dir}/RELEASE_ID"
printf '%s\n' "${previous_target}" > "$previous_target_file"
find "${release_dir}" -type d -exec chmod 0755 {} +
find "${release_dir}" -type f -exec chmod 0644 {} +

activate_target "${release_target}"
activated=1

if command -v curl >/dev/null 2>&1; then
  curl --fail --silent --show-error --max-time 10 \
    "https://prontomedic.191-252-196-6.sslip.io/" >/dev/null
fi

trap - ERR

echo "release=${release_id}"
echo "current=$(readlink "${current_link}")"
echo "previous=${previous_target}"
