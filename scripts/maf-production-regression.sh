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

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "$name is required"
}

sql_value() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtAX -c "$1"
}

post_slack_message() {
  local text="$1"
  local response
  response="$(
    curl -fsS \
      -H "Authorization: Bearer ${SLACK_REGRESSION_USER_TOKEN}" \
      -H 'Content-Type: application/json; charset=utf-8' \
      --data "$(jq -n --arg channel "$SLACK_REGRESSION_CHANNEL_ID" --arg text "$text" '{channel: $channel, text: $text}')" \
      https://slack.com/api/chat.postMessage
  )"

  local ok
  ok="$(printf '%s' "$response" | jq -r '.ok')"
  [[ "$ok" == "true" ]] || fail "Slack chat.postMessage failed: $(printf '%s' "$response" | jq -c '{ok,error,needed,provided}')"
  printf '%s' "$response" | jq -r '.ts'
}

wait_for_outbound_trace() {
  local marker="$1"
  local started_at="$2"
  local require_text="$3"
  local timeout_seconds="${MAF_REGRESSION_TIMEOUT_SECONDS:-90}"
  local deadline=$((SECONDS + timeout_seconds))

  while (( SECONDS < deadline )); do
    local text_filter=""
    if [[ -n "$require_text" ]]; then
      text_filter="AND m.text ILIKE '%${require_text}%'"
    fi
    local trace_id
    trace_id="$(
      sql_value "
        SELECT m.trace_id
        FROM messages m
        JOIN runtime_attempts r ON r.trace_id = m.trace_id
        WHERE m.direction = 'outbound'
          AND m.occurred_at >= '${started_at}'
          AND m.text ILIKE '%${marker}%'
          ${text_filter}
          AND r.runtime_mode = 'maf_primary'
          AND r.phase = 'reply_committed'
          AND r.failure_reason IS NULL
        ORDER BY m.occurred_at DESC
        LIMIT 1;
      "
    )"

    if [[ -n "$trace_id" ]]; then
      printf '%s' "$trace_id"
      return 0
    fi

    sleep 3
  done

  fail "timed out waiting for outbound MAF primary reply marker=${marker}"
}

assert_memory() {
  local marker="$1"
  local timeout_seconds="${MAF_REGRESSION_TIMEOUT_SECONDS:-90}"
  local deadline=$((SECONDS + timeout_seconds))

  while (( SECONDS < deadline )); do
    local count
    count="$(
      sql_value "
        SELECT count(*)
        FROM memory_items
        WHERE status = 'active'
          AND content ILIKE '%${marker}%';
      "
    )"
    if [[ "$count" != "0" ]]; then
      return 0
    fi
    sleep 3
  done

  fail "timed out waiting for memory marker=${marker}"
}

assert_no_recent_non_primary() {
  local started_at="$1"
  local count
  count="$(
    sql_value "
      SELECT count(*)
      FROM runtime_attempts
      WHERE created_at >= '${started_at}'
        AND (runtime_mode <> 'maf_primary' OR phase <> 'reply_committed' OR failure_reason IS NOT NULL);
    "
  )"
  [[ "$count" == "0" ]] || fail "found $count non-primary/failed runtime attempts since ${started_at}"
}

require_cmd curl
require_cmd jq
require_cmd psql

require_env SLACK_REGRESSION_USER_TOKEN
require_env SLACK_REGRESSION_CHANNEL_ID

if [[ -z "${DATABASE_URL:-}" || -z "${ADMIN_API_KEY:-}" || -z "${API_BASE:-}" ]]; then
  require_cmd railway
  log "Loading production API variables from Railway"
  vars="$(railway_json variables --service api)"
  DATABASE_URL="${DATABASE_URL:-$(printf '%s' "$vars" | jq -r '.DATABASE_URL // empty')}"
  ADMIN_API_KEY="${ADMIN_API_KEY:-$(printf '%s' "$vars" | jq -r '.ADMIN_API_KEY // empty')}"
  API_BASE="${API_BASE:-$(printf '%s' "$vars" | jq -r '.RAILWAY_PUBLIC_DOMAIN // .API_PUBLIC_URL // empty')}"
fi

[[ -n "$DATABASE_URL" ]] || fail "DATABASE_URL is missing"
[[ -n "$ADMIN_API_KEY" ]] || fail "ADMIN_API_KEY is missing"
if [[ -n "$API_BASE" && "$API_BASE" != http* ]]; then
  API_BASE="https://${API_BASE}"
fi
API_BASE="${API_BASE:-https://api-production-bc75.up.railway.app}"

if [[ "${MAF_REGRESSION_RUN_ACCEPTANCE:-1}" == "1" ]]; then
  log "Running production acceptance preflight"
  MAF_ACCEPTANCE_REQUIRE_PROACTIVE_CHECKIN=1 \
    DATABASE_URL="$DATABASE_URL" \
    ADMIN_API_KEY="$ADMIN_API_KEY" \
    API_BASE="$API_BASE" \
    bash scripts/maf-production-acceptance.sh
fi

started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
marker="MAF-regression-$(date -u '+%Y%m%dT%H%M%SZ')-${GITHUB_RUN_ID:-local}"
risk="losing context between regression turns"

log "Posting Slack memory scenario marker=${marker}"
post_slack_message "Production MAF regression ${started_at}: remember that the control marker is ${marker} and the main risk is ${risk}. Reply briefly with what you remembered." >/dev/null
first_trace="$(wait_for_outbound_trace "$marker" "$started_at" "")"
log "Memory reply trace=${first_trace}"

assert_memory "$marker"
log "Memory evidence found"

log "Posting Slack recall + mirroring scenario"
post_slack_message "Production MAF regression follow-up: I am tired from checking production but want to confirm you kept context. What is the control marker and main risk? Mirror this state with the word tired." >/dev/null
second_trace="$(wait_for_outbound_trace "$marker" "$started_at" "tired")"
log "Recall/mirroring reply trace=${second_trace}"

assert_no_recent_non_primary "$started_at"

log "Production MAF regression checks passed"
printf '\nRegression summary:\n'
printf '  marker=%s\n' "$marker"
printf '  memory_trace=%s\n' "$first_trace"
printf '  recall_trace=%s\n' "$second_trace"
