#!/usr/bin/env bash
set -euo pipefail

RAILWAY_SERVICE_NAME="${RAILWAY_SERVICE_NAME:-agent-service}"
RAILWAY_ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
HEALTH_URL="${AGENT_SERVICE_HEALTH_URL:-${AGENT_SERVICE_READINESS_URL:-${RAILWAY_AGENT_SERVICE_URL:-}}}"
AGENT_SERVICE_EXPECTED_DOCKERFILE_PATHS="${AGENT_SERVICE_EXPECTED_DOCKERFILE_PATHS:-agent-service/Dockerfile,/Dockerfile}"
AGENT_SERVICE_EXPECTED_VOLUME_MOUNT_PATH="/data/agent-service"

RAILWAY_SERVICE_STATUS_JSON="$(mktemp)"
RAILWAY_DEPLOYMENT_JSON="$(mktemp)"
RAILWAY_VARIABLES_JSON="$(mktemp)"

cleanup() {
  rm -f "$RAILWAY_SERVICE_STATUS_JSON" "$RAILWAY_DEPLOYMENT_JSON" "$RAILWAY_VARIABLES_JSON"
}
trap cleanup EXIT

has_command() {
  command -v "$1" >/dev/null 2>&1
}

require_cmd() {
  local cmd="$1"
  if ! has_command "$cmd"; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

emit_heading() {
  printf "\n=== %s ===\n" "$1"
}

check_railway_identity() {
  if [ "${SKIP_RAILWAY_WHOAMI:-0}" = "1" ]; then
    echo "Skipping railway identity check (SKIP_RAILWAY_WHOAMI=1)."
    return 0
  fi

  emit_heading "Railway identity"
  require_cmd railway
  railway whoami
}

run_json_or_fail() {
  local output_file="$1"
  shift
  if ! "$@" >"$output_file"; then
    echo "Command failed: $*" >&2
    exit 1
  fi
}

parse_json() {
  local file="$1"
  node - "$file" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const input = fs.readFileSync(file, 'utf8');
try {
  const value = JSON.parse(input);
  process.exit(0);
} catch (error) {
  console.error('ERR_INVALID_JSON', error.message);
  process.exit(1);
}
NODE
}

ensure_service_registered() {
  emit_heading "Service registration"

  run_json_or_fail "$RAILWAY_SERVICE_STATUS_JSON" railway service status --service "$RAILWAY_SERVICE_NAME" --environment "$RAILWAY_ENVIRONMENT" --json
  parse_json "$RAILWAY_SERVICE_STATUS_JSON" >/dev/null 2>&1 || {
    echo "railway service status did not return JSON" >&2
    cat "$RAILWAY_SERVICE_STATUS_JSON"
    exit 1
  }

  node - "$RAILWAY_SERVICE_NAME" "$RAILWAY_SERVICE_STATUS_JSON" <<'NODE'
const fs = require('fs');
const serviceName = process.argv[2];
const data = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));

const normalize = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  if (typeof entry.name === 'string') {
    return entry.name;
  }
  if (entry.service && typeof entry.service === 'string') {
    return entry.service;
  }
  if (entry.service && typeof entry.service === 'object' && typeof entry.service.name === 'string') {
    return entry.service.name;
  }
  return null;
};

const records = Array.isArray(data) ? data : [data];
const matched = records.some((record) => normalize(record) === serviceName);
if (!matched) {
  console.error(`Service ${serviceName} not found in status response.`);
  process.exit(1);
}

const status = records.find((record) => normalize(record) === serviceName);
const printable = typeof status === 'object' ? status : {};
const statusValue = printable.status ?? printable.health?.status ?? 'unknown';
console.log(`Service ${serviceName} status: ${statusValue}`);
if (statusValue === 'FAILED') {
  console.error(`Service ${serviceName} is currently failed. Re-run after successful deploy.`);
  process.exit(1);
}
NODE
}

ensure_recent_deployments() {
  emit_heading "Recent deployments"
  run_json_or_fail "$RAILWAY_DEPLOYMENT_JSON" railway deployment list --service "$RAILWAY_SERVICE_NAME" --environment "$RAILWAY_ENVIRONMENT" --limit 5 --json
  parse_json "$RAILWAY_DEPLOYMENT_JSON" >/dev/null 2>&1 || {
    echo "railway deployment list did not return JSON" >&2
    cat "$RAILWAY_DEPLOYMENT_JSON"
    exit 1
  }

  node - "$RAILWAY_DEPLOYMENT_JSON" <<'NODE'
const fs = require('fs');
const deployments = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!Array.isArray(deployments) || deployments.length === 0) {
  console.error('No deployments found for agent-service in environment.');
  process.exit(1);
}

const first = deployments[0];
const status = first.status ?? 'unknown';
const id = first.id ?? 'unknown';
console.log(`Latest deployment: ${id} (${status})`);
if (status === 'FAILED') {
  console.error('Latest deployment failed; readiness requires a successful deployment.');
  process.exit(1);
}
NODE
}

ensure_runtime_state_runtime_image_envelope() {
  emit_heading "Runtime state and deployment envelope"
  run_json_or_fail "$RAILWAY_DEPLOYMENT_JSON" railway deployment list --service "$RAILWAY_SERVICE_NAME" --environment "$RAILWAY_ENVIRONMENT" --limit 10 --json
  parse_json "$RAILWAY_DEPLOYMENT_JSON" >/dev/null 2>&1 || {
    echo "railway deployment list did not return JSON" >&2
    cat "$RAILWAY_DEPLOYMENT_JSON"
    exit 1
  }
  run_json_or_fail "$RAILWAY_VARIABLES_JSON" railway variables --service "$RAILWAY_SERVICE_NAME" --environment "$RAILWAY_ENVIRONMENT" --json
  parse_json "$RAILWAY_VARIABLES_JSON" >/dev/null 2>&1 || {
    echo "railway variables did not return JSON" >&2
    cat "$RAILWAY_VARIABLES_JSON"
    exit 1
  }

  node - "$RAILWAY_DEPLOYMENT_JSON" "$RAILWAY_VARIABLES_JSON" "$AGENT_SERVICE_EXPECTED_DOCKERFILE_PATHS" "$AGENT_SERVICE_EXPECTED_VOLUME_MOUNT_PATH" <<'NODE'
const path = require('path');
const fs = require('fs');

const deploymentFile = process.argv[2];
const variableFile = process.argv[3];
const expectedDockerfilePaths = (process.argv[4] || 'agent-service/Dockerfile')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const expectedVolumeMountPath = process.argv[5];

const deployments = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
if (!Array.isArray(deployments) || deployments.length === 0) {
  console.error('No deployments found for agent-service in environment.');
  process.exit(1);
}

const successful = deployments.find((deployment) => deployment?.status === 'SUCCESS');
if (!successful) {
  console.error('No successful deployment found for agent-service.');
  process.exit(1);
}

const manifest = successful.meta?.serviceManifest ?? {};
const builder = manifest.build?.builder;
const dockerfilePath = manifest.build?.dockerfilePath;
if (builder !== 'DOCKERFILE') {
  console.error(`Unexpected deployment builder: ${builder ?? 'missing'} (expected DOCKERFILE).`);
  process.exit(1);
}
if (!expectedDockerfilePaths.includes(dockerfilePath)) {
  console.error(
    `Unexpected deployment dockerfile: ${dockerfilePath ?? 'missing'} (expected one of: ${expectedDockerfilePaths.join(', ')}).`
  );
  process.exit(1);
}

console.log(`Deployment manifest builder: ${builder}`);
console.log(`Deployment dockerfile: ${dockerfilePath}`);

const rawEntries = JSON.parse(fs.readFileSync(variableFile, 'utf8'));
const entries = Array.isArray(rawEntries)
  ? rawEntries
  : Array.isArray(rawEntries.variables)
    ? rawEntries.variables
    : Array.isArray(rawEntries.vars)
      ? rawEntries.vars
      : typeof rawEntries === 'object'
        ? Object.entries(rawEntries).map(([name, value]) => {
          if (value && typeof value === 'object' && 'name' in value) {
            return { ...value };
          }
          return { name, value };
        })
        : [];

const getVariable = (name) =>
  entries
    .map((entry) => ({
      key: entry?.name || entry?.key || entry?.variable,
      value: entry?.value ?? entry?.Value,
    }))
    .find((entry) => entry?.key === name)?.value;

const runtimeBackend = String(getVariable('AGENT_SERVICE_RUNTIME_STATE_BACKEND') || 'missing');
const runtimeSqlitePath = getVariable('AGENT_SERVICE_RUNTIME_STATE_SQLITE_PATH');
const nonLocalShadowEnabled = String(getVariable('AGENT_SERVICE_NON_LOCAL_SHADOW_ENABLED') || 'missing');

if (runtimeBackend === 'sqlite' && nonLocalShadowEnabled === 'true') {
  if (!runtimeSqlitePath) {
    console.error('AGENT_SERVICE_RUNTIME_STATE_SQLITE_PATH is required for non-local shadow with sqlite backend.');
    process.exit(1);
  }

  const runtimeStateMountPath = path.dirname(runtimeSqlitePath);
  const volumeMounts = Array.isArray(successful.meta?.volumeMounts) ? successful.meta.volumeMounts : [];
  const normalizedVolumeMounts = volumeMounts
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }
      if (entry && typeof entry === 'object' && typeof entry.mountPath === 'string') {
        return entry.mountPath;
      }
      return null;
    })
    .filter(Boolean);
  const hasVolumeMount = normalizedVolumeMounts.includes(expectedVolumeMountPath);
  const requiredMountPath = manifest.deploy?.requiredMountPath;
  if (!hasVolumeMount && requiredMountPath !== expectedVolumeMountPath) {
    console.error(
      `Missing writable runtime-state mount. Expected mount path ${expectedVolumeMountPath} in deployment volume mounts or deploy.requiredMountPath.`
    );
    process.exit(1);
  }
  if (!hasVolumeMount && runtimeStateMountPath !== expectedVolumeMountPath) {
    console.error(
      `Runtime state mount path ${runtimeStateMountPath} does not match expected writable path ${expectedVolumeMountPath}.`
    );
    process.exit(1);
  }

  console.log(`Deployment runtime state path: ${runtimeSqlitePath}`);
  console.log(`Observed runtime mount path: ${runtimeStateMountPath}`);
}

console.log(`Validated successful deployment: ${successful.id ?? 'unknown'} (${successful.status ?? 'unknown'})`);
NODE
}

ensure_required_environment_variables() {
  emit_heading "Service variables"
  run_json_or_fail "$RAILWAY_VARIABLES_JSON" railway variables --service "$RAILWAY_SERVICE_NAME" --environment "$RAILWAY_ENVIRONMENT" --json

  parse_json "$RAILWAY_VARIABLES_JSON" >/dev/null 2>&1 || {
    echo "railway variables did not return JSON" >&2
    cat "$RAILWAY_VARIABLES_JSON"
    exit 1;
  }

  node - "$RAILWAY_VARIABLES_JSON" <<'NODE'
const fs = require('fs');
  const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const entries = Array.isArray(raw)
  ? raw
  : Array.isArray(raw.variables)
    ? raw.variables
    : Array.isArray(raw.vars)
      ? raw.vars
      : typeof raw === 'object'
        ? Object.entries(raw).map(([name, value]) => {
          if (value && typeof value === 'object' && 'name' in value) {
            return { ...value };
          }
          return { name, value };
        })
        : [];
const names = new Set(entries.map((entry) => entry.name || entry.key || entry.variable || '').filter((value) => typeof value === 'string' && value.length > 0));

const required = [
  'AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET',
  'AGENT_SERVICE_INTERNAL_API_URL',
  'AGENT_SERVICE_INTERNAL_URL',
  'AGENT_SERVICE_RUNTIME_STATE_BACKEND',
  'AGENT_SERVICE_NON_LOCAL_SHADOW_ENABLED',
  'AGENT_SERVICE_RUNTIME_STATE_SQLITE_PATH',
];
const missing = required.filter((name) => !names.has(name));
if (missing.length > 0) {
  console.error(`Missing required service variables: ${missing.join(', ')}`);
  process.exit(1);
}

const secretPreview = names.has('AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET') ? 'set' : 'missing';
const runtimeStateBackend = entries.find((entry) => {
  const key = entry.name || entry.key || entry.variable;
  return key === 'AGENT_SERVICE_RUNTIME_STATE_BACKEND';
})?.value || entries.find((entry) => entry.name === 'AGENT_SERVICE_RUNTIME_STATE_BACKEND')?.Value || 'missing';
const shadowEnabled = entries.find((entry) => {
  const key = entry.name || entry.key || entry.variable;
  return key === 'AGENT_SERVICE_NON_LOCAL_SHADOW_ENABLED';
})?.value || entries.find((entry) => entry.name === 'AGENT_SERVICE_NON_LOCAL_SHADOW_ENABLED')?.Value || 'missing';
const runtimeStateSqlitePath = entries.find((entry) => {
  const key = entry.name || entry.key || entry.variable;
  return key === 'AGENT_SERVICE_RUNTIME_STATE_SQLITE_PATH';
})?.value || entries.find((entry) => entry.name === 'AGENT_SERVICE_RUNTIME_STATE_SQLITE_PATH')?.Value || 'missing';

console.log(`Required vars present: ${required.length - missing.length}/${required.length}`);
console.log(`AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET=${secretPreview}`);
console.log(`AGENT_SERVICE_RUNTIME_STATE_BACKEND=${runtimeStateBackend}`);
console.log(`AGENT_SERVICE_NON_LOCAL_SHADOW_ENABLED=${shadowEnabled}`);
console.log(`AGENT_SERVICE_RUNTIME_STATE_SQLITE_PATH=${runtimeStateSqlitePath}`);
if (runtimeStateBackend === 'sqlite' && shadowEnabled === 'true' && runtimeStateSqlitePath === 'missing') {
  console.error('AGENT_SERVICE_RUNTIME_STATE_SQLITE_PATH is required when non-local shadow is enabled with sqlite backend.');
  process.exit(1);
}
if (shadowEnabled === 'true' && runtimeStateBackend !== 'sqlite') {
  console.error(
    `AGENT_SERVICE_NON_LOCAL_SHADOW_ENABLED is true but runtime backend is ${runtimeStateBackend}; expected sqlite.`
  );
  process.exit(1);
}
NODE
}

probe_health() {
  emit_heading "Health endpoints"

  if [ -z "$HEALTH_URL" ]; then
    echo "HEALTH_URL not provided, skip HTTP readiness probe."
    echo "Set AGENT_SERVICE_HEALTH_URL / AGENT_SERVICE_READINESS_URL / RAILWAY_AGENT_SERVICE_URL to run live checks."
    return 0
  fi

  local base_url="${HEALTH_URL%/}"
  local live_url="${base_url}/health/live"
  local ready_url="${base_url}/health/ready"

  require_cmd curl
  for path in "$live_url" "$ready_url"; do
    local response
    local status
    response="$(curl -sS --max-time 12 "$path")" || {
      echo "Unable to reach ${path}" >&2
      exit 1
    }
    status="$(node - <<'NODE' "$response"
const fs = require('fs');
const text = fs.readFileSync(0, 'utf8').trim();
if (!text) process.exit(1);
try {
  const body = JSON.parse(text);
  if (typeof body.status !== 'string') process.exit(1);
  console.log(body.status);
} catch (error) {
  process.exit(1);
}
NODE
)" || {
      echo "Non-JSON or missing status at ${path}" >&2
      exit 1
    }
    if [ "$status" != "healthy" ] && [ "$status" != "ready" ]; then
      echo "Health status for ${path} is ${status}" >&2
      exit 1
    fi
    echo "OK ${path} => ${status}"
  done
}

emit_heading "Railway project context"
echo "Service: ${RAILWAY_SERVICE_NAME}"
echo "Environment: ${RAILWAY_ENVIRONMENT}"
if [ "${SKIP_RAILWAY_API:-0}" = "1" ]; then
  echo "Skipping Railway API checks (SKIP_RAILWAY_API=1)."
  echo "Run this mode only with AGENT_SERVICE_* URLs for local/API-level health validation."
else
  check_railway_identity
  ensure_service_registered
  ensure_recent_deployments
  ensure_required_environment_variables
  ensure_runtime_state_runtime_image_envelope
fi
probe_health

echo
echo "agent-service Railway readiness check completed."
