#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

API_PORT="${API_PORT:-3110}"
WORKER_PORT="${WORKER_PORT:-3111}"
SERVICE_PORT="${SERVICE_PORT:-18180}"

AUTO_CLEAN_PORTS="${AUTO_CLEAN_PORTS:-1}"

log() {
  echo "[$(date '+%H:%M:%S')] $*"
}

kill_port_listeners() {
  if [ "$AUTO_CLEAN_PORTS" != "1" ]; then
    return 0
  fi

  local port="$1"
  local label="$2"
  if ! command -v lsof >/dev/null 2>&1; then
    echo "WARN: lsof not installed; skipping port cleanup for $label on :$port" >&2
    return 0
  fi

  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN -P -n 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    log "Port $port (${label}) is already free"
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
  fi

  sleep 1
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN -P -n 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "WARN: Could not free port $port (${label}) automatically." >&2
  else
    log "Port $port (${label}) is now free"
  fi
}

log "Cleaning ports used by local MAF stack"
kill_port_listeners "$SERVICE_PORT" "agent-service"
kill_port_listeners "$API_PORT" "api"
kill_port_listeners "$WORKER_PORT" "worker"

log "Done."
