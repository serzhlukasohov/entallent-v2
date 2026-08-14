# Agent Instructions

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- MCP tools (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them. `codegraph_node` returns one symbol's source + callers, or reads a whole file with line numbers. If the tools are listed but deferred, load them by name via tool search.
- Shell (always works): `codegraph explore "<symbol names or question>"` and `codegraph node <symbol-or-file>` print the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

## Project Memory

- Railway deployment rules live in the Deployment section below.

## Deployment

Railway deployment is production-sensitive. Before making claims, decisions, or changes related to Railway deployment, read `docs/superpowers/railway-deploy.md`.

Current Railway context:

- Project: `reasonable-adaptation`.
- Environment: `production`.
- GitHub source: `serzhlukasohov/entallent-v2`.
- Production app services: `api`, `worker`, `agent-service`, `dashboard`.
- As of `2026-08-12`, GitHub auto-deploy from `main` is the primary deployment path.

Deployment rules:

- Prefer GitHub auto-deploy from `main`; do not use manual deploy as the normal path.
- Before assuming auto-deploy is broken, check Railway deployment history for the affected service.
- Use manual `railway up` only as a fallback when a pushed `main` commit does not appear in Railway or auto-deploy is confirmed blocked.
- Before any manual deploy, identify the target project, environment, service, and latest deployment status.
- Do not deploy unrelated services.
- Do not change Railway variables, service settings, volumes, or domains without explicit user approval.

Useful checks:

- `railway deployment list --service api --limit 3 --json`
- `railway deployment list --service worker --limit 3 --json`
- `railway deployment list --service agent-service --limit 3 --json`
- `railway deployment list --service dashboard --limit 3 --json`
- `pnpm maf:agent-service:readiness`

Manual deploy fallback only:

- `railway up --service api --detach`
- `railway up --service worker --detach`
- `railway up --service dashboard --detach`

## Project Overview

enTalent is a pnpm/Turborepo monorepo for an AI coaching and workforce pulse system. The core product flow ingests employee conversations, processes them through the coaching/runtime pipeline, persists conversation and insight state, and exposes manager/admin views with cohort-safety and tenant scoping.

Main services:

- `apps/api`: NestJS/Fastify API. Owns HTTP routes, Slack event ingestion, admin/dev endpoints, health checks, database access, BullMQ queue integration, and internal MAF context/read APIs.
- `apps/worker`: NestJS worker. Processes queued conversation/runtime jobs, calls AI/runtime providers, writes outbound effects, and integrates with Slack delivery.
- `agent-service`: Python/FastAPI service for the Microsoft Agent Framework runtime. Exposes health/readiness and `POST /runtime/process-message`; it should return contract-valid runtime results and should not directly persist TypeScript-owned domain side effects.
- `apps/dashboard`: internal Next.js manager dashboard. Reads API admin endpoints server-side using `ADMIN_API_KEY`; it has no user-facing login and must be network-restricted outside local development.
- `packages/conversation-sim`: live and deterministic conversation simulation suite for coach quality, safety, memory, proactivity, and MAF migration baseline checks.
- `scripts/`: operational smoke, bootstrap, production acceptance/regression, Slack setup, chat, and verification scripts.

Primary runtime dependencies:

- Postgres with pgvector, configured by `DATABASE_URL`; local Docker maps host `5434` to container `5432`.
- Redis, configured by `REDIS_URL`; used for BullMQ queues; local Docker maps host `6380` to container `6379`.
- Slack API and Slack event signing for channel ingestion/delivery.
- OpenAI or Azure OpenAI for model-backed coaching/runtime paths.
- Railway production environment `reasonable-adaptation` with services `api`, `worker`, `agent-service`, and `dashboard`.
- Internal service auth via `INTERNAL_SERVICE_AUTH_SECRET` / related agent-service env vars.
- `FIELD_ENCRYPTION_KEY` for encrypted fields.

Production-critical areas:

- Slack event ingestion, signature validation, message persistence, queueing, worker processing, and outbound Slack delivery.
- MAF runtime path: API/worker integration with `agent-service`, runtime contract validation, `runtime_attempts` evidence, feature flags such as `maf_runtime_primary` / `maf_runtime_disabled`, and TypeScript fallback behavior.
- Data integrity and privacy: tenant scoping, admin API key enforcement, field encryption, cohort-safety for analytics, and identifiable manager views.
- Postgres migrations/schema and Redis/BullMQ queues.
- Railway deployment health for `api`, `worker`, `agent-service`, and `dashboard`.
- Production acceptance/regression scripts and MAF smoke tests before changing runtime, prompt, safety, queue, Slack, or deployment behavior.

## Navigation

- This repository is indexed by CodeGraph (`.codegraph/` exists). When understanding or locating source code, use CodeGraph before `rg`, `find`, or direct file reads. Use shell/file search mainly for configs, docs, generated artifacts, or when CodeGraph does not cover the target.
- Backend services live in:
  - `apps/api`: NestJS/Fastify HTTP API, Slack ingestion, admin/dev/internal endpoints, queues, health checks.
  - `apps/worker`: NestJS worker for conversation/runtime jobs, Slack delivery, feature flags, runtime fallback/MAF rollout behavior.
  - `agent-service`: Python/FastAPI Microsoft Agent Framework runtime service.
- Frontend lives in `apps/dashboard`: internal Next.js manager dashboard.
- Shared TypeScript packages live in `packages/`:
  - `packages/application`: use cases, orchestration, runtime routing, policy logic.
  - `packages/domain`: core domain entities.
  - `packages/contracts`: shared API/queue/runtime contracts.
  - `packages/database`: Drizzle schema, migrations, database client.
  - `packages/ai-openai`: OpenAI/Azure provider and prompts.
  - `packages/channel-*`: channel abstractions and Slack normalization.
  - `packages/config`, `packages/observability`, `packages/crypto-utils`: shared infrastructure helpers.
- Infrastructure and deployment files live in `docker/`, root `docker-compose.yml`, service `Dockerfile`s, `.github/workflows/`, `agent-service/deployment/`, and `docs/superpowers/railway-deploy.md`.
- Tests are colocated with code as `*.test.ts`; integration database tests are under `packages/database/src/__tests__/`; conversation simulations are under `packages/conversation-sim/src/scenarios/`; Python agent-service tests are under `agent-service/tests/`.
- Operational scripts live in `scripts/`; MAF smoke, production acceptance/regression, Slack setup, dashboard verification, and local chat helpers are all there.
- Product/architecture docs live in `docs/` and `docs/adr/`; historical Superpowers plans/specs live in `docs/superpowers/`.
- BMad workflow files live in `_bmad/`; generated BMad outputs live in `_bmad-output/`.

Avoid touching without a specific reason:

- `node_modules/`, `.pnpm-store/`, `.turbo/`, `.ruff_cache/`, `.tmp-tsx/`, coverage/build/cache folders.
- `.codegraph/` internals; use CodeGraph, do not edit its database/log/socket files.
- `agent-service/.venv/` and Python cache folders.
- Existing database migrations in `packages/database/migrations/` after they have been applied; add new migrations instead of rewriting history unless explicitly instructed.
- `_bmad-output/` artifacts unless the task is explicitly part of a BMad workflow or asks to update those artifacts.

## Development Commands

Use `pnpm` for Node/TypeScript work. The repo declares `pnpm@9.12.0` and Node `>=20`.

Install:

- `pnpm install`

Local infrastructure:

- `docker compose up -d postgres redis`
- Local ports: Postgres `localhost:5434`, Redis `localhost:6380`.

Development servers:

- Full TS workspace dev: `pnpm dev`
- API only: `pnpm --filter @entalent/api dev`
- Worker only: `pnpm --filter @entalent/worker dev`
- Dashboard only: `pnpm --filter @entalent/dashboard dev`
- Agent service: from `agent-service/`, use Python `3.13`, install with `python -m pip install -e ".[dev]"`, run with `python -m uvicorn agent_service.main:create_app --factory --host 127.0.0.1 --port 8001`

Build, lint, typecheck:

- Build all: `pnpm build`
- Lint all: `pnpm lint`
- Typecheck all: `pnpm typecheck`
- Pre-push check: `pnpm prepush`

Tests:

- Unit/script tests: `pnpm test`
- Integration tests: `pnpm test:integration`
- Database integration tests require `DATABASE_URL`.
- Agent-service tests: from `agent-service/`, run `pytest`.

Database:

- Generate migrations: `pnpm db:generate`
- Apply migrations using `.env`: `pnpm db:migrate`
- Seed local DB: `pnpm db:seed`
- Drizzle Studio: `pnpm db:studio`

Conversation simulations and gates:

- Run all simulations: `pnpm sim`
- Release gate: `pnpm sim:gate`
- Fast local gate sample: `SIM_GATE_RUNS=1 pnpm sim:gate`

MAF / production smoke and verification:

- Shadow smoke: `pnpm maf:shadow:smoke`
- Primary smoke: `pnpm maf:primary:smoke`
- Full app primary smoke: `pnpm maf:primary:app:smoke`
- Remote app primary smoke: `pnpm maf:primary:app:smoke:remote`
- Local MAF bootstrap: `pnpm maf:live:bootstrap`
- Local Slack MAF smoke: `pnpm maf:live:slack:smoke`
- Agent-service Railway readiness: `pnpm maf:agent-service:readiness`
- Production acceptance: `pnpm maf:prod:acceptance`
- Production regression: `pnpm maf:prod:regression`
- Production dashboard verification: `pnpm dashboard:prod:verify`

Before running smoke or production verification commands, confirm the required env vars are present in `.env` or the shell, especially `DATABASE_URL`, `REDIS_URL`, `ADMIN_API_KEY`, Slack credentials, and OpenAI/Azure model-provider credentials.

## Environment

Use `.env.example` as the local template. Local Postgres/Redis defaults come from root `docker-compose.yml`.

Core required env:

- `DATABASE_URL`: Postgres connection string. Local default: `postgresql://postgres:postgres@localhost:5434/entalent`.
- `REDIS_URL`: Redis connection string for BullMQ queues. Local default: `redis://localhost:6380`.
- `FIELD_ENCRYPTION_KEY`: 32-byte hex string, 64 hex chars. Required by config validation.
- Model provider credentials: either `OPENAI_API_KEY` or Azure OpenAI variables: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_API_VERSION`.

Access and tenant env:

- `ADMIN_API_KEY`: protects admin and sensitive endpoints. Required in production; strongly recommended for smoke and dashboard verification.
- `DEFAULT_TENANT_ID`: dev/test convenience fallback. Prefer explicit `TENANT_ID` for scripts and backfills.
- `TENANT_ID`: used by dashboard verification, smoke scripts, and tenant-scoped operational commands.

Slack env:

- `SLACK_BOT_TOKEN`: required for Slack message delivery and profile lookup.
- `SLACK_SIGNING_SECRET`: required for HTTP Slack event signature verification.
- `SLACK_APP_TOKEN`: enables Slack Socket Mode when present.
- `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`: Slack app OAuth/config support.
- `SLACK_TEST_*`: local smoke-test variants used by Slack smoke scripts.

Agent service / MAF env:

- `AGENT_SERVICE_INTERNAL_URL`: preferred worker-to-agent-service URL.
- `AGENT_SERVICE_URL`: compatibility alias; use only when `AGENT_SERVICE_INTERNAL_URL` is not set.
- `AGENT_SERVICE_TIMEOUT_MS`: optional worker client timeout.
- `INTERNAL_SERVICE_AUTH_SECRET`: TypeScript-side shared internal auth secret.
- `AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET`: Python agent-service shared auth secret; should match `INTERNAL_SERVICE_AUTH_SECRET`.
- `AGENT_SERVICE_INTERNAL_API_URL`: API base used by agent-service context tools, usually `http://127.0.0.1:${API_PORT}/api/v1` locally.
- `AGENT_SERVICE_MODEL_PROVIDER`: `disabled`, `openai`, or `azure_openai`.
- `AGENT_SERVICE_MODEL_NAME`: OpenAI model name or Azure deployment name.
- Prefer `AGENT_SERVICE_*` model env vars for deployments; the service can also read the shared `OPENAI_*` / `AZURE_OPENAI_*` aliases.

Production / remote smoke env:

- `MAF_RUNTIME_API_BASE`: API base for remote MAF app smoke, for example `https://<host>/api/v1`.
- `MAF_PRIMARY_APP_SMOKE_CHECK_DB`: force DB checks in remote app smoke.
- `MAF_PRIMARY_APP_SMOKE_CHECK_QUEUE`: force Redis/admin queue checks in remote app smoke.
- `AGENT_SERVICE_HEALTH_URL`, `AGENT_SERVICE_READINESS_URL`, or `RAILWAY_AGENT_SERVICE_URL`: optional live health probe inputs for agent-service readiness checks.

Observability env:

- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `SENTRY_DSN`
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_HOST`

Rules:

- Do not commit real secrets. Keep only placeholders in `.env.example`.
- Check `packages/config/src/env.ts` before adding or renaming TypeScript service env vars.
- Check `agent-service/src/agent_service/infrastructure/settings.py` before adding or renaming Python agent-service env vars.
- For Railway-specific values, read `docs/superpowers/railway-deploy.md` and `agent-service/deployment/railway-service.toml`.

## Database & Migrations

Database schema source lives in `packages/database/src/schema/index.ts`. Drizzle migrations are generated into `packages/database/migrations/` using `packages/database/drizzle.config.ts`.

Create migrations:

- Update the Drizzle schema in `packages/database/src/schema/index.ts`.
- Generate a migration with `pnpm db:generate`.
- Review the generated SQL in `packages/database/migrations/` before applying it.
- Keep generated migration metadata in `packages/database/migrations/meta/` with the migration.

Apply migrations locally:

- Start local Postgres first: `docker compose up -d postgres`.
- Ensure `DATABASE_URL` points at the intended database. Local default from `.env.example`: `postgresql://postgres:postgres@localhost:5434/entalent`.
- Apply migrations with `pnpm db:migrate`.
- For integration tests, `DATABASE_URL` is required; database integration tests use the same migration folder.

Seed / inspect:

- Seed local DB with `pnpm db:seed`.
- Open Drizzle Studio with `pnpm db:studio`.

Rules:

- Do not edit already-applied migration files unless the user explicitly asks for migration history surgery.
- Prefer adding a new forward migration over rewriting migration history.
- Do not run destructive SQL (`DROP`, `TRUNCATE`, mass `DELETE`, destructive `ALTER`, resetting schemas/data) against local, staging, or production databases without explicit user approval.
- Before running migrations against non-local databases, clearly identify the target `DATABASE_URL` environment and confirm it is intended.
- Keep schema, generated SQL migrations, and contract/application code in sync when changing persisted data shapes.

## Testing Policy

Use the smallest verification set that covers the changed behavior. Prefer targeted tests first, then broader checks when shared contracts, runtime routing, persistence, queues, Slack, MAF, or production-critical paths are touched.

Baseline checks:

- For most code changes, run `pnpm typecheck` and the relevant package/app tests.
- Before pushing or handing off broad changes, run `pnpm prepush` when feasible.
- If a command cannot run because required services, env vars, network, or credentials are missing, state exactly what was not run and why.

Backend/API changes:

- For `apps/api` changes, run targeted API tests when available, otherwise `pnpm --filter @entalent/api test`.
- For admin, dev, internal auth, internal MAF context, Slack ingest, or queue changes, also consider `pnpm test` if the change touches shared contracts or cross-package behavior.
- For API changes affecting MAF runtime integration, run the relevant MAF smoke command: `pnpm maf:shadow:smoke`, `pnpm maf:primary:smoke`, or `pnpm maf:primary:app:smoke`.

Worker/runtime changes:

- For `apps/worker` changes, run targeted worker tests when available, otherwise `pnpm --filter @entalent/worker test`.
- For runtime routing, feature flags, fallback barriers, `runtime_attempts`, or `agent-service` client changes, run the related `packages/application` tests plus the relevant MAF smoke.
- For prompt/orchestration changes, run `pnpm sim` or at least `SIM_GATE_RUNS=1 pnpm sim:gate` when model credentials are available.

Database changes:

- For schema/migration changes, run `pnpm db:generate` when schema changed, review generated SQL, then run `pnpm db:migrate` against the intended local database.
- Run `pnpm test:integration` for database behavior changes when `DATABASE_URL` is available.

Agent-service changes:

- For Python `agent-service` changes, run `pytest` from `agent-service/`.
- Also run `ruff` and `mypy` from `agent-service/` when touching typed runtime, settings, auth, contracts, or model-provider code.
- For agent-service/API integration changes, run `pnpm maf:agent-service:readiness` or an appropriate MAF smoke.

Dashboard/UI changes:

- For `apps/dashboard` changes, run `pnpm --filter @entalent/dashboard typecheck` and `pnpm --filter @entalent/dashboard build`.
- If dashboard data contracts or admin endpoints changed, also run the related API/admin tests.
- For production dashboard verification, use `pnpm dashboard:prod:verify` only with the required env vars.

Contracts/shared packages:

- For `packages/contracts`, `packages/application`, `packages/domain`, `packages/database`, `packages/ai-openai`, or `packages/channel-*` changes, run that package's tests plus affected app tests.
- If shared contracts change, check both producers and consumers: API, worker, dashboard, agent-service, scripts, and simulations as relevant.

Production-sensitive verification:

- Before changing Slack delivery, MAF primary/fallback behavior, feature flags, queues, migrations, admin security, tenant scoping, or Railway deployment behavior, identify the intended verification command before editing.
- After such changes, prefer `pnpm test`, relevant MAF smoke, and production acceptance/regression scripts when env allows.

## Code Style

- Follow existing patterns in the touched app/package before introducing new abstractions.
- Keep changes scoped to the user request and the affected ownership boundary.
- Do not perform broad refactors, rewrites, renames, formatting sweeps, or dependency swaps unless explicitly requested.
- Do not change unrelated files. If unrelated dirty worktree changes exist, leave them alone.
- Do not revert user changes unless explicitly asked.
- Do not commit, amend, rebase, tag, push, or create PRs unless the user explicitly asks.
- Do not add new dependencies unless there is a clear need and the existing stack does not already provide a suitable option.
- Prefer shared packages and established local helpers over duplicating infrastructure logic.
- Keep comments sparse and useful; explain non-obvious decisions, not obvious mechanics.
- Preserve ASCII unless the edited file already uses non-ASCII or the content requires it.
- For production-critical paths, favor small, reviewable changes with targeted tests over large redesigns.

## Engineering Approach

- Do not limit analysis to the immediate patch when the issue suggests a broader product, architecture, runtime, safety, or operational concern.
- Before implementing a fix, consider whether the root cause belongs in domain logic, application orchestration, adapter boundaries, contracts, database schema, queue behavior, deployment config, or operational runbooks.
- Prefer solutions that align with established architecture and comparable production systems, not just the smallest local code change.
- When a request is tactical but touches production-critical behavior, briefly surface architectural tradeoffs, risks, and the verification strategy before or while implementing.
- Avoid speculative rewrites. Broader thinking should improve the chosen scoped change, not turn every task into a redesign.
- If the correct fix likely requires a larger design decision, call that out and propose the smallest safe next step plus the larger follow-up path.

## Known Project Decisions

- Architecture follows hexagonal ports/adapters. Domain and application logic should stay isolated from infrastructure details; Slack, OpenAI/Azure, Drizzle, BullMQ, and FastAPI integration belong at adapter boundaries.
- PostgreSQL is the source of truth for persistent product state. Redis/BullMQ is a delivery and workflow mechanism, not authoritative storage.
- LLMs and Python/MAF must not directly mutate production domain state. AI may analyze, classify, propose, and generate structured output; TypeScript backend/application code validates, decides, persists, queues side effects, and audits.
- TypeScript remains the owner of durable side effects: outbound message persistence, message-send queueing, memory/goals/follow-ups, survey evidence, risk/policy decisions, ledgers, and audit records.
- `agent-service` owns MAF candidate generation/runtime responses through `/runtime/process-message`; it must return contract-valid, redacted results and fail closed on unsafe or invalid output.
- Slack is the first channel integration. Channel-specific behavior should stay behind `packages/channel-core` / `packages/channel-slack` abstractions so future Teams/Telegram/WhatsApp adapters do not alter conversation domain logic.
- Manager analytics must preserve privacy boundaries: aggregate views use cohort safety, while identifiable manager/admin surfaces require explicit admin access controls and auditability.
- Runtime rollout is feature-flag controlled. MAF shadow/canary/primary behavior must preserve rollback paths such as `maf_runtime_disabled` and user denylist controls.
- Audit and runtime evidence are stored in PostgreSQL, including `audit_logs`, `runtime_attempts`, outbound message metadata, runtime ledgers, and shadow diagnostics.
- Verified production integrations include Railway GitHub auto-deploy from `main`, Slack ingestion/delivery paths, Postgres/Redis runtime dependencies, and MAF smoke/acceptance scripts as documented in `docs/` and `docs/superpowers/railway-deploy.md`.

## Task Completion Reporting

- At the end of each implementation task, state the completion criteria used to judge whether the task is done.
- Report the remaining work as an estimated percentage, with a short explanation of what makes up the remainder.
- If the task is fully complete, write `Remaining: 0%` and mention any residual risks or optional follow-ups separately.
- If verification was skipped or blocked, include that in the remaining percentage instead of presenting the task as fully complete.
- Keep the report concise: completed work, verification run, completion criteria, and remaining percentage.

## BMad Workflow

- BMad is installed under `_bmad/`; use its local skills and config when the user asks for BMad, PRD, architecture, epics/stories, sprint planning, story execution, implementation readiness, checkpoint previews, or BMad-style reviews.
- Resolve BMad configuration with `_bmad/scripts/resolve_config.py` when workflow paths, language, or project knowledge location matter. Current defaults: communicate in Russian, write BMad documents in English, store BMad outputs under `_bmad-output/`, and use `docs/` as project knowledge.
- Keep BMad planning artifacts in `_bmad-output/planning-artifacts` and implementation artifacts in `_bmad-output/implementation-artifacts` unless the resolved config says otherwise.
- Prefer the BMad sequence for substantial product work: brief or PRFAQ -> PRD -> UX when UI is central -> architecture -> epics/stories -> implementation readiness -> sprint planning -> story creation -> story validation -> dev story -> code review.
- For brownfield or quick implementation work, `bmad-quick-dev`, `bmad-document-project`, `bmad-generate-project-context`, and `bmad-checkpoint-preview` are acceptable shortcuts when they fit the user's request.
- Do not invent BMad artifact status. Inspect the relevant `_bmad-output/` files, sprint status, or story files before claiming a phase is complete or deciding the next BMad step.
