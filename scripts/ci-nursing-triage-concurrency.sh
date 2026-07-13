#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP_SQL="$ROOT_DIR/supabase/tests/f1_runtime_nursing_triage_concurrency_setup.sql"
VERIFY_SQL="$ROOT_DIR/supabase/tests/f1_runtime_nursing_triage_concurrency_verify.sql"

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=postgres}"
: "${PGPASSWORD:=}"
: "${TRIAGE_CONCURRENCY_TIMEOUT_SECONDS:=25}"
export PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD

if ! [[ "$TRIAGE_CONCURRENCY_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  echo "TRIAGE_CONCURRENCY_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 2
fi

command -v psql >/dev/null 2>&1 || {
  echo "psql is required" >&2
  exit 2
}
command -v timeout >/dev/null 2>&1 || {
  echo "GNU timeout is required" >&2
  exit 2
}

PSQL=(psql -X --no-psqlrc -v ON_ERROR_STOP=1)
setup_done=0
cleanup_done=0
ACTIVE_PIDS=()

UUID_ROW="$(
  "${PSQL[@]}" -At -F ' ' -c \
    "SELECT gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()"
)"
read -r RUN_ID COMPANY_B_ID ACTOR_ID DISTINCT_KEY_A DISTINCT_KEY_B SAME_KEY DIVERGENT_KEY <<< "$UUID_ROW"
for value in "$RUN_ID" "$COMPANY_B_ID" "$ACTOR_ID" "$DISTINCT_KEY_A" "$DISTINCT_KEY_B" "$SAME_KEY" "$DIVERGENT_KEY"; do
  if ! [[ "$value" =~ ^[0-9a-fA-F-]{36}$ ]]; then
    echo "Database did not return seven valid UUIDs" >&2
    exit 1
  fi
done
RUN_SHORT="${RUN_ID%%-*}"
COMPANY_ID="$RUN_ID"
ROLE_NAME="triage_conc_${RUN_SHORT}"
COMPANY_NAME="Triage concurrency ${RUN_SHORT}"
COMPANY_B_NAME="Triage concurrency B ${RUN_SHORT}"
ACTOR_EMAIL="triage-concurrency-${RUN_SHORT}@test.invalid"
PATIENT_A_NAME="Concurrency patient A ${RUN_SHORT}"
PATIENT_B_NAME="Concurrency patient B ${RUN_SHORT}"
SAME_COMPLAINT="Concurrent identical payload ${RUN_SHORT}"
DIVERGENT_COMPLAINT_A="Concurrent divergent payload A ${RUN_SHORT}"
DIVERGENT_COMPLAINT_B="Concurrent divergent payload B ${RUN_SHORT}"
CLASSIFICATION_NAME="TRIAGE_CONC_${RUN_SHORT}"

fixture_args=(
  -v "company_id=$COMPANY_ID"
  -v "company_b_id=$COMPANY_B_ID"
  -v "actor_id=$ACTOR_ID"
  -v "role_name=$ROLE_NAME"
  -v "company_name=$COMPANY_NAME"
  -v "company_b_name=$COMPANY_B_NAME"
  -v "actor_email=$ACTOR_EMAIL"
  -v "patient_a_name=$PATIENT_A_NAME"
  -v "patient_b_name=$PATIENT_B_NAME"
  -v "distinct_key_a=$DISTINCT_KEY_A"
  -v "distinct_key_b=$DISTINCT_KEY_B"
  -v "same_key=$SAME_KEY"
  -v "divergent_key=$DIVERGENT_KEY"
  -v "same_complaint=$SAME_COMPLAINT"
  -v "divergent_complaint_a=$DIVERGENT_COMPLAINT_A"
  -v "divergent_complaint_b=$DIVERGENT_COMPLAINT_B"
  -v "classification_name=$CLASSIFICATION_NAME"
)
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nursing-triage-concurrency.XXXXXX")"

remove_active_pid() {
  local target=$1 pid
  local remaining=()
  for pid in "${ACTIVE_PIDS[@]}"; do
    if [[ "$pid" != "$target" ]]; then
      remaining+=("$pid")
    fi
  done
  ACTIVE_PIDS=("${remaining[@]}")
}

terminate_active_pids() {
  local pids=("${ACTIVE_PIDS[@]}") pid deadline alive
  (( ${#pids[@]} > 0 )) || return 0

  for pid in "${pids[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  deadline=$((SECONDS + 5))
  while (( SECONDS < deadline )); do
    alive=0
    for pid in "${pids[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        alive=1
      fi
    done
    (( alive == 0 )) && break
    sleep 0.1
  done
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
  ACTIVE_PIDS=()
}

cleanup() {
  local original_status=$?
  trap - EXIT INT TERM
  terminate_active_pids
  if (( setup_done == 1 && cleanup_done == 0 )); then
    if ! timeout --foreground "${TRIAGE_CONCURRENCY_TIMEOUT_SECONDS}s" \
      "${PSQL[@]}" "${fixture_args[@]}" -v cleanup_only=1 -f "$VERIFY_SQL"; then
      echo "Emergency fixture cleanup failed" >&2
      original_status=1
    fi
  fi
  rm -rf -- "$TMP_DIR"
  exit "$original_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

setup_done=1
"${PSQL[@]}" "${fixture_args[@]}" -f "$SETUP_SQL"

PATIENT_ID_ROWS="$(
  printf '%s\n' \
    "SELECT id FROM public.patients WHERE company_id = :'company_id'::uuid AND full_name IN (:'patient_a_name', :'patient_b_name') ORDER BY full_name" |
    "${PSQL[@]}" -At -v "company_id=$COMPANY_ID" \
      -v "patient_a_name=$PATIENT_A_NAME" -v "patient_b_name=$PATIENT_B_NAME"
)"
mapfile -t PATIENT_IDS <<< "$PATIENT_ID_ROWS"
if (( ${#PATIENT_IDS[@]} != 2 )); then
  echo "Setup did not create exactly two patients" >&2
  exit 1
fi
PATIENT_A_ID="${PATIENT_IDS[0]}"
PATIENT_B_ID="${PATIENT_IDS[1]}"
CLASSIFICATION_ID="$(
  printf '%s\n' \
    "SELECT id FROM public.mnct_classificacao_risco WHERE ds_classificacao = :'classification_name'" |
    "${PSQL[@]}" -At -v "classification_name=$CLASSIFICATION_NAME"
)"
if ! [[ "$CLASSIFICATION_ID" =~ ^[0-9]+$ ]]; then
  echo "Setup did not create the global classification" >&2
  exit 1
fi

session_sql=$(cat <<'SQL'
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '10s';
SET LOCAL ROLE authenticated;
SELECT set_config('app.test_user_id', :'actor_id', TRUE);
SELECT set_config('request.jwt.claim.sub', :'actor_id', TRUE);
SELECT pg_sleep(GREATEST(EXTRACT(EPOCH FROM (:'start_at'::timestamptz - clock_timestamp())), 0));
SELECT public.enqueue_nursing_triage_secure(
  :'patient_id'::bigint,
  :'complaint',
  NULL,
  :'idempotency_key'::uuid
);
COMMIT;
SQL
)
SESSION_SQL_FILE="$TMP_DIR/session.sql"
printf '%s\n' "$session_sql" > "$SESSION_SQL_FILE"

launch_session() {
  local patient_id=$1 complaint=$2 idempotency_key=$3 start_at=$4 output_file=$5
  exec timeout --foreground "${TRIAGE_CONCURRENCY_TIMEOUT_SECONDS}s" "${PSQL[@]}" \
    -v "actor_id=$ACTOR_ID" \
    -v "patient_id=$patient_id" \
    -v "complaint=$complaint" \
    -v "idempotency_key=$idempotency_key" \
    -v "start_at=$start_at" \
    -f "$SESSION_SQL_FILE" >"$output_file" 2>&1
}

classification_move_sql=$(cat <<'SQL'
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '10s';
SELECT pg_sleep(GREATEST(EXTRACT(EPOCH FROM (:'start_at'::timestamptz - clock_timestamp())), 0));
UPDATE public.mnct_classificacao_risco
   SET company_id = :'company_b_id'::uuid
 WHERE id = :'classification_id'::integer
   AND company_id IS NULL;
COMMIT;
SQL
)

classification_reference_sql=$(cat <<'SQL'
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '10s';
SELECT pg_sleep(GREATEST(EXTRACT(EPOCH FROM (:'start_at'::timestamptz - clock_timestamp())), 0));
INSERT INTO public.triagens(company_id, cd_paciente, cd_classificacao_id)
VALUES (:'company_id'::uuid, :'patient_id'::bigint, :'classification_id'::integer);
COMMIT;
SQL
)
CLASSIFICATION_MOVE_SQL_FILE="$TMP_DIR/classification-move.sql"
CLASSIFICATION_REFERENCE_SQL_FILE="$TMP_DIR/classification-reference.sql"
printf '%s\n' "$classification_move_sql" > "$CLASSIFICATION_MOVE_SQL_FILE"
printf '%s\n' "$classification_reference_sql" > "$CLASSIFICATION_REFERENCE_SQL_FILE"

launch_classification_session() {
  local sql_file=$1 start_at=$2 output_file=$3
  exec timeout --foreground "${TRIAGE_CONCURRENCY_TIMEOUT_SECONDS}s" "${PSQL[@]}" \
    -v "classification_id=$CLASSIFICATION_ID" \
    -v "company_id=$COMPANY_ID" \
    -v "company_b_id=$COMPANY_B_ID" \
    -v "patient_id=$PATIENT_A_ID" \
    -v "start_at=$start_at" \
    -f "$sql_file" >"$output_file" 2>&1
}

LAST_STATUSES=()
wait_for_all() {
  local pids=("$@") pid status
  LAST_STATUSES=()

  for pid in "${pids[@]}"; do
    if wait "$pid"; then
      LAST_STATUSES+=(0)
    else
      status=$?
      LAST_STATUSES+=("$status")
    fi
    remove_active_pid "$pid"
  done
}

next_start_at() {
  "${PSQL[@]}" -At -c "SELECT clock_timestamp() + interval '1500 milliseconds'"
}

START_AT="$(next_start_at)"
launch_session "$PATIENT_A_ID" "Distinct A ${RUN_SHORT}" "$DISTINCT_KEY_A" "$START_AT" "$TMP_DIR/distinct-a.log" &
PID_A=$!
ACTIVE_PIDS+=("$PID_A")
launch_session "$PATIENT_B_ID" "Distinct B ${RUN_SHORT}" "$DISTINCT_KEY_B" "$START_AT" "$TMP_DIR/distinct-b.log" &
PID_B=$!
ACTIVE_PIDS+=("$PID_B")
wait_for_all "$PID_A" "$PID_B"
if (( LAST_STATUSES[0] != 0 || LAST_STATUSES[1] != 0 )); then
  echo "Distinct-key race failed: ${LAST_STATUSES[*]}" >&2
  sed -n '1,120p' "$TMP_DIR/distinct-a.log" >&2
  sed -n '1,120p' "$TMP_DIR/distinct-b.log" >&2
  exit 1
fi

START_AT="$(next_start_at)"
launch_session "$PATIENT_A_ID" "$SAME_COMPLAINT" "$SAME_KEY" "$START_AT" "$TMP_DIR/same-a.log" &
PID_A=$!
ACTIVE_PIDS+=("$PID_A")
launch_session "$PATIENT_A_ID" "$SAME_COMPLAINT" "$SAME_KEY" "$START_AT" "$TMP_DIR/same-b.log" &
PID_B=$!
ACTIVE_PIDS+=("$PID_B")
wait_for_all "$PID_A" "$PID_B"
if (( LAST_STATUSES[0] != 0 || LAST_STATUSES[1] != 0 )); then
  echo "Equal-payload idempotency race failed: ${LAST_STATUSES[*]}" >&2
  sed -n '1,120p' "$TMP_DIR/same-a.log" >&2
  sed -n '1,120p' "$TMP_DIR/same-b.log" >&2
  exit 1
fi

START_AT="$(next_start_at)"
launch_session "$PATIENT_A_ID" "$DIVERGENT_COMPLAINT_A" "$DIVERGENT_KEY" "$START_AT" "$TMP_DIR/divergent-a.log" &
PID_A=$!
ACTIVE_PIDS+=("$PID_A")
launch_session "$PATIENT_A_ID" "$DIVERGENT_COMPLAINT_B" "$DIVERGENT_KEY" "$START_AT" "$TMP_DIR/divergent-b.log" &
PID_B=$!
ACTIVE_PIDS+=("$PID_B")
wait_for_all "$PID_A" "$PID_B"

successes=0
denials=0
divergent_logs=("$TMP_DIR/divergent-a.log" "$TMP_DIR/divergent-b.log")
for index in 0 1; do
  if (( LAST_STATUSES[index] == 0 )); then
    successes=$((successes + 1))
  elif grep -Fq "Chave idempotente de triagem reutilizada com payload diferente" \
       "${divergent_logs[index]}"; then
    denials=$((denials + 1))
  fi
done
if (( successes != 1 || denials != 1 )); then
  echo "Divergent-payload race expected one acceptance and one denial; statuses: ${LAST_STATUSES[*]}" >&2
  sed -n '1,120p' "$TMP_DIR/divergent-a.log" >&2
  sed -n '1,120p' "$TMP_DIR/divergent-b.log" >&2
  exit 1
fi

START_AT="$(next_start_at)"
launch_classification_session "$CLASSIFICATION_MOVE_SQL_FILE" "$START_AT" "$TMP_DIR/classification-move.log" &
PID_A=$!
ACTIVE_PIDS+=("$PID_A")
launch_classification_session "$CLASSIFICATION_REFERENCE_SQL_FILE" "$START_AT" "$TMP_DIR/classification-reference.log" &
PID_B=$!
ACTIVE_PIDS+=("$PID_B")
wait_for_all "$PID_A" "$PID_B"

successes=0
denials=0
classification_logs=("$TMP_DIR/classification-move.log" "$TMP_DIR/classification-reference.log")
for index in 0 1; do
  if (( LAST_STATUSES[index] == 0 )); then
    successes=$((successes + 1))
  elif grep -Eq \
    "Classificacao (privada nao pertence ao tenant da linha|referenciada nao pode mudar para outro tenant)" \
    "${classification_logs[index]}"; then
    denials=$((denials + 1))
  fi
done
if (( successes != 1 || denials != 1 )); then
  echo "Classification tenant race expected one acceptance and one denial; statuses: ${LAST_STATUSES[*]}" >&2
  sed -n '1,120p' "$TMP_DIR/classification-move.log" >&2
  sed -n '1,120p' "$TMP_DIR/classification-reference.log" >&2
  exit 1
fi

timeout --foreground "${TRIAGE_CONCURRENCY_TIMEOUT_SECONDS}s" \
  "${PSQL[@]}" "${fixture_args[@]}" -v cleanup_only=0 -f "$VERIFY_SQL"
cleanup_done=1

echo "NURSING_TRIAGE_CONCURRENCY_OK (PostgreSQL 18, eight synchronized psql sessions)"

