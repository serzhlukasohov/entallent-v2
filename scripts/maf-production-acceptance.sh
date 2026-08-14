#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

railway_json() {
  railway "$@" --environment "${RAILWAY_ENVIRONMENT:-production}" --json
}

latest_deployment_field() {
  local service="$1"
  local field="$2"
  railway_json deployment list --service "$service" --limit 1 | jq -r ".[0].${field} // empty"
}

service_status() {
  latest_deployment_field "$1" "status"
}

require_successful_service() {
  local service="$1"
  local status
  status="$(service_status "$service")"
  [[ "$status" == "SUCCESS" ]] || fail "$service latest deployment is $status"
  log "$service deployment SUCCESS"
}

api_get() {
  local path="$1"
  curl -fsS -H "X-Api-Key: ${ADMIN_API_KEY}" "${API_BASE}${path}"
}

require_cmd railway
require_cmd jq
require_cmd curl
require_cmd psql

log "Checking Railway deployments"
for service in api worker agent-service dashboard; do
  require_successful_service "$service"
done

log "Loading production API variables"
vars="$(railway_json variables --service api)"
DATABASE_URL="$(printf '%s' "$vars" | jq -r '.DATABASE_URL // empty')"
ADMIN_API_KEY="$(printf '%s' "$vars" | jq -r '.ADMIN_API_KEY // empty')"
API_BASE="$(printf '%s' "$vars" | jq -r '.RAILWAY_PUBLIC_DOMAIN // .API_PUBLIC_URL // empty')"

[[ -n "$DATABASE_URL" ]] || fail "DATABASE_URL is missing from api service variables"
[[ -n "$ADMIN_API_KEY" ]] || fail "ADMIN_API_KEY is missing from api service variables"
if [[ -n "$API_BASE" && "$API_BASE" != http* ]]; then
  API_BASE="https://${API_BASE}"
fi
API_BASE="${API_BASE:-https://api-production-bc75.up.railway.app}"

log "Checking API readiness at ${API_BASE}"
ready_status="$(curl -fsS "${API_BASE}/api/v1/health/ready" | jq -r '.status // empty')"
[[ "$ready_status" == "ok" ]] || fail "API readiness status is $ready_status"

log "Checking admin dashboard data surfaces"
analytics="$(api_get '/api/v1/admin/analytics')"
pulse="$(api_get '/api/v1/admin/pulse/overview')"
trends="$(api_get '/api/v1/admin/manager/trends?days=7')"

users_total="$(printf '%s' "$analytics" | jq -r '.users.total // empty')"
employees_count="$(printf '%s' "$pulse" | jq -r '.employees | length')"
signal_days="$(printf '%s' "$trends" | jq -r '.signalCapture | length')"
question_sentiment_count="$(printf '%s' "$trends" | jq -r '.questionSentiment | length')"

[[ "$users_total" =~ ^[0-9]+$ ]] || fail "analytics.users.total is missing"
(( users_total > 0 )) || fail "analytics has no users"
(( employees_count > 0 )) || fail "pulse overview has no employees"
(( signal_days > 0 )) || fail "manager trends has no signalCapture rows"
(( question_sentiment_count > 0 )) || fail "manager trends has no questionSentiment rows"

log "Checking recent MAF runtime attempts"
default_since="$(latest_deployment_field agent-service createdAt)"
since="${MAF_ACCEPTANCE_SINCE:-$default_since}"
[[ -n "$since" ]] || fail "could not resolve latest agent-service deployment timestamp"
failure_count="$(
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtAX -c \
    "SELECT count(*)
     FROM (
       SELECT trace_id
       FROM runtime_attempts
       WHERE created_at >= '${since}'
       GROUP BY trace_id
       HAVING count(*) FILTER (
         WHERE runtime_mode = 'maf_primary'
           AND phase IN ('reply_committed', 'actions_committed')
           AND failure_reason IS NULL
       ) = 0
     ) failed_traces;"
)"
[[ "$failure_count" == "0" ]] || fail "found $failure_count traces without a committed MAF primary attempt since $since"

latest_attempts="$(
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off -c \
    "SELECT trace_id, runtime_mode, phase, failure_reason, created_at FROM runtime_attempts ORDER BY created_at DESC LIMIT 5;"
)"

log "Checking recent proactive check-in MAF evidence"
proactive_total="$(
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtAX -c \
    "SELECT count(*)
     FROM messages m
     WHERE m.occurred_at >= '${since}'
       AND m.direction = 'outbound'
       AND m.message_type = 'proactive_check_in';"
)"
proactive_bad_count="$(
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtAX -c \
    "SELECT count(*)
     FROM messages m
     WHERE m.occurred_at >= '${since}'
       AND m.direction = 'outbound'
       AND m.message_type = 'proactive_check_in'
       AND (
         m.metadata->>'runtimeMode' IS DISTINCT FROM 'maf_primary'
         OR NOT EXISTS (
           SELECT 1
           FROM runtime_attempts r
           WHERE r.trace_id = m.trace_id
             AND r.runtime_mode = 'maf_primary'
             AND r.phase = 'reply_committed'
             AND r.failure_reason IS NULL
         )
       );"
)"
[[ "$proactive_bad_count" == "0" ]] || fail "found $proactive_bad_count proactive_check_in messages without MAF primary evidence since $since"
if [[ "${MAF_ACCEPTANCE_REQUIRE_PROACTIVE_CHECKIN:-0}" == "1" ]]; then
  [[ "$proactive_total" != "0" ]] || fail "no recent proactive_check_in MAF primary evidence since $since"
fi

log "Checking proactive pulse probe quality evidence"
probe_drop_count="$(
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtAX -c \
    "SELECT count(*)
     FROM messages req
     JOIN messages out
       ON out.trace_id = req.trace_id
      AND out.tenant_id = req.tenant_id
      AND out.user_id = req.user_id
      AND out.direction = 'outbound'
      AND out.message_type = 'proactive_check_in'
     WHERE req.occurred_at >= '${since}'
       AND req.direction = 'inbound'
       AND req.sender_type = 'system'
       AND req.message_type = 'proactive_check_in_request'
       AND req.metadata ? 'surveyProbeQuestionId'
       AND (
         out.metadata->>'containsSurveyProbe' IS DISTINCT FROM 'true'
         OR out.metadata->>'surveyProbeQuestionId' IS DISTINCT FROM req.metadata->>'surveyProbeQuestionId'
       );"
)"
[[ "$probe_drop_count" == "0" ]] || fail "found $probe_drop_count proactive check-ins that selected a pulse probe but did not commit matching probe evidence since $since"

log "Production MAF acceptance checks passed"
printf '\nDashboard surface summary:\n'
printf '  users.total=%s\n' "$users_total"
printf '  pulse.employees=%s\n' "$employees_count"
printf '  trends.signalCapture.days=%s\n' "$signal_days"
printf '  trends.questionSentiment.rows=%s\n' "$question_sentiment_count"
printf '\nLatest runtime attempts:\n%s\n' "$latest_attempts"
