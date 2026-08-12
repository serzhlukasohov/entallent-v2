#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

ENV_FILE="${ENV_FILE:-.env}"

normalize_env_value() {
  local raw="$1"
  raw="${raw#\"}"
  raw="${raw%\"}"
  raw="${raw#\'}"
  raw="${raw%\'}"
  printf '%s' "$raw"
}

load_env_defaults() {
  if [ ! -f "$ENV_FILE" ]; then
    return 0
  fi

  while IFS='=' read -r key value; do
    if [ -z "$key" ] || [ "${key#\#}" != "$key" ] || [ -z "$value" ]; then
      continue
    fi

    if [ -z "${!key+x}" ]; then
      value="$(normalize_env_value "$value")"
      export "$key=$value"
    fi
  done < <(sed -n 's/^\([A-Z0-9_]*\)=\(.*\)$/\1=\2/p' "$ENV_FILE")
}

load_env_defaults

normalize_psql_bool() {
  case "$1" in
    t | T | true | TRUE | True) echo "true" ;;
    f | F | false | FALSE | False) echo "false" ;;
    *) echo "$1" ;;
  esac
}

API_PORT="${API_PORT:-3000}"
WORKER_PORT="${WORKER_PORT:-3001}"
SERVICE_PORT="${SERVICE_PORT:-18180}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
REDIS_URL="${REDIS_URL:?REDIS_URL is required}"
TENANT_ID="${TENANT_ID:-${DEFAULT_TENANT_ID:-}}"
FIELD_ENCRYPTION_KEY="${FIELD_ENCRYPTION_KEY:?FIELD_ENCRYPTION_KEY is required}"
INTERNAL_SERVICE_AUTH_SECRET="${INTERNAL_SERVICE_AUTH_SECRET:-agent-service-internal-secret-000000000000}"
AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET="${AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET:-$INTERNAL_SERVICE_AUTH_SECRET}"
AGENT_SERVICE_INTERNAL_API_URL="${SMOKE_AGENT_SERVICE_INTERNAL_API_URL:-http://127.0.0.1:${API_PORT}/api/v1}"

export API_PORT WORKER_PORT SERVICE_PORT DATABASE_URL REDIS_URL TENANT_ID FIELD_ENCRYPTION_KEY
export INTERNAL_SERVICE_AUTH_SECRET AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET AGENT_SERVICE_INTERNAL_API_URL
export ADMIN_API_KEY="${ADMIN_API_KEY:-}"
export AGENT_SERVICE_MODEL_PROVIDER="${AGENT_SERVICE_MODEL_PROVIDER:-disabled}"
export AGENT_SERVICE_MODEL_NAME="${AGENT_SERVICE_MODEL_NAME:-${OPENAI_MODEL_BALANCED:-gpt-5.4-mini}}"

SLACK_TEAM_ID="${SLACK_TEST_TEAM_ID:-${SLACK_TEAM_ID:-}}"
SLACK_SIGNING_SECRET="${SLACK_TEST_SIGNING_SECRET:-${SLACK_SIGNING_SECRET:-}}"
SLACK_BOT_TOKEN="${SLACK_TEST_BOT_TOKEN:-${SLACK_BOT_TOKEN:-}}"
SLACK_CHANNEL_ID="${SLACK_TEST_CHANNEL_ID:-${SLACK_CHANNEL_ID:-}}"
SLACK_USER_ID="${SLACK_TEST_USER_ID:-${SLACK_USER_ID:-}}"
SLACK_TEXT_PREFIX="${SLACK_TEXT_PREFIX:-Smoke local MAF check}"
SLACK_TEST_TEXT="${SLACK_TEST_TEXT:-}"

BOOTSTRAP_PREP="${BOOTSTRAP_PREP:-1}"
SLACK_PUBLIC_URL="${SLACK_PUBLIC_URL:-http://127.0.0.1:${API_PORT}}"
SKIP_EVENT_SEND="${SKIP_EVENT_SEND:-0}"
KEEP_STACK_UP="${KEEP_STACK_UP:-0}"
START_NGROK="${START_NGROK:-0}"
AUTO_CLEAN_PORTS="${AUTO_CLEAN_PORTS:-1}"

TEST_ID="$(date +%s%N)"
SLACK_TEST_TEXT="${SLACK_TEST_TEXT:-${SLACK_TEXT_PREFIX} ${TEST_ID}}"
API_BASE="${SLACK_PUBLIC_URL%/}/api/v1"
EVENT_URL="${API_BASE}/channel/slack/events"
POLL_SECONDS="${POLL_SECONDS:-40}"
PYTHON_VENV_DIR="${PYTHON_VENV_DIR:-agent-service/.venv}"
RUNNER_PIDS=()
PRIOR_PRIMARY_ENABLED=""
PRIOR_PRIMARY_ROLLOUT=""
PRIOR_DISABLED_ENABLED=""
PRIOR_DISABLED_ROLLOUT=""
RESTORING_FLAGS=0

if [ -z "$TENANT_ID" ]; then
  echo "FAIL: TENANT_ID is required (set TENANT_ID or DEFAULT_TENANT_ID)." >&2
  exit 1
fi

if [[ "$FIELD_ENCRYPTION_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
  :
else
  echo "FAIL: FIELD_ENCRYPTION_KEY is invalid. It must be exactly 64 hexadecimal characters." >&2
  echo "Current value is: ${FIELD_ENCRYPTION_KEY}" >&2
  exit 1
fi

if [ -z "$SLACK_TEAM_ID" ] || [ -z "$SLACK_SIGNING_SECRET" ] || [ -z "$SLACK_BOT_TOKEN" ]; then
  echo "FAIL: Slack workspace credentials are required." >&2
  echo "Set SLACK_TEAM_ID, SLACK_SIGNING_SECRET, and SLACK_BOT_TOKEN (or SLACK_TEST_* variants)." >&2
  exit 1
fi

if [ "$SKIP_EVENT_SEND" != "1" ] && ( [ -z "$SLACK_CHANNEL_ID" ] || [ -z "$SLACK_USER_ID" ] ); then
  echo "FAIL: SLACK_CHANNEL_ID and SLACK_USER_ID are required for signed event send." >&2
  echo "Set them in env, or set SKIP_EVENT_SEND=1 to only validate the setup steps." >&2
  exit 1
fi

log() {
  echo "[$(date '+%H:%M:%S')] $*"
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "FAIL: required command missing: $cmd" >&2
    exit 1
  fi
}

wait_for_http() {
  local url="$1"
  local name="$2"
  local retries="${3:-40}"
  local err_file="/tmp/maf-slack-smoke-curl.err"
  for i in $(seq 1 "$retries"); do
    local code
    code="$(curl -sS -o /tmp/maf-slack-smoke-http.txt -w "%{http_code}" "$url" 2>"$err_file" || true)"
    if [ "$code" -ge 200 ] && [ "$code" -lt 300 ]; then
      return 0
    fi
    sleep 1
  done
  echo "FAIL: timeout waiting for $name (${url})" >&2
  echo "--- response tail ---"
  cat /tmp/maf-slack-smoke-http.txt >&2 || true
  return 1
}

kill_port_listeners() {
  if [ "$AUTO_CLEAN_PORTS" != "1" ]; then
    return 0
  fi

  local port="$1"
  local label="$2"
  if ! command -v lsof >/dev/null 2>&1; then
    log "lsof not installed; skipping port cleanup for $label on :$port"
    return 0
  fi

  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN -P -n 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    return 0
  fi

  log "Port $port (${label}) is in use. Attempting to stop stale process(es): $pids"
  for pid in $pids; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done

  for i in $(seq 1 12); do
    pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN -P -n 2>/dev/null || true)"
    if [ -z "$pids" ]; then
      log "Port $port (${label}) is now free"
      return 0
    fi
    sleep 1
  done

  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN -P -n 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    log "Port $port (${label}) did not free with SIGTERM. Forcing stop: $pids"
    for pid in $pids; do
      if kill -0 "$pid" >/dev/null 2>&1; then
        kill -9 "$pid" >/dev/null 2>&1 || true
      fi
    done
    sleep 1
  fi

  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN -P -n 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "WARN: could not free port $port (${label}) automatically. Continuing anyway." >&2
  else
    log "Port $port (${label}) is now free"
  fi
}

clean_runtime_ports() {
  kill_port_listeners "$SERVICE_PORT" "agent-service"
  kill_port_listeners "$API_PORT" "api"
  kill_port_listeners "$WORKER_PORT" "worker"
}

cleanup() {
  for pid in "${RUNNER_PIDS[@]:-}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
  restore_runtime_flags
}
trap cleanup EXIT INT TERM

get_flag_state() {
  local key="$1"
  query_scalar "SELECT enabled, rollout_percentage FROM feature_flags WHERE key='${key}' AND tenant_id='${TENANT_ID}' LIMIT 1;"
}

restore_runtime_flags() {
  if [ -z "${RESTORING_FLAGS:-}" ]; then
    return 0
  fi
  if [ "$RESTORING_FLAGS" != "1" ]; then
    return 0
  fi

  if [ "$PRIOR_PRIMARY_ENABLED" = "__missing__" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM feature_flags WHERE key='maf_runtime_primary' AND tenant_id='${TENANT_ID}';" >/dev/null
  else
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "UPDATE feature_flags SET enabled = ${PRIOR_PRIMARY_ENABLED}, rollout_percentage = ${PRIOR_PRIMARY_ROLLOUT}, metadata='{}' WHERE key='maf_runtime_primary' AND tenant_id='${TENANT_ID}';" >/dev/null
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO feature_flags (key, tenant_id, enabled, rollout_percentage, metadata) SELECT 'maf_runtime_primary', '${TENANT_ID}', ${PRIOR_PRIMARY_ENABLED}, ${PRIOR_PRIMARY_ROLLOUT}, '{}' WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key='maf_runtime_primary' AND tenant_id='${TENANT_ID}');" >/dev/null
  fi

  if [ "$PRIOR_DISABLED_ENABLED" = "__missing__" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM feature_flags WHERE key='maf_runtime_disabled' AND tenant_id='${TENANT_ID}';" >/dev/null
  else
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "UPDATE feature_flags SET enabled = ${PRIOR_DISABLED_ENABLED}, rollout_percentage = ${PRIOR_DISABLED_ROLLOUT}, metadata='{}' WHERE key='maf_runtime_disabled' AND tenant_id='${TENANT_ID}';" >/dev/null
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO feature_flags (key, tenant_id, enabled, rollout_percentage, metadata) SELECT 'maf_runtime_disabled', '${TENANT_ID}', ${PRIOR_DISABLED_ENABLED}, ${PRIOR_DISABLED_ROLLOUT}, '{}' WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key='maf_runtime_disabled' AND tenant_id='${TENANT_ID}');" >/dev/null
  fi

  RESTORING_FLAGS=0
}

set_runtime_flags() {
  local primary_state
  local disabled_state

  primary_state="$(get_flag_state 'maf_runtime_primary')"
  if [ -z "$primary_state" ]; then
    PRIOR_PRIMARY_ENABLED="__missing__"
    PRIOR_PRIMARY_ROLLOUT="100"
  else
    IFS='|' read -r PRIOR_PRIMARY_ENABLED PRIOR_PRIMARY_ROLLOUT <<<"$primary_state"
    PRIOR_PRIMARY_ENABLED="$(normalize_psql_bool "$PRIOR_PRIMARY_ENABLED")"
  fi

  disabled_state="$(get_flag_state 'maf_runtime_disabled')"
  if [ -z "$disabled_state" ]; then
    PRIOR_DISABLED_ENABLED="__missing__"
    PRIOR_DISABLED_ROLLOUT="100"
  else
    IFS='|' read -r PRIOR_DISABLED_ENABLED PRIOR_DISABLED_ROLLOUT <<<"$disabled_state"
    PRIOR_DISABLED_ENABLED="$(normalize_psql_bool "$PRIOR_DISABLED_ENABLED")"
  fi

  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM feature_flags WHERE tenant_id='${TENANT_ID}' AND key IN ('maf_runtime_primary','maf_runtime_disabled');" >/dev/null
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO feature_flags (key, tenant_id, enabled, rollout_percentage, metadata) VALUES ('maf_runtime_disabled', '${TENANT_ID}', false, 100, '{}');" >/dev/null
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO feature_flags (key, tenant_id, enabled, rollout_percentage, metadata) VALUES ('maf_runtime_primary', '${TENANT_ID}', true, 100, '{}');" >/dev/null
  RESTORING_FLAGS=1
}

start_agent_service() {
  local requested_path="$PYTHON_VENV_DIR/bin/python"
  local requested_path_py3="$PYTHON_VENV_DIR/bin/python3"
  local python_path=""

  if [[ "$requested_path" != /* ]]; then
    requested_path="$REPO_DIR/$requested_path"
    requested_path_py3="$REPO_DIR/$requested_path_py3"
  fi

  if [ -x "$requested_path" ]; then
    python_path="$requested_path"
  elif [ -x "$requested_path_py3" ]; then
    python_path="$requested_path_py3"
  else
    echo "FAIL: Python executable not found at ${requested_path} or ${requested_path_py3}. Set PYTHON_VENV_DIR or install deps." >&2
    exit 1
  fi
  local service_log=/tmp/maf-slack-smoke-agent.log
  (
    cd "$REPO_DIR/agent-service"
    AGENT_SERVICE_MODEL_PROVIDER="$AGENT_SERVICE_MODEL_PROVIDER" \
    AGENT_SERVICE_MODEL_NAME="$AGENT_SERVICE_MODEL_NAME" \
    AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET="$AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET" \
    AGENT_SERVICE_INTERNAL_API_URL="$AGENT_SERVICE_INTERNAL_API_URL" \
    AGENT_SERVICE_PORT="$SERVICE_PORT" \
    AGENT_SERVICE_AZURE_OPENAI_ENDPOINT="${AGENT_SERVICE_AZURE_OPENAI_ENDPOINT:-${AZURE_OPENAI_ENDPOINT:-}}" \
    AGENT_SERVICE_AZURE_OPENAI_API_KEY="${AGENT_SERVICE_AZURE_OPENAI_API_KEY:-${AZURE_OPENAI_API_KEY:-}}" \
    AGENT_SERVICE_AZURE_OPENAI_API_VERSION="${AGENT_SERVICE_AZURE_OPENAI_API_VERSION:-${AZURE_OPENAI_API_VERSION:-}}" \
    FIELD_ENCRYPTION_KEY="$FIELD_ENCRYPTION_KEY" \
    "$python_path" -m uvicorn agent_service.main:create_app --factory --host 127.0.0.1 --port "$SERVICE_PORT" --log-level info >"$service_log" 2>&1
  ) &
  RUNNER_PIDS+=("$!")
}

start_api_worker() {
  local api_log=/tmp/maf-slack-smoke-api.log
  local worker_log=/tmp/maf-slack-smoke-worker.log

  (
    API_PORT="$API_PORT" \
    WORKER_PORT="$WORKER_PORT" \
    DATABASE_URL="$DATABASE_URL" \
    REDIS_URL="$REDIS_URL" \
    AGENT_SERVICE_INTERNAL_URL="http://127.0.0.1:${SERVICE_PORT}" \
    INTERNAL_SERVICE_AUTH_SECRET="$INTERNAL_SERVICE_AUTH_SECRET" \
    FIELD_ENCRYPTION_KEY="$FIELD_ENCRYPTION_KEY" \
    ADMIN_API_KEY="$ADMIN_API_KEY" \
    node apps/api/dist/main.js >"$api_log" 2>&1
  ) &
  RUNNER_PIDS+=("$!")

  (
    WORKER_PORT="$WORKER_PORT" \
    API_PORT="$API_PORT" \
    DATABASE_URL="$DATABASE_URL" \
    REDIS_URL="$REDIS_URL" \
    AGENT_SERVICE_INTERNAL_URL="http://127.0.0.1:${SERVICE_PORT}" \
    INTERNAL_SERVICE_AUTH_SECRET="$INTERNAL_SERVICE_AUTH_SECRET" \
    FIELD_ENCRYPTION_KEY="$FIELD_ENCRYPTION_KEY" \
    ADMIN_API_KEY="$ADMIN_API_KEY" \
    node apps/worker/dist/main.js >"$worker_log" 2>&1
  ) &
  RUNNER_PIDS+=("$!")
}

start_ngrok_tunnel() {
  if [ "$START_NGROK" != "1" ]; then
    return 0
  fi

  require_cmd ngrok
  log "Starting ngrok tunnel for http://127.0.0.1:${API_PORT}"
  local ngrok_log=/tmp/maf-slack-smoke-ngrok.log
  (
    ngrok http "http://127.0.0.1:${API_PORT}" >"$ngrok_log" 2>&1
  ) &
  local ngrok_pid=$!
  RUNNER_PIDS+=("$ngrok_pid")

  local ngrok_url=""
  for i in $(seq 1 30); do
    ngrok_url="$(curl -sS http://127.0.0.1:4040/api/tunnels || true | node -e "const fs = require('node:fs'); const data = fs.readFileSync(0, 'utf8'); try { const parsed = JSON.parse(data); const tunnel = (parsed.tunnels || []).find((t) => t.proto === 'https') || (parsed.tunnels || [])[0]; process.stdout.write(tunnel && tunnel.public_url ? tunnel.public_url : ''); } catch { process.stdout.write(''); }")"
    if [ -n "$ngrok_url" ]; then
      break
    fi
    sleep 1
  done

  if [ -n "$ngrok_url" ]; then
    log "ngrok public URL: $ngrok_url"
    log "Configure Slack Events URL: ${ngrok_url}/api/v1/channel/slack/events"
  else
    echo "WARN: ngrok tunnel started but public URL was not detected yet. Check $ngrok_log." >&2
  fi
}

query_scalar() {
  local query="$1"
  psql "$DATABASE_URL" -t -A -F'|' -c "$query"
}

build_signed_payload() {
  local payload_file=$1
  local request_ts=$2
  local event_ts="${3}"
  local event_id="${4}"
  node - <<NODE >"$payload_file"
const obj = {
  token: 'local-slack-smoke',
  team_id: process.env.SLACK_TEAM_ID,
  api_app_id: 'maf-live-smoke',
  type: 'event_callback',
  event: {
    type: 'message',
    user: process.env.SLACK_USER_ID,
    text: process.env.SLACK_TEST_TEXT,
    channel: process.env.SLACK_CHANNEL_ID,
    ts: process.env.SLACK_EVENT_TS || process.env.SLACK_MESSAGE_TS,
    event_ts: process.env.SLACK_MESSAGE_TS,
    channel_type: 'im',
    team: process.env.SLACK_TEAM_ID,
  },
  event_id: process.env.SLACK_EVENT_ID,
  event_time: Number(process.env.SLACK_EVENT_TIME),
};
process.stdout.write(JSON.stringify(obj));
NODE
}

sign_payload() {
  local payload_file=$1
  local request_ts=$2
  node - "$payload_file" "$SLACK_SIGNING_SECRET" "$request_ts" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const body = fs.readFileSync(process.argv[2], 'utf8');
const secret = process.argv[3];
const ts = process.argv[4];
const sig = crypto.createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');
process.stdout.write(`v0=${sig}`);
NODE
}

send_slack_event() {
  local payload_file=$1
  local signature
  local now_ts=$2
  signature="$(sign_payload "$payload_file" "$now_ts")"
  local response_file=/tmp/maf-slack-smoke-response.json
  local code
  code="$(curl -sS -o "$response_file" -w "%{http_code}" \
    -X POST "$EVENT_URL" \
    -H "Content-Type: application/json" \
    -H "X-Slack-Request-Timestamp: $now_ts" \
    -H "X-Slack-Signature: $signature" \
    -d "@${payload_file}" || true)"
  if [ "$code" -lt 200 ] || [ "$code" -ge 300 ]; then
    echo "FAIL: Slack event endpoint returned HTTP $code" >&2
    echo "--- response ---" >&2
    cat "$response_file" >&2 || true
    exit 1
  fi
  log "Slack event sent to ${EVENT_URL} (HTTP $code)"
}

main() {
  require_cmd node
  require_cmd curl
  require_cmd psql
  require_cmd pnpm

  export SLACK_TEAM_ID SLACK_SIGNING_SECRET SLACK_BOT_TOKEN SLACK_CHANNEL_ID SLACK_USER_ID SLACK_TEST_TEXT

  log "Step 1) optional local bootstrap preflight"
  if [ "$BOOTSTRAP_PREP" = "1" ]; then
    if SKIP_SERVICES=1 SKIP_SMOKE=1 pnpm run maf:live:bootstrap; then
      log "Bootstrap preflight complete"
    else
      echo "FAIL: bootstrap preflight failed" >&2
      exit 1
    fi
  else
    log "BOOTSTRAP_PREP=0, skipping bootstrap preflight"
  fi

  log "Step 2) set runtime flags for the test tenant (maf_runtime_primary=true, maf_runtime_disabled=false)"
  set_runtime_flags

  log "Step 3) upsert Slack workspace credentials"
  node scripts/setup-slack-workspace.mjs \
    --team-id "$SLACK_TEAM_ID" \
    --bot-token "$SLACK_BOT_TOKEN" \
    --signing-secret "$SLACK_SIGNING_SECRET" \
    --tenant-id "$TENANT_ID"

  log "Step 4) start local agent-service + api + worker"
  clean_runtime_ports
  start_agent_service
  start_api_worker
  start_ngrok_tunnel

  wait_for_http "http://127.0.0.1:${SERVICE_PORT}/health/ready" "agent-service" 80
  wait_for_http "http://127.0.0.1:${API_PORT}/api/v1/health/ready" "api live" 80
  wait_for_http "http://127.0.0.1:${WORKER_PORT}/health/ready" "worker ready" 80
  log "Step 4 checks passed: agent-service ${SERVICE_PORT}, api ${API_PORT}, worker ${WORKER_PORT}"

  if [ "$SKIP_EVENT_SEND" = "1" ]; then
    if [ "$KEEP_STACK_UP" = "1" ]; then
      log "SKIP_EVENT_SEND=1, stack is up and ready."
      log "Press Ctrl+C to stop and restore test runtime flags."
      log "Tips: tail logs -> tail -f /tmp/maf-slack-smoke-agent.log /tmp/maf-slack-smoke-api.log /tmp/maf-slack-smoke-worker.log"
      tail -n 80 -f /tmp/maf-slack-smoke-agent.log /tmp/maf-slack-smoke-api.log /tmp/maf-slack-smoke-worker.log
    fi
    log "SKIP_EVENT_SEND=1, exiting without sending test event."
    return 0
  fi

  local message_ts
  local event_id="evt-$TEST_ID"
  local event_time
  local payload_file
  local now_ts

  now_ts="$(date +%s)"
  event_time="$now_ts"
  message_ts="${now_ts}.000001"
  payload_file="$(mktemp)"
  export SLACK_EVENT_TIME="$event_time"
  export SLACK_EVENT_TS="$message_ts"
  export SLACK_EVENT_ID="$event_id"

  log "Step 5) send signed Slack event to ${EVENT_URL}"
  build_signed_payload "$payload_file" "$now_ts" "$message_ts" "$event_id"
  send_slack_event "$payload_file" "$now_ts"

  local inbound_row=""
  local inbound_id=""
  local conversation_id=""
  local trace_id=""

  log "Step 6) wait for inbound message and outbound agent reply"
  for i in $(seq 1 "$POLL_SECONDS"); do
    inbound_row="$(query_scalar "SELECT id, conversation_id, COALESCE(trace_id::text,'') FROM messages WHERE tenant_id='${TENANT_ID}' AND direction='inbound' AND text LIKE '%${TEST_ID}%' ORDER BY occurred_at DESC LIMIT 1;")"
    if [ -n "$inbound_row" ]; then
      IFS='|' read -r inbound_id conversation_id trace_id <<<"$inbound_row"
      if [ -n "$inbound_id" ] && [ -n "$trace_id" ]; then
        break
      fi
    fi
    sleep 1
  done

  if [ -z "$inbound_id" ]; then
    echo "FAIL: no inbound Slack message persisted after ${POLL_SECONDS}s" >&2
    return 1
  fi
  log "inbound_id=$inbound_id conversation_id=$conversation_id trace_id=$trace_id"

  local outbound_row=""
  local outbound_id=""
  for i in $(seq 1 "$POLL_SECONDS"); do
    outbound_row="$(query_scalar "SELECT id FROM messages WHERE conversation_id='${conversation_id}' AND direction='outbound' AND trace_id='${trace_id}' ORDER BY occurred_at DESC LIMIT 1;")"
    if [ -n "$outbound_row" ]; then
      outbound_id="$outbound_row"
      break
    fi
    sleep 1
  done

  local run_ok="0"
  if [ -n "$outbound_id" ]; then
    run_ok="1"
    log "outbound_message_id=$outbound_id"
  else
    log "outbound message not found yet (worker may still be processing)"
  fi

  local runtime_rows
  runtime_rows="$(query_scalar "SELECT runtime_mode, phase, COALESCE(failure_reason, '') FROM runtime_attempts WHERE tenant_id='${TENANT_ID}' AND message_id='${inbound_id}' ORDER BY created_at DESC;")"
  local committed_runtime_count
  committed_runtime_count="$(query_scalar "SELECT COUNT(*) FROM runtime_attempts WHERE tenant_id='${TENANT_ID}' AND message_id='${inbound_id}' AND runtime_mode='maf_primary' AND phase='reply_committed' AND failure_reason IS NULL;")"
  local failed_runtime_count
  failed_runtime_count="$(query_scalar "SELECT COUNT(*) FROM runtime_attempts WHERE tenant_id='${TENANT_ID}' AND message_id='${inbound_id}' AND runtime_mode='maf_primary' AND (phase='failed' OR failure_reason IS NOT NULL);")"
  local outbound_metadata=""
  local outbound_runtime_mode=""
  if [ -n "$outbound_id" ]; then
    outbound_metadata="$(query_scalar "SELECT COALESCE(metadata::text, '') FROM messages WHERE id='${outbound_id}' LIMIT 1;")"
    outbound_runtime_mode="$(query_scalar "SELECT COALESCE(metadata->>'runtimeMode', '') FROM messages WHERE id='${outbound_id}' LIMIT 1;")"
  fi

  echo "--- runtime attempt ---"
  echo "$runtime_rows"
  echo "--- runtime summary ---"
  echo "committed_maf_primary=${committed_runtime_count} failed_maf_primary=${failed_runtime_count}"
  echo "--- outbound metadata ---"
  echo "$outbound_metadata"
  echo "--- workspace verification ---"
  echo "tenant=$TENANT_ID channel=$SLACK_CHANNEL_ID user=$SLACK_USER_ID run_id=$TEST_ID"

  if [ "$run_ok" = "1" ] \
    && [ "$committed_runtime_count" -gt 0 ] \
    && [ "$failed_runtime_count" -eq 0 ] \
    && [ "$outbound_runtime_mode" = "maf_primary" ]; then
    log "Local Slack end-to-end path looks green."
    return 0
  fi

  if [ "$run_ok" != "1" ]; then
    echo "FAIL: outbound message was not persisted in time." >&2
  fi
  if [ -n "$runtime_rows" ] && ! printf '%s' "$runtime_rows" | grep -q 'maf_primary'; then
    echo "FAIL: runtime mode is not maf_primary for the tested attempt." >&2
  fi
  if [ "$committed_runtime_count" -eq 0 ]; then
    echo "FAIL: no committed maf_primary runtime attempt was recorded for the tested inbound message." >&2
  fi
  if [ "$failed_runtime_count" -gt 0 ]; then
    echo "FAIL: failed maf_primary runtime attempt(s) were recorded for the tested inbound message." >&2
  fi
  if [ "$outbound_runtime_mode" != "maf_primary" ]; then
    echo "FAIL: outbound message metadata does not prove maf_primary produced the reply." >&2
  fi
  return 1
}

main "$@"
