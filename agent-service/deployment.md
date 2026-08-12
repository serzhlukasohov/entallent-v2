# agent-service Deployment Envelope

Story 4.5 defines the deployment envelope only. It does not deploy the service,
run Railway commands, add worker routing, or enable MAF shadow/canary execution.

## Service Registration

| Field                         | Value                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Service name                  | `agent-service`                                                                                               |
| Platform                      | Railway production project `reasonable-adaptation`                                                            |
| Root directory                | `agent-service`                                                                                               |
| Dockerfile path               | `agent-service/Dockerfile`                                                                                    |
| Build strategy                | Docker build from the Python 3.13 service directory                                                           |
| Start command                 | `python -m uvicorn agent_service.main:create_app --factory --host 0.0.0.0 --port ${AGENT_SERVICE_PORT:-8001}` |
| Liveness path                 | `/health/live`                                                                                                |
| Readiness path                | `/health/ready`                                                                                               |
| Runtime state path            | `/data/agent-service/runtime-state.sqlite3`                                                                   |
| Future worker runtime URL env | `AGENT_SERVICE_INTERNAL_URL`                                                                                  |
| Future API context URL env    | `AGENT_SERVICE_INTERNAL_API_URL`                                                                              |

Railway auto-deploy is already verified for the existing `api`, `worker`, and
`dashboard` services. Register `agent-service` separately before enabling
non-local shadow mode. Do not use manual deploy as the primary path.

The image creates `/data/agent-service` as a writable directory owned by the
non-root service user. Attach a Railway volume at `/data/agent-service` before
using the SQLite runtime state backend for non-local shadow.

## Deployment Readiness (Current)

As of 2026-08-09, `agent-service` is defined by this envelope but is not yet
registered in Railway Production. Checks against `reasonable-adaptation` list only
`api`, `worker`, and `dashboard` services; `agent-service` lookup returns
`Service "agent-service" not found`.

Until registration exists, this is not production-ready for non-local non-production
use.

When registration is added, validate readiness with:

```sh
pnpm run maf:agent-service:readiness
```

The readiness check also validates deployment envelope signals:
Dockerfile path and writable `/data/agent-service` mount for SQLite runtime state.

After readiness checks pass, validate app-level primary smoke against that environment
using the remote mode smoke command:

```sh
MAF_PRIMARY_APP_SMOKE_REMOTE=1 \
MAF_RUNTIME_API_BASE=https://<api-host>/api/v1 \
ADMIN_API_KEY=<admin token> \
DATABASE_URL=<postgres URL> \
REDIS_URL=<redis URL> \
pnpm maf:primary:app:smoke:remote
```

For remote-only staging/prod-like smoke, keep DB and queue assertions explicit:

- set `MAF_PRIMARY_APP_SMOKE_CHECK_DB=1` only after DB read access is approved;
- set `MAF_PRIMARY_APP_SMOKE_CHECK_QUEUE=1` only after queue read access is approved;
- omit checks for read-only readiness probes in ad-hoc incident checks.

## Health

- `/health/live` verifies process liveness only.
- `/health/ready` validates settings and runtime state backend availability.
- Readiness returns HTTP 503 with a safe dependency status when required
  dependencies are unavailable.

## Environment And Secret Ownership

| Variable                                     | Owner             | Secret | Required For Deploy   | Notes                                                                |
| -------------------------------------------- | ----------------- | ------ | --------------------- | -------------------------------------------------------------------- |
| `AGENT_SERVICE_PORT`                         | Platform/runtime  | No     | Yes                   | Runtime HTTP port, default `8001`.                                   |
| `AGENT_SERVICE_ENVIRONMENT`                  | Platform/runtime  | No     | Yes                   | Deployment environment label.                                        |
| `AGENT_SERVICE_LOG_LEVEL`                    | Platform/runtime  | No     | Yes                   | Python service log level.                                            |
| `AGENT_SERVICE_OTLP_ENDPOINT`                | Observability     | No     | No                    | OTLP collector endpoint.                                             |
| `AGENT_SERVICE_TRACING_ENABLED`              | Observability     | No     | No                    | Enables tracing export.                                              |
| `AGENT_SERVICE_RUNTIME_STATE_BACKEND`        | Platform/runtime  | No     | Yes                   | `sqlite` for non-local shadow.                                       |
| `AGENT_SERVICE_RUNTIME_STATE_SQLITE_PATH`    | Platform/runtime  | No     | Yes                   | Absolute SQLite state path.                                          |
| `AGENT_SERVICE_NON_LOCAL_SHADOW_ENABLED`     | Platform/runtime  | No     | Yes                   | Rejects process-local runtime state when true.                       |
| `AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET` | Platform/security | Yes    | Yes before tool calls | Shared HMAC secret for TypeScript internal auth.                     |
| `AGENT_SERVICE_INTERNAL_SERVICE_IDENTITY`    | Platform/security | No     | Yes before tool calls | Service identity, default `agent-service`.                           |
| `AGENT_SERVICE_INTERNAL_URL`                 | Platform/runtime  | No     | Future worker client  | Internal URL consumed by future `MafAgentRuntimeClient`.             |
| `AGENT_SERVICE_INTERNAL_API_URL`             | Platform/runtime  | No     | Python context tool   | TypeScript API internal base URL (for `/internal/maf/context/read`). |

## Scope Guard

This envelope intentionally excludes:

- `MafAgentRuntimeClient`
- TypeScript worker routing
- non-local shadow or canary execution
- MAF workflows, agents, or tools
- read/write context tool endpoints
- dashboard/admin UI
- domain aggregate writes
