#!/usr/bin/env bash
set -Eeuo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/root/current/pre-cadastro" "$tmp/root/secrets" "$tmp/bin"
touch "$tmp/root/current/pre-cadastro/index.ts"
printf 'ALLOWED_ORIGINS=https://qa.example\nSUPABASE_ANON_KEY=public-test-key\n' > "$tmp/root/secrets/.env.functions"
sed "s|root=\"/opt/prontomedic/edge-runtime\"|root=\"$tmp/root\"|" "$dir/deploy-functions.sh" > "$tmp/helper.sh"
cat > "$tmp/bin/curl" <<'SH'
#!/usr/bin/env bash
set -eu
headers='' body='' post=0 origin=0 jwt=0
while (($#)); do
  case "$1" in
    -D) headers="$2"; shift ;;
    -o) body="$2"; shift ;;
    -H) [[ "$2" != 'Origin: https://qa.example' ]] || origin=1
        [[ "$2" != 'Authorization: Bearer public-test-key' ]] || jwt=1; shift ;;
    --data) post=1; test "$2" = '{"action":"status","token":"invalid"}'; shift ;;
  esac
  shift
done
test "$origin" = 1
printf 'Access-Control-Allow-Origin: %s\r\n' "${MOCK_ORIGIN:-https://qa.example}" > "$headers"
printf '{"status":"INVALIDO"}' > "$body"
if test "$post" = 1; then test "$jwt" = 1; printf '%s' "${MOCK_POST_STATUS:-404}"; else printf 200; fi
SH
chmod +x "$tmp/bin/curl"
export PATH="$tmp/bin:$PATH"
bash "$tmp/helper.sh" --smoke
if MOCK_ORIGIN=https://evil.example bash "$tmp/helper.sh" --smoke; then exit 1; fi
if MOCK_POST_STATUS=503 bash "$tmp/helper.sh" --smoke; then exit 1; fi
rm "$tmp/root/current/pre-cadastro/index.ts"
bash "$tmp/helper.sh" --smoke-rollback
if bash "$tmp/helper.sh" --smoke; then exit 1; fi
grep -Fq 'limit_req_status 429;' "$dir/nginx-functions.conf"
grep -Fq 'zone=pre_cadastro:10m rate=30r/m;' "$dir/nginx-http.conf"
echo EDGE_SMOKE_TEST_PASS
