#!/usr/bin/env bash
set -euo pipefail

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5434/entalent}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6380}"
export API_PORT="${API_PORT:-3110}"
export WORKER_PORT="${WORKER_PORT:-3111}"
export SERVICE_PORT="${SERVICE_PORT:-18180}"
export TENANT_ID="${TENANT_ID:-7d1e0163-6d53-4713-bd24-254690cc5090}"
export AGENT_SERVICE_MODEL_PROVIDER="${AGENT_SERVICE_MODEL_PROVIDER:-azure_openai}"
export AGENT_SERVICE_MODEL_NAME="${AGENT_SERVICE_MODEL_NAME:-${OPENAI_MODEL_BALANCED:-gpt-5.4-mini}}"

: "${FIELD_ENCRYPTION_KEY?FIELD_ENCRYPTION_KEY is required for API startup}"
: "${INTERNAL_SERVICE_AUTH_SECRET?INTERNAL_SERVICE_AUTH_SECRET is required (set a shared secret for API + agent-service)}"
: "${AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET?AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET is required (same value as INTERNAL_SERVICE_AUTH_SECRET)}"

export AGENT_SERVICE_INTERNAL_URL="http://127.0.0.1:${SERVICE_PORT}"
export AGENT_SERVICE_INTERNAL_API_URL
export API_BASE="http://127.0.0.1:${API_PORT}/api/v1"
export AGENT_SERVICE_INTERNAL_API_URL="${API_BASE}"

SIMULATE_HEADERS=("-H" "Content-Type: application/json")
if [ -n "${ADMIN_API_KEY:-}" ]; then
  SIMULATE_HEADERS+=("-H" "X-Api-Key: ${ADMIN_API_KEY}")
fi

source agent-service/.venv/bin/activate

(
  AGENT_SERVICE_MODEL_PROVIDER="${AGENT_SERVICE_MODEL_PROVIDER}" \
  AGENT_SERVICE_MODEL_NAME="${AGENT_SERVICE_MODEL_NAME}" \
  AGENT_SERVICE_AZURE_OPENAI_ENDPOINT="${AGENT_SERVICE_AZURE_OPENAI_ENDPOINT:-${AZURE_OPENAI_ENDPOINT:-}}" \
  AGENT_SERVICE_AZURE_OPENAI_API_KEY="${AGENT_SERVICE_AZURE_OPENAI_API_KEY:-${AZURE_OPENAI_API_KEY:-}}" \
  AGENT_SERVICE_AZURE_OPENAI_API_VERSION="${AGENT_SERVICE_AZURE_OPENAI_API_VERSION:-${AZURE_OPENAI_API_VERSION:-}}" \
  AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET="${AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET}" \
  AGENT_SERVICE_INTERNAL_API_URL="${AGENT_SERVICE_INTERNAL_API_URL}" \
  AGENT_SERVICE_PORT="${SERVICE_PORT}" \
  python -m uvicorn agent_service.main:create_app --factory --host 127.0.0.1 --port "${SERVICE_PORT}" --log-level warning > /tmp/maf-smoke-agent.log 2>&1
) &
AGENT_PID=$!

(
  API_PORT="${API_PORT}" \
  WORKER_PORT="${WORKER_PORT}" \
  DATABASE_URL="${DATABASE_URL}" \
  REDIS_URL="${REDIS_URL}" \
  AGENT_SERVICE_INTERNAL_URL="${AGENT_SERVICE_INTERNAL_URL}" \
  INTERNAL_SERVICE_AUTH_SECRET="${INTERNAL_SERVICE_AUTH_SECRET}" \
  FIELD_ENCRYPTION_KEY="${FIELD_ENCRYPTION_KEY}" \
  ADMIN_API_KEY="${ADMIN_API_KEY:-}" \
  node apps/api/dist/main.js > /tmp/maf-smoke-api.log 2>&1
) &
API_PID=$!

(
  WORKER_PORT="${WORKER_PORT}" \
  API_PORT="${API_PORT}" \
  DATABASE_URL="${DATABASE_URL}" \
  REDIS_URL="${REDIS_URL}" \
  AGENT_SERVICE_INTERNAL_URL="${AGENT_SERVICE_INTERNAL_URL}" \
  INTERNAL_SERVICE_AUTH_SECRET="${INTERNAL_SERVICE_AUTH_SECRET}" \
  FIELD_ENCRYPTION_KEY="${FIELD_ENCRYPTION_KEY}" \
  ADMIN_API_KEY="${ADMIN_API_KEY:-}" \
  node apps/worker/dist/main.js > /tmp/maf-smoke-worker.log 2>&1
) &
WORKER_PID=$!

cleanup() {
  kill "$AGENT_PID" "$API_PID" "$WORKER_PID" 2>/dev/null || true
}
trap cleanup EXIT

wait_for_http() {
  local url="$1"; local name="$2"; local retries=80
  for i in $(seq 1 "$retries"); do
    if curl -sS "$url" >/dev/null 2>&1; then
      echo "[ok] $name"
      return 0
    fi
    sleep 1
  done
  echo "[timeout] $name"
  return 1
}

wait_for_http "http://127.0.0.1:${SERVICE_PORT}/health/ready" "agent-service ready"
wait_for_http "${API_BASE}/health/ready" "api live"
wait_for_http "http://127.0.0.1:${WORKER_PORT}/health/ready" "worker ready"

psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "DELETE FROM feature_flags WHERE tenant_id='${TENANT_ID}' AND key IN ('maf_runtime_primary','maf_runtime_disabled');"
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "INSERT INTO feature_flags (key, tenant_id, enabled, rollout_percentage, metadata) VALUES ('maf_runtime_disabled', '${TENANT_ID}', false, 100, '{}');"
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "INSERT INTO feature_flags (key, tenant_id, enabled, rollout_percentage, metadata) VALUES ('maf_runtime_primary', '${TENANT_ID}', true, 100, '{}');"

user="smoke-$(date +%s)"
payload=$(cat <<JSON
{
  "tenantId": "${TENANT_ID}",
  "userId": "${user}",
  "userName": "Smoke User",
  "text": "Smoke check: respond in one short sentence."
}
JSON
)

resp_file=/tmp/maf-smoke-response.json
curl -sS -X POST "${API_BASE}/dev/simulate-message" "${SIMULATE_HEADERS[@]}" -d "$payload" > "$resp_file"

conversation_id=$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(d.conversationId||'');" "$resp_file")
message_id=$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(d.messageId||'');" "$resp_file")
trace_id=$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(d.traceId||'');" "$resp_file")

if [ -z "$conversation_id" ] || [ -z "$message_id" ]; then
  echo "ERROR: simulate response parse failed"
  echo "resp=$(cat "$resp_file")"
  exit 1
fi

echo "simulate response: $(cat "$resp_file")"

outbound_id=""
for i in $(seq 1 40); do
  msgs_file=/tmp/maf-smoke-msgs-$i.json
  curl -sS "${SIMULATE_HEADERS[@]}" "${API_BASE}/dev/conversation/${conversation_id}/messages?after=${message_id}" > "$msgs_file"
  outbound_id=$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const msgs=Array.isArray(d)?d:(Array.isArray(d.messages)?d.messages:[]); const traceId=process.argv[2]||''; let o=''; for (let j=msgs.length-1; j>=0; j--) { const msg=msgs[j]; if (msg && msg.direction==='outbound' && (!traceId || msg.traceId===traceId)) { o=msg.id||''; break; } } process.stdout.write(o);" "$msgs_file" "$trace_id")
  if [ -n "$outbound_id" ]; then
    echo "found outbound after ${i}s"
    break
  fi
  sleep 1
done

if [ -z "$outbound_id" ]; then
  echo "ERROR: no outbound message detected"
  exit 1
fi

ra=$(psql "${DATABASE_URL}" -t -A -F, -c "SELECT runtime_mode, phase, request_id, event_id, trace_id, failure_reason, id FROM runtime_attempts WHERE tenant_id='${TENANT_ID}' AND message_id='${message_id}' ORDER BY created_at DESC LIMIT 5;")
meta=$(psql "${DATABASE_URL}" -t -A -F, -c "SELECT metadata::text FROM messages WHERE id='${outbound_id}' LIMIT 1;")

echo "runtime_attempts:"
echo "$ra"
echo "outbound_metadata: $meta"
echo "trace_id: $trace_id"
echo "inbound_message: $message_id"
echo "outbound_message: $outbound_id"
echo "recent_context_auth:$(psql "${DATABASE_URL}" -t -A -F, -c "SELECT action, reason, metadata::text, created_at FROM audit_logs WHERE resource_id='/api/v1/internal/maf/context/read' AND created_at > (now() - interval '30 minutes') ORDER BY created_at DESC LIMIT 5;")"

if printf '%s' "$ra" | grep -q "maf_primary" && printf '%s' "$ra" | grep -Eq "(reply_committed|actions_committed)"; then
  echo "SMOKE_OK"
else
  echo "SMOKE_FAIL"
  exit 1
fi
