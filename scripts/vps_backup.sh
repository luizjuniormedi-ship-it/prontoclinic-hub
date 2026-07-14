#!/bin/bash
# PRONTOMEDIC â€” Backup automatizado para VPS
# Cron: 0 3 * * * /opt/prontomedic/scripts/vps_backup.sh

set -euo pipefail
umask 077

: "${PGPASSWORD:?PGPASSWORD deve ser fornecida pelo ambiente seguro do cron/systemd}"

BACKUP_DIR="/backups/prontomedic"
DB_NAME="prontoclinic"
DB_USER="${PGUSER:-backup_prontomedic}"
DB_HOST="${PGHOST:-127.0.0.1}"
DB_PORT="${PGPORT:-5432}"
RETENTION_DAYS=7

# Cria diretÃ³rio se nÃ£o existe
install -d -m 700 "$BACKUP_DIR"

# Nome do arquivo com timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/prontomedic_${TIMESTAMP}.dump"

# Dump do banco (formato custom, comprimido)
pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --format=custom \
  --file="$BACKUP_FILE" \
  --verbose

# Comprime ainda mais (gzip)
gzip "$BACKUP_FILE"
BACKUP_FILE="${BACKUP_FILE}.gz"

# Tamanho do backup
SIZE=$(du -h "$BACKUP_FILE" | cut -f1)

# Remove backups antigos (mantÃ©m Ãºltimos 7 dias)
find "$BACKUP_DIR" -name "*.dump.gz" -mtime +${RETENTION_DAYS} -delete

# Log
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup concluÃ­do: $BACKUP_FILE ($SIZE)" >> "$BACKUP_DIR/backup.log"

# Notifica (opcional - descomentar se tiver mail configurado)
# echo "Backup ProntoMedic: $BACKUP_FILE ($SIZE)" | mail -s "Backup OK" admin@medilife.com.br

exit 0
