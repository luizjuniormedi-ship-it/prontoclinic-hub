#!/usr/bin/env bash
set -Eeuo pipefail

source_dir="${1:-${BASH_SOURCE[0]%/*}}"
route_source="${source_dir}/nginx-functions.conf"
http_source="${source_dir}/nginx-http.conf"
http_target="/etc/nginx/conf.d/prontomedic-edge-rate-limit.conf"
backup_root="/var/backups/prontomedic/nginx-edge-routes"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${backup_root}/${stamp}"

test "$(id -u)" -eq 0 || {
  echo "Instalacao das rotas Nginx exige root" >&2
  exit 40
}
test -s "$route_source"
test -s "$http_source"

mapfile -t route_candidates < <(
  grep -Rsl --include='*.conf' --include='*.inc' \
    'location = /functions/v1/auth-admin' /etc/nginx 2>/dev/null \
    | grep -v '/var/backups/' \
    | while IFS= read -r candidate; do readlink -f "$candidate"; done \
    | sort -u || true
)
test "${#route_candidates[@]}" -eq 1 || {
  echo "Esperado um unico fragmento Nginx das Edge Functions; encontrados: ${#route_candidates[@]}" >&2
  exit 41
}
route_target="${route_candidates[0]}"
managed_begin='# BEGIN PRONTOMEDIC MANAGED PRE-CADASTRO'
managed_end='# END PRONTOMEDIC MANAGED PRE-CADASTRO'
managed_block="$(sed -n "/^${managed_begin}$/,/^${managed_end}$/p" "$route_source")"
test -n "$managed_block" && grep -Fqx "$managed_end" <<<"$managed_block" || {
  echo "Bloco Nginx gerenciado ausente no artefato canonico" >&2
  exit 44
}

if grep -Eq '^[[:space:]]*(http|server)[[:space:]]*\{' "$route_target"; then
  echo "Recusando substituir arquivo que contem bloco http/server: $route_target" >&2
  exit 42
fi
for route in auth-admin dicom-bridge telemedicina-daily; do
  grep -Fq "location = /functions/v1/${route}" "$route_target" || {
    echo "Fragmento Nginx legado incompleto: ${route}" >&2
    exit 43
  }
done

if grep -Fqx "$managed_begin" "$route_target"; then
  existing_block="$(sed -n "/^${managed_begin}$/,/^${managed_end}$/p" "$route_target")"
  test "$existing_block" = "$managed_block" || {
    echo "Bloco pre-cadastro gerenciado diverge do artefato canonico" >&2
    exit 45
  }
elif grep -Fq 'location = /functions/v1/pre-cadastro' "$route_target"; then
  echo "Rota pre-cadastro nao gerenciada ja existe; intervencao manual obrigatoria" >&2
  exit 46
fi

install -d -o root -g root -m 0700 "$backup_dir"
cp -a "$route_target" "$backup_dir/routes.conf"
http_existed=0
if test -f "$http_target"; then
  http_existed=1
  cp -a "$http_target" "$backup_dir/http.conf"
fi

restore() {
  cp -a "$backup_dir/routes.conf" "$route_target"
  if test "$http_existed" = 1; then
    cp -a "$backup_dir/http.conf" "$http_target"
  else
    rm -f "$http_target"
  fi
  /usr/sbin/nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
}
trap restore ERR

cp -a "$route_target" "${route_target}.next"
if ! grep -Fqx "$managed_begin" "${route_target}.next"; then
  printf '\n%s\n' "$managed_block" >> "${route_target}.next"
fi
chown root:root "${route_target}.next"
chmod 0644 "${route_target}.next"
install -o root -g root -m 0644 "$http_source" "${http_target}.next"
mv -Tf "${route_target}.next" "$route_target"
mv -Tf "${http_target}.next" "$http_target"
/usr/sbin/nginx -t
systemctl reload nginx
trap - ERR
echo "EDGE_NGINX_ROUTES_INSTALL_PASS target=$route_target backup=$backup_dir"
