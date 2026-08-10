# Railway Deploy Memory

Last verified: 2026-08-10.

Project: `reasonable-adaptation`.
Environment: `production`.
App services: `api`, `worker`, `dashboard`.

GitHub auto-deploy is currently working for pushes to `main` from `serzhlukasohov/entallent-v2`.

Evidence from 2026-08-09:

- `agent-service` deployment lookup: `Service "agent-service" not found`.
- Service-link checks:
  - `api` linked successfully; latest service status `FAILED`.
  - `worker` linked successfully; latest service status `SUCCESS`.
  - `dashboard` linked successfully; latest service status `SUCCESS`.
- Deployment list snapshots (`--limit 5 --json`):
- `api`: latest deploy `fa346e07-e0ce-414c-a357-ac6b2c7e6e7e` (`FAILED`), prior successful entry `2328f747-4ec0-4620-bf6f-2fd476f38ac0` (`SUCCESS`).
- `worker`: latest deploy `1671fa4f-a444-4d32-bf6f-2fd476f38ac0` (`SUCCESS`).
- `dashboard`: latest deploy `936d186b-cde8-4d09-8900-1217ef41bea3` (`SUCCESS`).

Readiness verification is now codified in a helper script. In addition to service
registration, variables, and health checks, it validates deployment envelope
evidence (`agent-service/Dockerfile` via build metadata) and checks that a
writable `/data/agent-service` mount is configured for sqlite shadow state.

Run:

```sh
pnpm run maf:agent-service:readiness
```

Use the same command set before running non-local app-level MAF smoke:

```sh
MAF_PRIMARY_APP_SMOKE_REMOTE=1 \
MAF_RUNTIME_API_BASE=https://<host>/api/v1 \
ADMIN_API_KEY=<admin-token> \
DATABASE_URL=<postgres-url> \
REDIS_URL=<redis-url> \
pnpm maf:primary:app:smoke:remote
```

`MAF_PRIMARY_APP_SMOKE_CHECK_DB` and `MAF_PRIMARY_APP_SMOKE_CHECK_QUEUE`
are useful when you need to force DB/queue checks in environments without full
test coverage.

Optional inputs:

- `RAILWAY_SERVICE_NAME` (default: `agent-service`)
- `RAILWAY_ENVIRONMENT` (default: `production`)
- `AGENT_SERVICE_HEALTH_URL` / `AGENT_SERVICE_READINESS_URL` / `RAILWAY_AGENT_SERVICE_URL` for optional live health probing
- `SKIP_RAILWAY_WHOAMI=1` to avoid CLI identity lookup in restricted/network-flaky contexts.
- `SKIP_RAILWAY_API=1` to skip `railway service/deployment/variables` checks and verify only health endpoints.

If the script reports JSON fields that do not resolve (`missing required variable`, `service not found`, empty deployments), treat that as a blocker for enabling non-local `maf_runtime_primary`.

Before assuming auto-deploy is broken, check:

```sh
railway deployment list --service api --limit 3 --json
railway deployment list --service worker --limit 3 --json
railway deployment list --service dashboard --limit 3 --json
railway deployment list --service agent-service --limit 3 --json
```

Use manual deploy only as a fallback if a pushed `main` commit does not appear in Railway:

```sh
railway up --service api --detach
railway up --service worker --detach
railway up --service dashboard --detach
```
