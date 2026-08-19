#!/usr/bin/env bash
set -euo pipefail

host="${1:-localhost}"
port="${2:-54322}"
user="${3:-postgres}"
database="${4:-prontomedic_reception_m24_ci}"
psql_cmd=(psql -X -v ON_ERROR_STOP=1 -h "$host" -p "$port" -U "$user" -d "$database")
runtime_contract="supabase/tests/module24_imaging_ris_runtime_contract.sql"

if [[ ! "$database" =~ ^prontomedic_reception_[a-z0-9_]+$ ]]; then
  echo "M24 concurrency contract requires a disposable reception database" >&2
  exit 1
fi

# Reuse the canonical synthetic fixture section, but commit it so independent
# PostgreSQL sessions can observe the same rows.
sed -n '1,/^SET LOCAL ROLE app_prontomedic;$/p' "$runtime_contract" |
  sed '$d' |
  sed 's/^BEGIN;$/BEGIN;/' |
  { cat; printf '\nCOMMIT;\n'; } |
  "${psql_cmd[@]}" >/dev/null

claims="{\"sub\":\"00000000-0000-4000-8000-000000002402\",\"company_id\":\"00000000-0000-4000-8000-000000000242\",\"unit_id\":24002,\"session_id\":\"00000000-0000-4000-8000-000000002472\",\"role\":\"authenticated\",\"aal\":\"aal2\"}"
context_sql="SET ROLE app_prontomedic; SET request.jwt.claim.sub='00000000-0000-4000-8000-000000002402'; SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.company_id='00000000-0000-4000-8000-000000000242'; SET request.jwt.claim.unit_id='24002'; SET request.jwt.claims='$claims';"
lock_sql="SELECT pg_advisory_xact_lock(hashtextextended('00000000-0000-4000-8000-000000000242:M24ACC-B',0));"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

wait_for_lock_marker() {
  local logfile="$1"
  local winner_pid="$2"
  local attempts=0
  while ! grep -q '^LOCK_GRANTED$' "$logfile" 2>/dev/null; do
    if ! kill -0 "$winner_pid" 2>/dev/null; then
      cat "$logfile" >&2
      echo "M24 winner session ended before acquiring the advisory lock" >&2
      return 1
    fi
    attempts=$((attempts + 1))
    if [[ $attempts -ge 100 ]]; then
      cat "$logfile" >&2
      echo "M24 timed out waiting for the advisory lock barrier" >&2
      return 1
    fi
    sleep 0.05
  done
}

# Interleaving 1: cancellation owns the lock first; ingest must wait and then
# fail closed because the Worklist row is cancelled.
"${psql_cmd[@]}" >"$tmpdir/cancel-wins.log" 2>&1 <<SQL &
BEGIN;
$context_sql
$lock_sql
\echo LOCK_GRANTED
SELECT public.m24_cancel_imaging_order_secure('00000000-0000-4000-8000-000000002412','Concurrent cancellation wins');
SELECT pg_sleep(1);
COMMIT;
SQL
winner_pid=$!
wait_for_lock_marker "$tmpdir/cancel-wins.log" "$winner_pid"
set +e
"${psql_cmd[@]}" >"$tmpdir/ingest-loses.log" 2>&1 <<SQL
$context_sql
SELECT public.m24_receive_pacs_study_secure('M24ACC-B','1.2.826.0.1.3680043.24.201',CURRENT_DATE,NULL,'CT','M24BE','M24-SPS-B',NULL);
SQL
loser_status=$?
set -e
wait "$winner_pid"
if [[ $loser_status -eq 0 ]] || ! grep -q 'Worklist item not found in active scope' "$tmpdir/ingest-loses.log"; then
  cat "$tmpdir/ingest-loses.log" >&2
  echo "M24 cancel-wins interleaving did not fail ingest closed" >&2
  exit 1
fi
"${psql_cmd[@]}" -Atc "SELECT CASE WHEN o.status='cancelado' AND i.status='cancelado' AND q.status='cancelled' AND NOT EXISTS(SELECT 1 FROM public.pacs_studies s WHERE s.imaging_order_item_id=i.id::text) THEN 'ok' ELSE 'invalid' END FROM public.imaging_orders o JOIN public.imaging_order_items i ON i.imaging_order_id=o.id JOIN public.dicom_worklist_queue q ON q.imaging_order_item_id=i.id WHERE o.id='00000000-0000-4000-8000-000000002412';" | grep -qx ok

# Restore only the synthetic tenant-B imaging rows for the reverse order.
"${psql_cmd[@]}" >/dev/null <<'SQL'
UPDATE public.imaging_orders SET status='liberado_worklist',notes=NULL WHERE id='00000000-0000-4000-8000-000000002412';
UPDATE public.imaging_order_items SET status='liberado_worklist',study_instance_uid=NULL WHERE id='00000000-0000-4000-8000-000000002422';
UPDATE public.dicom_worklist_queue SET status='exported',last_error=NULL WHERE id='00000000-0000-4000-8000-000000002432';
SQL

# Interleaving 2: ingest owns the lock first; cancellation must wait and then
# fail because acquisition/PACS has already become authoritative.
"${psql_cmd[@]}" >"$tmpdir/ingest-wins.log" 2>&1 <<SQL &
BEGIN;
$context_sql
$lock_sql
\echo LOCK_GRANTED
SELECT public.m24_receive_pacs_study_secure('M24ACC-B','1.2.826.0.1.3680043.24.202',CURRENT_DATE,NULL,'CT','M24BE','M24-SPS-B',NULL);
SELECT pg_sleep(1);
COMMIT;
SQL
winner_pid=$!
wait_for_lock_marker "$tmpdir/ingest-wins.log" "$winner_pid"
set +e
"${psql_cmd[@]}" >"$tmpdir/cancel-loses.log" 2>&1 <<SQL
$context_sql
SELECT public.m24_cancel_imaging_order_secure('00000000-0000-4000-8000-000000002412','Concurrent cancellation loses');
SQL
loser_status=$?
set -e
wait "$winner_pid"
if [[ $loser_status -eq 0 ]] || ! grep -q 'after acquisition/PACS' "$tmpdir/cancel-loses.log"; then
  cat "$tmpdir/cancel-loses.log" >&2
  echo "M24 ingest-wins interleaving did not fail cancellation closed" >&2
  exit 1
fi
"${psql_cmd[@]}" -Atc "SELECT CASE WHEN i.status='recebido_pacs' AND q.status='acquired' AND EXISTS(SELECT 1 FROM public.pacs_studies s WHERE s.imaging_order_item_id=i.id::text AND s.study_instance_uid='1.2.826.0.1.3680043.24.202') AND EXISTS(SELECT 1 FROM public.reports r WHERE r.imaging_order_item_id=i.id AND r.study_instance_uid='1.2.826.0.1.3680043.24.202' AND r.deleted_at IS NULL) THEN 'ok' ELSE 'invalid' END FROM public.imaging_orders o JOIN public.imaging_order_items i ON i.imaging_order_id=o.id JOIN public.dicom_worklist_queue q ON q.imaging_order_item_id=i.id WHERE o.id='00000000-0000-4000-8000-000000002412';" | grep -qx ok

echo "M24_CONCURRENT_CANCEL_INGEST_OK"
