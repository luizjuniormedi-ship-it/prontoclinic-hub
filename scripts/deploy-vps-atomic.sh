#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <built-dist-directory> <release-id>" >&2
  exit 64
fi

dist_dir="$(cd "$1" && pwd)"
release_id="$2"
root_prefix="${PRONTOMEDIC_ROOT_PREFIX:-}"
release_root="${root_prefix}${PRONTOMEDIC_RELEASE_ROOT:-/var/www/prontomedic/releases}"
current_link="${root_prefix}${PRONTOMEDIC_CURRENT_LINK:-/var/www/prontomedic/current}"
release_dir="${release_root}/${release_id}"
release_target="${PRONTOMEDIC_RELEASE_ROOT:-/var/www/prontomedic/releases}/${release_id}"

test -f "${dist_dir}/index.html"
test -d "${dist_dir}/assets"
test ! -e "${release_dir}"

mkdir -p "${release_root}" "${release_dir}"
cp -a "${dist_dir}/." "${release_dir}/"

# Abas abertas podem solicitar chunks de releases anteriores depois da troca
# do symlink. Mantemos os assets dos cinco releases mais recentes.
while IFS= read -r previous_release; do
  if [[ "${previous_release}" != "${release_dir}" && -d "${previous_release}/assets" ]]; then
    cp -an "${previous_release}/assets/." "${release_dir}/assets/"
  fi
done < <(ls -1dt "${release_root}"/* 2>/dev/null | head -n 6 || true)

printf '%s\n' "${release_id}" > "${release_dir}/RELEASE_ID"
find "${release_dir}" -type d -exec chmod 0755 {} +
find "${release_dir}" -type f -exec chmod 0644 {} +

temporary_link="${current_link}.next"
ln -sfn "${release_target}" "${temporary_link}"
mv -Tf "${temporary_link}" "${current_link}"

test "$(readlink "${current_link}")" = "${release_target}"
if command -v curl >/dev/null 2>&1; then
  curl --fail --silent --show-error --max-time 10 \
    "https://prontomedic.191-252-196-6.sslip.io/" >/dev/null
fi

echo "release=${release_id}"
echo "current=$(readlink "${current_link}")"
