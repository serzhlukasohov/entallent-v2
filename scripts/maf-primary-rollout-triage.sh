#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
if [ -f "$ENV_FILE" ]; then
  ORIG_API_BASE="${API_BASE-}"
  ORIG_TENANT_ID="${TENANT_ID-}"
  ORIG_DATABASE_URL="${DATABASE_URL-}"
  ORIG_ADMIN_API_KEY="${ADMIN_API_KEY-}"
  ORIG_NODE_ENV="${NODE_ENV-}"
  ORIG_API_PORT="${API_PORT-}"
  set -a
  source "$ENV_FILE"
  set +a
  API_BASE="${ORIG_API_BASE:-${API_BASE:-}}"
  TENANT_ID="${ORIG_TENANT_ID:-${TENANT_ID:-}}"
  DATABASE_URL="${ORIG_DATABASE_URL:-${DATABASE_URL:-}}"
  ADMIN_API_KEY="${ORIG_ADMIN_API_KEY:-${ADMIN_API_KEY:-}}"
  NODE_ENV="${ORIG_NODE_ENV:-${NODE_ENV:-}}"
  API_PORT="${ORIG_API_PORT:-${API_PORT:-}}"
  unset ORIG_API_BASE ORIG_TENANT_ID ORIG_DATABASE_URL ORIG_ADMIN_API_KEY ORIG_NODE_ENV ORIG_API_PORT
fi

export API_BASE="${API_BASE:-http://127.0.0.1:${API_PORT:-3000}/api/v1}"
export TENANT_ID="${TENANT_ID:-${DEFAULT_TENANT_ID:-}}"
export DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required for runtime_attempts evidence checks}"
export ADMIN_API_KEY="${ADMIN_API_KEY:-}"

RUN_ENV="${NODE_ENV:-development}"
if [ "$RUN_ENV" = "production" ] && [ -z "$ADMIN_API_KEY" ]; then
  echo "FAIL: ADMIN_API_KEY is required when NODE_ENV=production." >&2
  echo "ROLLBACK_READY=0"
  exit 1
fi

if [ -z "$TENANT_ID" ]; then
  echo "FAIL: TENANT_ID is required. Set TENANT_ID explicitly or DEFAULT_TENANT_ID in $ENV_FILE" >&2
  echo "ROLLBACK_READY=0"
  exit 1
fi

if [ "$RUN_ENV" != "production" ]; then
  export INTERNAL_SERVICE_AUTH_SECRET="${INTERNAL_SERVICE_AUTH_SECRET:-agent-service-internal-secret-000000000000}"
  export AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET="${AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET:-${INTERNAL_SERVICE_AUTH_SECRET}}"

  if [ "$INTERNAL_SERVICE_AUTH_SECRET" != "$AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET" ]; then
    echo "WARN: INTERNAL_SERVICE_AUTH_SECRET and AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET differ. Set them to the same value for local context-tool auth."
  fi
  if [ -z "$INTERNAL_SERVICE_AUTH_SECRET" ] || [ -z "$AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET" ]; then
    echo "WARN: internal service secret is empty. Agent-service context tool will generate auth errors if internal API URL is set."
  fi
else
  export INTERNAL_SERVICE_AUTH_SECRET="${INTERNAL_SERVICE_AUTH_SECRET:?INTERNAL_SERVICE_AUTH_SECRET is required in production-mode triage}"
  export AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET="${AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET:-${INTERNAL_SERVICE_AUTH_SECRET}}"
fi

if [ "$RUN_ENV" = "production" ] && [ "$INTERNAL_SERVICE_AUTH_SECRET" != "$AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET" ]; then
  echo "FAIL: INTERNAL_SERVICE_AUTH_SECRET and AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET must match in production." >&2
  echo "ROLLBACK_READY=0"
  exit 1
fi

API_BASE="${API_BASE%/}"
USER_ID="${ROLLBACK_TRIAGE_USER_ID:-smoke-primary-verify}"
MESSAGE_TEXT="${ROLLBACK_TRIAGE_MESSAGE_TEXT:-Smoke check: one concise sentence.}"
MISSING_VALUE="__missing__"
ADMIN_HEADERS=()
if [ -n "$ADMIN_API_KEY" ]; then
  ADMIN_HEADERS=(-H "X-Api-Key: $ADMIN_API_KEY")
else
  echo "WARN: ADMIN_API_KEY is not set. In non-production this is treated as a temporary local dev fallback."
fi

for required_cmd in curl jq psql; do
  if ! command -v "$required_cmd" >/dev/null 2>&1; then
    echo "FAIL: required command not found: $required_cmd" >&2
    echo "ROLLBACK_READY=0"
    exit 1
  fi
done

PRIMARY_ROLLBACK=""
PRIMARY_ROLLBACK_PERCENTAGE=""
PRIMARY_ROLLBACK_METADATA=""
DISABLED_ROLLBACK=""
DISABLED_ROLLBACK_METADATA=""
FLAGS_JSON=""

run_admin_get() {
  local body_file
  body_file="$(mktemp)"
  local status
  status="$(curl -sS -o "$body_file" -w "%{http_code}" ${ADMIN_HEADERS[@]+"${ADMIN_HEADERS[@]}"} "$1" || true)"
  status="${status:-000}"
  if [ "$status" -ne 200 ]; then
    echo "FAIL: admin GET failed: $1 (HTTP $status)" >&2
    cat "$body_file" >&2
    rm -f "$body_file"
    exit 1
  fi
  FLAGS_JSON="$(cat "$body_file")"
  rm -f "$body_file"
}

run_admin_put() {
  local key="$1"
  local body="$2"
  local tenant_opt="${3:+?tenantId=$TENANT_ID}"
  local path="/admin/feature-flags/$key${tenant_opt}"
  local status
  local response_file
  response_file="$(mktemp)"
  status="$(curl -sS -o "$response_file" -w "%{http_code}" -X PUT "$API_BASE$path" \
    -H "Content-Type: application/json" \
    ${ADMIN_HEADERS[@]+"${ADMIN_HEADERS[@]}"} \
    -d "$body" || true)"
  status="${status:-000}"
  rm -f "$response_file"

  if [ "$status" -ne 200 ]; then
    echo "FAIL: admin PUT failed for $key (HTTP $status)" >&2
    exit 1
  fi
}

run_admin_delete() {
  local key="$1"
  local tenant_opt="${2:+?tenantId=$TENANT_ID}"
  local status
  status="$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE "$API_BASE/admin/feature-flags/$key${tenant_opt}" \
    ${ADMIN_HEADERS[@]+"${ADMIN_HEADERS[@]}"} || true)"
  status="${status:-000}"
  if [ "$status" -ne 204 ] && [ "$status" -ne 200 ] && [ "$status" -ne 404 ]; then
    echo "FAIL: admin DELETE failed for $key (HTTP $status)" >&2
    exit 1
  fi
}

restore_flags() {
  if [ "$PRIMARY_ROLLBACK" = "$MISSING_VALUE" ]; then
    run_admin_delete "maf_runtime_primary" true
  else
    run_admin_put "maf_runtime_primary" "{\"enabled\":$PRIMARY_ROLLBACK,\"rolloutPercentage\":$PRIMARY_ROLLBACK_PERCENTAGE,\"metadata\":$PRIMARY_ROLLBACK_METADATA}" true
  fi

  if [ "$DISABLED_ROLLBACK" = "$MISSING_VALUE" ]; then
    run_admin_delete "maf_runtime_disabled" true
  else
    run_admin_put "maf_runtime_disabled" "{\"enabled\":$DISABLED_ROLLBACK,\"rolloutPercentage\":100,\"metadata\":$DISABLED_ROLLBACK_METADATA}" true
  fi
}

snapshot_flags() {
  FLAGS_JSON=""
  run_admin_get "$API_BASE/admin/feature-flags?tenantId=$TENANT_ID"

  if ! jq -e '.knownKeys | index("maf_runtime_disabled") != null' <<<"$FLAGS_JSON" >/dev/null; then
    echo "FAIL: maf_runtime_disabled key missing from known flags." >&2
    echo "ROLLBACK_READY=0"
    exit 1
  fi
  if ! jq -e '.knownKeys | index("maf_runtime_primary") != null' <<<"$FLAGS_JSON" >/dev/null; then
    echo "FAIL: maf_runtime_primary key missing from known flags." >&2
    echo "ROLLBACK_READY=0"
    exit 1
  fi

  PRIMARY_ROLLBACK="$(jq -r --arg tenant "$TENANT_ID" '.flags[] | select(.key=="maf_runtime_primary" and .tenantId == $tenant) | .enabled // empty | tostring' <<<"$FLAGS_JSON")"
  PRIMARY_ROLLBACK_PERCENTAGE="$(jq -r --arg tenant "$TENANT_ID" '.flags[] | select(.key=="maf_runtime_primary" and .tenantId == $tenant) | .rolloutPercentage // 100' <<<"$FLAGS_JSON")"

  if [ -z "$PRIMARY_ROLLBACK" ]; then
    PRIMARY_ROLLBACK="$MISSING_VALUE"
  fi
  if [ -z "$PRIMARY_ROLLBACK_PERCENTAGE" ]; then
    PRIMARY_ROLLBACK_PERCENTAGE="100"
  fi
  PRIMARY_ROLLBACK_METADATA="$(jq -c --arg tenant "$TENANT_ID" '.flags[] | select(.key=="maf_runtime_primary" and .tenantId == $tenant) | .metadata // {}' <<<"$FLAGS_JSON")"
  if [ -z "$PRIMARY_ROLLBACK_METADATA" ]; then
    PRIMARY_ROLLBACK_METADATA="{}"
  fi

  DISABLED_ROLLBACK="$(jq -r --arg tenant "$TENANT_ID" '.flags[] | select(.key=="maf_runtime_disabled" and .tenantId == $tenant) | .enabled // empty | tostring' <<<"$FLAGS_JSON")"
  if [ -z "$DISABLED_ROLLBACK" ]; then
    DISABLED_ROLLBACK="$MISSING_VALUE"
  fi
  DISABLED_ROLLBACK_METADATA="$(jq -c --arg tenant "$TENANT_ID" '.flags[] | select(.key=="maf_runtime_disabled" and .tenantId == $tenant) | .metadata // {}' <<<"$FLAGS_JSON")"
  if [ -z "$DISABLED_ROLLBACK_METADATA" ]; then
    DISABLED_ROLLBACK_METADATA="{}"
  fi
}

check_kill_switch_inactive_for_tenant() {
  local currently_disabled
  currently_disabled="$(jq -r --arg tenant "$TENANT_ID" '
    [ .flags[]
      | select(.key == "maf_runtime_disabled" and (.tenantId == null or .tenantId == $tenant) and .enabled == true)
    ] | length > 0
  ' <<<"$FLAGS_JSON")"

  if [ "$currently_disabled" = "true" ]; then
    echo "FAIL: runtime is already in kill-switch mode for this tenant/global scope." >&2
    echo "ROLLBACK_READY=0"
    exit 1
  fi
}

run_simulate() {
  local suffix="$1"
  local body_file
  body_file="$(mktemp)"
  local status
  status="$(curl -sS -o "$body_file" -w "%{http_code}" -X POST "$API_BASE/dev/simulate-message" \
    -H "Content-Type: application/json" \
    ${ADMIN_HEADERS[@]+"${ADMIN_HEADERS[@]}"} \
    -d "{
      \"tenantId\":\"$TENANT_ID\",
      \"userId\":\"$USER_ID-$suffix\",
      \"userName\":\"Smoke Primary Verifier\",
      \"text\":\"$MESSAGE_TEXT\"
    }" || true)"
  status="${status:-000}"

  if [ "$status" -ne 202 ]; then
    echo "FAIL: simulate-message returned HTTP $status (suffix=$suffix)." >&2
    cat "$body_file" >&2
    rm -f "$body_file"
    echo "ROLLBACK_READY=0"
    exit 1
  fi

  local trace_id
  local conversation_id
  local inbound_message_id
  trace_id="$(jq -r '.traceId // empty' "$body_file")"
  conversation_id="$(jq -r '.conversationId // empty' "$body_file")"
  inbound_message_id="$(jq -r '.messageId // empty' "$body_file")"
  rm -f "$body_file"

  if [ -z "$trace_id" ] || [ -z "$conversation_id" ] || [ -z "$inbound_message_id" ]; then
    echo "FAIL: simulate-message response missing required identifiers (suffix=$suffix)." >&2
    echo "ROLLBACK_READY=0"
    exit 1
  fi

  echo "$trace_id|$conversation_id|$inbound_message_id"
}

check_api_readiness() {
  local status
  status="$(curl -sS -o /tmp/maf-triage-health.json -w "%{http_code}" "$API_BASE/health/ready" || true)"
  status="${status:-000}"
  if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
    echo "FAIL: API readiness probe failed (HTTP $status) at $API_BASE/health/ready" >&2
    echo "ROLLBACK_READY=0"
    exit 1
  fi
}

check_database_ready() {
  local psql_result
  psql_result="$(psql "$DATABASE_URL" -t -A -c "SELECT 1;" 2>/dev/null | tr -d '[:space:]')"
  if [ "$psql_result" != "1" ]; then
    echo "FAIL: DATABASE_URL probe failed: $psql_result" >&2
    if [ -z "$psql_result" ]; then
      psql_result="$(psql "$DATABASE_URL" -c "SELECT 1;" 2>&1 || true)"
      echo "FAIL: DATABASE_URL probe full output: $psql_result" >&2
    fi
    echo "ROLLBACK_READY=0"
    exit 1
  fi
}

check_attempt() {
  local trace_id="$1"
  local expected_mode="$2"
  local require_committed="$3"
  local row
  local attempts=12
  local elapsed=0

  while true; do
    row="$(psql "$DATABASE_URL" -t -A -F'|' -c \
      "SELECT runtime_mode, phase FROM runtime_attempts WHERE tenant_id = '$TENANT_ID' AND trace_id = '$trace_id' ORDER BY created_at DESC LIMIT 1;")"
    if [ -n "$row" ]; then
      break
    fi
    if [ "$elapsed" -ge "$attempts" ]; then
      break
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  if [ -z "$row" ]; then
    echo "FAIL: no runtime_attempts row for trace $trace_id (expected mode=$expected_mode)." >&2
    echo "ROLLBACK_READY=0"
    exit 1
  fi

  local mode
  local phase
  mode="${row%%|*}"
  phase="${row#*|}"
  if [ "$mode" != "$expected_mode" ]; then
    echo "FAIL: runtime mode mismatch for trace $trace_id (expected=$expected_mode, actual=$mode)." >&2
    echo "ROLLBACK_READY=0"
    exit 1
  fi

  if [ "$require_committed" = "1" ]; then
    attempts=20
    elapsed=0
    while [ "$phase" != "reply_committed" ] && [ "$phase" != "actions_committed" ]; do
      if [ "$elapsed" -ge "$attempts" ]; then
        echo "FAIL: runtime phase for trace $trace_id is not committed (actual=$phase)." >&2
        echo "ROLLBACK_READY=0"
        exit 1
      fi
      sleep 1
      row="$(psql "$DATABASE_URL" -t -A -F'|' -c \
        "SELECT runtime_mode, phase FROM runtime_attempts WHERE tenant_id = '$TENANT_ID' AND trace_id = '$trace_id' ORDER BY created_at DESC LIMIT 1;")"
      mode="${row%%|*}"
      phase="${row#*|}"
      elapsed=$((elapsed + 1))
    done
  fi
}

main() {
  check_api_readiness
  check_database_ready
  snapshot_flags
  check_kill_switch_inactive_for_tenant
  trap restore_flags EXIT

  run_admin_put "maf_runtime_disabled" '{"enabled":true,"rolloutPercentage":100}' true

  kill_check_data="$(run_simulate "kill")"
  kill_trace="${kill_check_data%%|*}"
  check_attempt "$kill_trace" "maf_disabled" 0

  if [ "$DISABLED_ROLLBACK" = "$MISSING_VALUE" ]; then
    run_admin_delete "maf_runtime_disabled" true
  else
    run_admin_put "maf_runtime_disabled" "{\"enabled\":$DISABLED_ROLLBACK,\"rolloutPercentage\":100}" true
  fi

  run_admin_put "maf_runtime_primary" '{"enabled":true,"rolloutPercentage":100}' true
  primary_data="$(run_simulate "primary")"
  primary_trace="${primary_data%%|*}"
  check_attempt "$primary_trace" "maf_primary" 1

  echo "ROLLBACK_READY=1"
  echo "kill_trace=$kill_trace"
  echo "primary_trace=$primary_trace"
}

main "$@"
