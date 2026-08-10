#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

if [ -f "$REPO_DIR/docker/docker-compose.yml" ]; then
  COMPOSE_FILE="$REPO_DIR/docker/docker-compose.yml"
elif [ -f "$REPO_DIR/docker-compose.yml" ]; then
  COMPOSE_FILE="$REPO_DIR/docker-compose.yml"
else
  COMPOSE_FILE="$REPO_DIR/docker/docker-compose.yml"
fi
SMOKE_SCRIPT="$REPO_DIR/scripts/maf-smoke-runner.sh"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env}"
MAF_INTERNAL_SERVICE_AUTH_SECRET="${INTERNAL_SERVICE_AUTH_SECRET:-${API_SECRET:-agent-service-internal-secret-000000000000}}"

ORIG_API_PORT="${API_PORT-}"
ORIG_WORKER_PORT="${WORKER_PORT-}"
ORIG_DATABASE_URL="${DATABASE_URL-}"
ORIG_REDIS_URL="${REDIS_URL-}"
ORIG_TENANT_ID="${TENANT_ID-}"
ORIG_FIELD_ENCRYPTION_KEY="${FIELD_ENCRYPTION_KEY-}"
ORIG_INTERNAL_SERVICE_AUTH_SECRET="${INTERNAL_SERVICE_AUTH_SECRET-}"
ORIG_AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET="${AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET-}"
ORIG_AGENT_SERVICE_INTERNAL_API_URL="${AGENT_SERVICE_INTERNAL_API_URL-}"
ORIG_AGENT_SERVICE_MODEL_PROVIDER="${AGENT_SERVICE_MODEL_PROVIDER-}"
ORIG_AGENT_SERVICE_MODEL_NAME="${AGENT_SERVICE_MODEL_NAME-}"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' "$ENV_FILE" | sed '/^$/d' | xargs) >/dev/null 2>&1 || true
fi

export API_PORT="${ORIG_API_PORT:-${API_PORT:-3110}}"
export WORKER_PORT="${ORIG_WORKER_PORT:-${WORKER_PORT:-3111}}"
export DATABASE_URL="${ORIG_DATABASE_URL:-${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5434/entalent}}"
export REDIS_URL="${ORIG_REDIS_URL:-${REDIS_URL:-redis://127.0.0.1:6380}}"
export TENANT_ID="${ORIG_TENANT_ID:-${TENANT_ID:-7d1e0163-6d53-4713-bd24-254690cc5090}}"
export FIELD_ENCRYPTION_KEY="${ORIG_FIELD_ENCRYPTION_KEY:-${FIELD_ENCRYPTION_KEY:-}}"
export AGENT_SERVICE_MODEL_PROVIDER="${ORIG_AGENT_SERVICE_MODEL_PROVIDER:-${AGENT_SERVICE_MODEL_PROVIDER:-azure_openai}}"
export AGENT_SERVICE_MODEL_NAME="${ORIG_AGENT_SERVICE_MODEL_NAME:-${AGENT_SERVICE_MODEL_NAME:-${OPENAI_MODEL_BALANCED:-gpt-5.4-mini}}}"
export AGENT_SERVICE_INTERNAL_API_URL="${ORIG_AGENT_SERVICE_INTERNAL_API_URL:-${AGENT_SERVICE_INTERNAL_API_URL:-http://127.0.0.1:${API_PORT}/api/v1}}"

export INTERNAL_SERVICE_AUTH_SECRET="${ORIG_INTERNAL_SERVICE_AUTH_SECRET:-${INTERNAL_SERVICE_AUTH_SECRET:-$MAF_INTERNAL_SERVICE_AUTH_SECRET}}"
export AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET="${ORIG_AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET:-${AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET:-$MAF_INTERNAL_SERVICE_AUTH_SECRET}}"
unset ORIG_API_PORT \
  ORIG_WORKER_PORT \
  ORIG_DATABASE_URL \
  ORIG_REDIS_URL \
  ORIG_TENANT_ID \
  ORIG_FIELD_ENCRYPTION_KEY \
  ORIG_INTERNAL_SERVICE_AUTH_SECRET \
  ORIG_AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET \
  ORIG_AGENT_SERVICE_INTERNAL_API_URL \
  ORIG_AGENT_SERVICE_MODEL_PROVIDER \
  ORIG_AGENT_SERVICE_MODEL_NAME
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-60}"
SKIP_MIGRATE="${SKIP_MIGRATE:-0}"
SKIP_SERVICES="${SKIP_SERVICES:-0}"
SKIP_INFRA_CHECKS="${SKIP_INFRA_CHECKS:-0}"
SKIP_SMOKE="${SKIP_SMOKE:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
INFRA_HOST_POSTGRES=""
INFRA_PORT_POSTGRES=""
INFRA_HOST_REDIS=""
INFRA_PORT_REDIS=""

log() {
  echo "[$(date '+%H:%M:%S')] $*"
}

require_cmd() {
  local cmd_name="$1"
  if ! command -v "$cmd_name" >/dev/null 2>&1; then
    echo "Missing required command: $cmd_name"
    exit 1
  fi
}

resolve_host_port_from_url() {
  local value="$1"
  local fallback_host="$2"
  local fallback_port="$3"
  node -e "const u=new URL(process.argv[1]);console.log((u.hostname || process.argv[2]) + ':' + (u.port || process.argv[3] || (u.protocol === 'redis:' ? '6379' : '5432')));" "$value" "$fallback_host" "$fallback_port"
}

resolve_infra_targets() {
  if [ -z "$INFRA_HOST_POSTGRES" ] || [ -z "$INFRA_PORT_POSTGRES" ]; then
    IFS=':' read -r resolved_host resolved_port <<<"$(resolve_host_port_from_url "$DATABASE_URL" "127.0.0.1" "5432")"
    INFRA_HOST_POSTGRES="${INFRA_HOST_POSTGRES:-$resolved_host}"
    INFRA_PORT_POSTGRES="${INFRA_PORT_POSTGRES:-$resolved_port}"
  fi

  if [ -z "$INFRA_HOST_REDIS" ] || [ -z "$INFRA_PORT_REDIS" ]; then
    IFS=':' read -r resolved_host resolved_port <<<"$(resolve_host_port_from_url "$REDIS_URL" "127.0.0.1" "6379")"
    INFRA_HOST_REDIS="${INFRA_HOST_REDIS:-$resolved_host}"
    INFRA_PORT_REDIS="${INFRA_PORT_REDIS:-$resolved_port}"
  fi
}

wait_for_postgres() {
  if [ "$SKIP_INFRA_CHECKS" = "1" ]; then
    log "SKIP_INFRA_CHECKS=1, skipping Postgres readiness wait"
    return 0
  fi

  log "Waiting for Postgres at ${INFRA_HOST_POSTGRES}:${INFRA_PORT_POSTGRES}..."
  for i in $(seq 1 "$TIMEOUT_SECONDS"); do
    if PGPASSWORD=postgres psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1; then
      log "Postgres is ready"
      return 0
    fi
    sleep 1
  done
  echo "Postgres did not become ready in ${TIMEOUT_SECONDS}s"
  return 1
}

wait_for_redis() {
  if [ "$SKIP_INFRA_CHECKS" = "1" ]; then
    log "SKIP_INFRA_CHECKS=1, skipping Redis readiness wait"
    return 0
  fi

  log "Waiting for Redis at ${INFRA_HOST_REDIS}:${INFRA_PORT_REDIS}..."
  for i in $(seq 1 "$TIMEOUT_SECONDS"); do
    if node -e "const net=require('net');const s=net.createConnection({host:'${INFRA_HOST_REDIS}',port:Number('${INFRA_PORT_REDIS}')});s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));" >/dev/null 2>&1; then
      log "Redis is ready"
      return 0
    fi
    sleep 1
  done
  echo "Redis did not become ready in ${TIMEOUT_SECONDS}s"
  return 1
}

start_services() {
  if [ "$SKIP_SERVICES" = "1" ]; then
    log "SKIP_SERVICES=1, skipping Docker startup"
    return 0
  fi

  if [ -f "$COMPOSE_FILE" ]; then
    require_cmd docker
    log "Starting services via docker compose..."
    docker compose -f "$COMPOSE_FILE" up -d postgres redis
    return 0
  fi

  require_cmd docker
  log "No compose file found, trying manual containers..."
  if [[ "$INFRA_HOST_POSTGRES" != "127.0.0.1" && "$INFRA_HOST_POSTGRES" != "localhost" ]]; then
    log "DATABASE_URL targets remote Postgres host ${INFRA_HOST_POSTGRES}; skipping local postgres container startup."
  elif ! docker ps --format '{{.Names}}' | grep -q '^entalent-postgres$'; then
    log "Starting local postgres container on host port ${INFRA_PORT_POSTGRES}"
    docker run -d --name entalent-postgres \
      -p "${INFRA_PORT_POSTGRES}:5432" \
      -e POSTGRES_USER=postgres \
      -e POSTGRES_PASSWORD=postgres \
      -e POSTGRES_DB=entalent \
      postgres:16
  else
    log "Using existing local postgres container entalent-postgres"
  fi

  if [[ "$INFRA_HOST_REDIS" != "127.0.0.1" && "$INFRA_HOST_REDIS" != "localhost" ]]; then
    log "REDIS_URL targets remote Redis host ${INFRA_HOST_REDIS}; skipping local redis container startup."
  elif ! docker ps --format '{{.Names}}' | grep -q '^entalent-redis$'; then
    log "Starting local redis container on host port ${INFRA_PORT_REDIS}"
    docker run -d --name entalent-redis \
      -p "${INFRA_PORT_REDIS}:6379" \
      redis:7
  else
    log "Using existing local redis container entalent-redis"
  fi
}

run_migrations() {
  if [ "$SKIP_MIGRATE" = "1" ]; then
    log "SKIP_MIGRATE=1, skipping migrations"
    return 0
  fi

  if [ "$SKIP_INFRA_CHECKS" = "1" ]; then
    log "SKIP_INFRA_CHECKS=1, skipping migrations"
    return 0
  fi

  log "Running database migrations"
  pnpm --filter @entalent/database db:migrate
}

build_smoke_artifacts() {
  if [ "$SKIP_BUILD" = "1" ]; then
    log "SKIP_BUILD=1, skipping artifact builds"
    return 0
  fi

  log "Rebuilding required artifacts in dependency order for smoke runtime"
  pnpm --filter @entalent/contracts build
  pnpm --filter @entalent/application build
  pnpm --filter @entalent/config build
  pnpm --filter @entalent/database build
  pnpm --filter @entalent/api build
  pnpm --filter @entalent/worker build
}

run_smoke() {
  if [ "$SKIP_SMOKE" = "1" ]; then
    log "SKIP_SMOKE=1, skipping end-to-end smoke run"
    return 0
  fi

  if [ ! -x "$SMOKE_SCRIPT" ]; then
    echo "Smoke script is not executable; running via bash: $SMOKE_SCRIPT"
    bash "$SMOKE_SCRIPT"
    return 0
  fi
  log "Starting end-to-end smoke..."
  bash "$SMOKE_SCRIPT"
}

main() {
  log "Checking dependencies"
  require_cmd psql
  require_cmd node
  require_cmd pnpm

  resolve_infra_targets
  start_services
  wait_for_postgres
  wait_for_redis
  run_migrations
  build_smoke_artifacts
  run_smoke
}

main "$@"
