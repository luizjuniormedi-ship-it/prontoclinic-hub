#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <admin-permission-migration.sql>" >&2
  exit 64
fi

migration_file="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
backup_dir="${PRONTOMEDIC_BACKUP_DIR:-/home/hermes/prontomedic-deploy/backups}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${backup_dir}/prontomedic-before-admin-permission-repair-${stamp}.dump"

test -s "${migration_file}"
mkdir -p "${backup_dir}"

host_postgres() {
  docker run --rm --privileged -i -v /:/host alpine:3.20 \
    chroot /host runuser -u postgres -- "$@"
}

host_postgres pg_dump -Fc -d prontoclinic > "${backup_file}"
test -s "${backup_file}"
sha256sum "${backup_file}" | tee "${backup_file}.sha256"

host_postgres psql -X -d prontoclinic -v ON_ERROR_STOP=1 \
  -f "${migration_file}" >/dev/null

missing="$(
  host_postgres psql -X -d prontoclinic -At -v ON_ERROR_STOP=1 -c "
    SELECT count(*)
    FROM public.companies AS company_record
    CROSS JOIN public.roles AS role_record
    CROSS JOIN (
      VALUES
        ('dashboard'), ('patients'), ('professionals'),
        ('agenda'), ('recepcao'), ('nursing')
    ) AS expected(module)
    LEFT JOIN public.role_permissions AS role_permission
      ON role_permission.company_id = company_record.id
     AND role_permission.role_id = role_record.id
     AND role_permission.module = expected.module
    WHERE company_record.lg_ativo IS TRUE
      AND role_record.lg_ativo IS TRUE
      AND lower(role_record.name) IN ('admin', 'administrador')
      AND (
        role_permission.id IS NULL
        OR role_permission.can_view IS DISTINCT FROM TRUE
      );"
)"

test "${missing}" = "0"
echo "ADMIN_PERMISSION_REPAIR_PASS"
echo "backup=${backup_file}"
