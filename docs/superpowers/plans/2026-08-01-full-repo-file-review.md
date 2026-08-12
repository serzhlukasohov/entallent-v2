# Full Repository File-by-File Review

> Scope: **entire codebase** (`apps/` + `packages/` + root configs + Docker + evals + CI), not only branch diff.  
> Dimensions: architecture, design patterns, extensibility, performance, security.  
> Completed: 2026-08-01 · Status: **COMPLETE**  
> Inventory: `_inventory-ts-files.txt` — **220** `.ts`/`.tsx` + **11** root/Docker/CI/evals configs  
> Related: branch-diff [`2026-08-01-full-file-review.md`](./2026-08-01-full-file-review.md) · cleanup [`2026-08-01-thermo-nuclear-confirmation-cleanup.md`](./2026-08-01-thermo-nuclear-confirmation-cleanup.md)

**Legend:** `P0` blocker · `P1` high · `P2` medium · `P3` low · `OK` · `GOOD`

**Excluded:** `node_modules/`, `dist/`, `.next/`, `.turbo/`, lockfiles, generated caches.

---

## Progress tracker

| Area | Files | Status |
|------|------:|--------|
| `packages/application` | 44 | ✅ |
| `apps/api` | 43 | ✅ |
| `apps/worker` | 45 | ✅ |
| `packages/database` | 27 | ✅ |
| `packages/ai-openai` | 20 | ✅ |
| `apps/dashboard` | 14 | ✅ |
| `packages/domain` | 9 | ✅ |
| `packages/contracts` | 6 | ✅ |
| Small pkgs (config, crypto, observability, channel-*) | 12 | ✅ |
| Root / Docker / CI / evals | 11 | ✅ |

**Total reviewed: 220 TS/TSX + 11 configs = 231 artifacts.**

---

## Executive summary — global P0 / P1

### P0 (ship blockers / critical)

| ID | Issue | Where |
|----|--------|--------|
| G1 | Unauthenticated `/dev/*` + `ENABLE_DEV_ENDPOINTS` in prod | `apps/api` AppModule + DevSimulateController |
| G2 | Always-on DevControls + ungated Next server actions | `apps/dashboard` pulse |
| G3 | Slack `updateMessage` sets `channel` = message ts (broken) | `packages/channel-slack/slack.adapter.ts` |
| G4 | God orchestrator + optional DI soup | `conversation-orchestrator.ts` |
| G5 | Incomplete GDPR erasure (survey/goals/pulse left behind) | `data-deletion` UC + port + API users controller |

### P1 (fix soon)

| ID | Issue | Where |
|----|--------|--------|
| T1 | Missing tenant scoping on many survey/pulse/message ports & repos | application ports + worker repos |
| T2 | Insights ignores `tenantId`; users routes use `DEFAULT_TENANT_ID` placeholder | API admin/users |
| T3 | Slack HMAC skipped if `rawBody` missing | API slack-events |
| T4 | No Postgres RLS — tenant isolation is app-only | database |
| T5 | Plaintext PII (messages, memory, survey summaries) | database schema |
| T6 | Domain ↔ seed ↔ records policy/quiet-hours drift | domain / seed / records |
| T7 | Probe/crisis/Phase-B ordering bugs in confirmation | orchestrator (branch) |
| T8 | Bull jobs without `jobId` → duplicate Slack sends | worker outbox / message-send / check-in |
| T9 | `existsByDeduplicationKey` ignores status | worker scheduled-action repo |
| T10 | Escalation is stub-only in production | worker safety |
| T11 | Dead queues `risk-analysis` / `followup-planning` | worker + API queue modules |
| T12 | Confirmation evidence unsanitized in respond system prompt | ai-openai respond.ts |
| T13 | `ADMIN_API_KEY` optional in env schema (not enforced in prod) | config |
| T14 | `PROACTIVE_*_DAYS = 0` allowed in prod | config |
| T15 | Logger has no PII/secret redaction | observability |
| T16 | Feature flags unique only in raw SQL, not Drizzle | database |
| T17 | `survey_windows` missing indexes; evidence/assessments lack tenantId | database |
| T18 | ApiKeyGuard non-constant-time compare | API auth |
| T19 | Status vocabulary drift (`covered` vs `scored`) | pulse-backlog vs survey-scoring |
| T20 | EncryptionPort unused; secrets in records after decrypt | application + worker |

---

## Architecture snapshot

Monorepo: NestJS **api** + NestJS **worker** + Next **dashboard**. Domain use-cases in `@entalent/application` (hexagonal ports). AI in `@entalent/ai-openai`. Persistence Drizzle in `@entalent/database`. Channels via `@entalent/channel-*`. Dashboard is an unauthenticated admin UI (network trust + server-side `ADMIN_API_KEY`).

---

## Complete inventory checklist

Every source file below was reviewed. Severity = highest finding for that file.

| File | Top |
|------|-----|
| `apps/api/src/admin/admin.module.ts` | OK |
| `apps/api/src/admin/analytics.controller.ts` | OK |
| `apps/api/src/admin/audit-logs.controller.ts` | OK |
| `apps/api/src/admin/feature-flags.controller.ts` | OK |
| `apps/api/src/admin/llm-runs.controller.ts` | OK |
| `apps/api/src/admin/manager-team.aggregate.test.ts` | OK |
| `apps/api/src/admin/manager-team.aggregate.ts` | OK |
| `apps/api/src/admin/manager-team.controller.ts` | OK |
| `apps/api/src/admin/manager-trends.aggregate.test.ts` | OK |
| `apps/api/src/admin/manager-trends.aggregate.ts` | OK |
| `apps/api/src/admin/manager-trends.controller.ts` | OK |
| `apps/api/src/admin/pulse-overview.controller.ts` | OK |
| `apps/api/src/admin/queues.controller.ts` | P1 |
| `apps/api/src/admin/survey-coverage.controller.ts` | OK |
| `apps/api/src/admin/user-debug.controller.ts` | OK |
| `apps/api/src/admin/user-insights.controller.ts` | P1 |
| `apps/api/src/app.module.ts` | P0 |
| `apps/api/src/audit/audit-log.repository.ts` | OK |
| `apps/api/src/audit/audit.module.ts` | OK |
| `apps/api/src/auth/api-key.guard.ts` | P1 |
| `apps/api/src/channel/channel.module.ts` | OK |
| `apps/api/src/channel/event-idempotency.service.ts` | OK |
| `apps/api/src/channel/ingestion.service.ts` | OK |
| `apps/api/src/channel/slack-events.controller.ts` | P1 |
| `apps/api/src/channel/slack-ingest.service.ts` | OK |
| `apps/api/src/channel/slack-socket-mode.service.ts` | OK |
| `apps/api/src/database/database.module.ts` | OK |
| `apps/api/src/database/database.service.ts` | OK |
| `apps/api/src/dev/dev-simulate.controller.ts` | P0 |
| `apps/api/src/dev/dev.module.ts` | P0 |
| `apps/api/src/health/db.health.ts` | OK |
| `apps/api/src/health/health.controller.ts` | OK |
| `apps/api/src/health/health.module.ts` | OK |
| `apps/api/src/health/redis.health.ts` | OK |
| `apps/api/src/main.ts` | OK |
| `apps/api/src/queue/queue.module.ts` | OK |
| `apps/api/src/queue/queue.types.ts` | OK |
| `apps/api/src/queue/redis.service.ts` | OK |
| `apps/api/src/users/user-data.controller.ts` | P1 |
| `apps/api/src/users/user-memory.controller.ts` | P1 |
| `apps/api/src/users/user-memory.service.ts` | OK |
| `apps/api/src/users/user-preferences.controller.ts` | P1 |
| `apps/api/src/users/users.module.ts` | OK |
| `apps/dashboard/next-env.d.ts` | OK |
| `apps/dashboard/next.config.ts` | OK |
| `apps/dashboard/src/app/components/Nav.tsx` | OK |
| `apps/dashboard/src/app/components/TeamTable.tsx` | OK |
| `apps/dashboard/src/app/layout.tsx` | OK |
| `apps/dashboard/src/app/lib.ts` | OK |
| `apps/dashboard/src/app/page.tsx` | OK |
| `apps/dashboard/src/app/pulse/DevControls.tsx` | P0 |
| `apps/dashboard/src/app/pulse/[userId]/page.tsx` | OK |
| `apps/dashboard/src/app/pulse/actions.ts` | P0 |
| `apps/dashboard/src/app/pulse/page.tsx` | P0 |
| `apps/dashboard/src/app/trends/charts.tsx` | OK |
| `apps/dashboard/src/app/trends/page.tsx` | OK |
| `apps/dashboard/src/app/types.ts` | OK |
| `apps/worker/src/app.module.ts` | OK |
| `apps/worker/src/conversation/ai.service.ts` | OK |
| `apps/worker/src/conversation/conversation.module.ts` | OK |
| `apps/worker/src/conversation/conversation.processor.ts` | OK |
| `apps/worker/src/conversation/llm-run.repository.ts` | OK |
| `apps/worker/src/conversation/outbox.service.ts` | P1 |
| `apps/worker/src/conversation/repositories/conversation.repository.ts` | OK |
| `apps/worker/src/conversation/repositories/workspace-connection.repository.ts` | OK |
| `apps/worker/src/crypto/local-encryption.adapter.ts` | OK |
| `apps/worker/src/database/database.module.ts` | OK |
| `apps/worker/src/database/database.service.ts` | OK |
| `apps/worker/src/feature-flags/feature-flag.module.ts` | OK |
| `apps/worker/src/feature-flags/feature-flag.repository.ts` | OK |
| `apps/worker/src/followup/follow-up-execution.processor.ts` | OK |
| `apps/worker/src/followup/followup.module.ts` | OK |
| `apps/worker/src/followup/repositories/follow-up-context.repository.ts` | OK |
| `apps/worker/src/followup/repositories/scheduled-action.repository.ts` | P1 |
| `apps/worker/src/health/db.health.ts` | OK |
| `apps/worker/src/health/health.controller.ts` | OK |
| `apps/worker/src/health/health.module.ts` | OK |
| `apps/worker/src/health/redis.health.ts` | OK |
| `apps/worker/src/main.ts` | OK |
| `apps/worker/src/memory/memory-extraction.processor.ts` | OK |
| `apps/worker/src/memory/memory.module.ts` | OK |
| `apps/worker/src/memory/repositories/goal.repository.ts` | OK |
| `apps/worker/src/memory/repositories/memory.repository.ts` | P1 |
| `apps/worker/src/message-send/message-send.module.ts` | OK |
| `apps/worker/src/message-send/message-send.processor.ts` | P1 |
| `apps/worker/src/proactive/check-in-enqueue.service.ts` | P1 |
| `apps/worker/src/proactive/proactive-scan.processor.ts` | OK |
| `apps/worker/src/proactive/proactive-scheduler.module.ts` | OK |
| `apps/worker/src/proactive/proactive-scheduler.repository.ts` | OK |
| `apps/worker/src/queue/queue.module.ts` | P1 |
| `apps/worker/src/queue/redis.service.ts` | OK |
| `apps/worker/src/safety/escalation-stub.service.ts` | P1 |
| `apps/worker/src/safety/repositories/audit-log.repository.ts` | OK |
| `apps/worker/src/safety/repositories/risk-signal.repository.ts` | OK |
| `apps/worker/src/safety/safety.module.ts` | OK |
| `apps/worker/src/survey/group-report.processor.ts` | P1 |
| `apps/worker/src/survey/repositories/group-state.repository.ts` | OK |
| `apps/worker/src/survey/repositories/pulse-backlog.repository.ts` | OK |
| `apps/worker/src/survey/repositories/survey.repository.ts` | OK |
| `apps/worker/src/survey/repositories/team.repository.ts` | OK |
| `apps/worker/src/survey/survey-evidence.processor.ts` | OK |
| `apps/worker/src/survey/survey.module.ts` | OK |
| `packages/ai-openai/src/ai-provider-router.test.ts` | OK |
| `packages/ai-openai/src/ai-provider-router.ts` | OK |
| `packages/ai-openai/src/circuit-breaker.ts` | OK |
| `packages/ai-openai/src/index.ts` | OK |
| `packages/ai-openai/src/openai-provider.test.ts` | OK |
| `packages/ai-openai/src/openai-provider.ts` | OK |
| `packages/ai-openai/src/prompts/classify.ts` | OK |
| `packages/ai-openai/src/prompts/confirm-interpret.ts` | OK |
| `packages/ai-openai/src/prompts/group-confirmation.ts` | OK |
| `packages/ai-openai/src/prompts/group-report.ts` | OK |
| `packages/ai-openai/src/prompts/memory.ts` | OK |
| `packages/ai-openai/src/prompts/respond-examples.ts` | OK |
| `packages/ai-openai/src/prompts/respond.test.ts` | OK |
| `packages/ai-openai/src/prompts/respond.ts` | P1 |
| `packages/ai-openai/src/prompts/risk.ts` | OK |
| `packages/ai-openai/src/prompts/sanitize.ts` | OK |
| `packages/ai-openai/src/prompts/style-antipatterns.test.ts` | OK |
| `packages/ai-openai/src/prompts/style-antipatterns.ts` | OK |
| `packages/ai-openai/src/prompts/survey.ts` | OK |
| `packages/ai-openai/vitest.config.ts` | OK |
| `packages/application/src/index.ts` | OK |
| `packages/application/src/ports/ai-provider.port.ts` | OK |
| `packages/application/src/ports/audit-log.port.ts` | OK |
| `packages/application/src/ports/conversation.repository.port.ts` | P1 |
| `packages/application/src/ports/data-deletion.repository.port.ts` | P1 |
| `packages/application/src/ports/encryption.port.ts` | P1 |
| `packages/application/src/ports/escalation.port.ts` | OK |
| `packages/application/src/ports/feature-flag.port.ts` | OK |
| `packages/application/src/ports/follow-up-context.port.ts` | OK |
| `packages/application/src/ports/goal.repository.port.ts` | OK |
| `packages/application/src/ports/ingestion.repository.port.ts` | OK |
| `packages/application/src/ports/memory.repository.port.ts` | OK |
| `packages/application/src/ports/outbox.port.ts` | P1 |
| `packages/application/src/ports/proactive-scheduler.repository.port.ts` | OK |
| `packages/application/src/ports/pulse-backlog.repository.port.ts` | OK |
| `packages/application/src/ports/risk-signal.repository.port.ts` | OK |
| `packages/application/src/ports/scheduled-action.repository.port.ts` | OK |
| `packages/application/src/ports/survey.repository.port.ts` | P0 |
| `packages/application/src/ports/workspace-connection.repository.port.ts` | OK |
| `packages/application/src/services/pulse-backlog.service.test.ts` | OK |
| `packages/application/src/services/pulse-backlog.service.ts` | P1 |
| `packages/application/src/types/records.ts` | P1 |
| `packages/application/src/use-cases/conversation-orchestrator.test.ts` | OK |
| `packages/application/src/use-cases/conversation-orchestrator.ts` | P0 |
| `packages/application/src/use-cases/data-deletion.use-case.ts` | P0 |
| `packages/application/src/use-cases/follow-up-execution.test.ts` | OK |
| `packages/application/src/use-cases/follow-up-execution.use-case.ts` | OK |
| `packages/application/src/use-cases/follow-up-scheduler.test.ts` | OK |
| `packages/application/src/use-cases/follow-up-scheduler.use-case.ts` | OK |
| `packages/application/src/use-cases/group-report.use-case.ts` | P1 |
| `packages/application/src/use-cases/memory-extraction.use-case.ts` | P1 |
| `packages/application/src/use-cases/proactive-check-in.use-case.test.ts` | OK |
| `packages/application/src/use-cases/proactive-check-in.use-case.ts` | OK |
| `packages/application/src/use-cases/proactive-scheduler.test.ts` | OK |
| `packages/application/src/use-cases/proactive-scheduler.use-case.ts` | OK |
| `packages/application/src/use-cases/survey-evidence.use-case.test.ts` | OK |
| `packages/application/src/use-cases/survey-evidence.use-case.ts` | P1 |
| `packages/application/src/utils/group-scoring.test.ts` | OK |
| `packages/application/src/utils/group-scoring.ts` | OK |
| `packages/application/src/utils/quiet-hours.ts` | OK |
| `packages/application/src/utils/survey-scoring.test.ts` | OK |
| `packages/application/src/utils/survey-scoring.ts` | P1 |
| `packages/application/src/utils/text-similarity.ts` | OK |
| `packages/application/vitest.config.ts` | OK |
| `packages/channel-core/src/index.ts` | OK |
| `packages/channel-core/src/ports/channel-adapter.port.ts` | P1 |
| `packages/channel-slack/src/index.ts` | OK |
| `packages/channel-slack/src/slack.adapter.ts` | P0 |
| `packages/channel-slack/src/slack.normalizer.ts` | OK |
| `packages/config/src/env.ts` | P1 |
| `packages/config/src/index.ts` | OK |
| `packages/contracts/src/ai.test.ts` | OK |
| `packages/contracts/src/ai.ts` | OK |
| `packages/contracts/src/channel.ts` | OK |
| `packages/contracts/src/events.ts` | OK |
| `packages/contracts/src/index.ts` | OK |
| `packages/contracts/vitest.config.ts` | OK |
| `packages/crypto-utils/src/aes-gcm.ts` | OK |
| `packages/crypto-utils/src/index.ts` | OK |
| `packages/database/drizzle.config.ts` | OK |
| `packages/database/src/__tests__/integration-setup.ts` | OK |
| `packages/database/src/__tests__/memory.integration.test.ts` | OK |
| `packages/database/src/__tests__/tenant.integration.test.ts` | OK |
| `packages/database/src/client.ts` | OK |
| `packages/database/src/index.ts` | OK |
| `packages/database/src/migrate.ts` | OK |
| `packages/database/src/schema/audit-logs.ts` | OK |
| `packages/database/src/schema/channel-accounts.ts` | OK |
| `packages/database/src/schema/conversations.ts` | OK |
| `packages/database/src/schema/feature-flags.ts` | P1 |
| `packages/database/src/schema/index.ts` | OK |
| `packages/database/src/schema/llm-runs.ts` | OK |
| `packages/database/src/schema/memory-items.ts` | P1 |
| `packages/database/src/schema/messages.ts` | P1 |
| `packages/database/src/schema/pulse-backlog.ts` | OK |
| `packages/database/src/schema/risk-signals.ts` | OK |
| `packages/database/src/schema/scheduled-actions.ts` | OK |
| `packages/database/src/schema/survey-group-states.ts` | OK |
| `packages/database/src/schema/survey.ts` | P1 |
| `packages/database/src/schema/teams.ts` | OK |
| `packages/database/src/schema/tenants.ts` | OK |
| `packages/database/src/schema/user-goals.ts` | OK |
| `packages/database/src/schema/users.ts` | OK |
| `packages/database/src/schema/workspace-connections.ts` | OK |
| `packages/database/src/seed.ts` | P1 |
| `packages/database/vitest.integration.config.ts` | OK |
| `packages/domain/src/conversation/conversation.ts` | OK |
| `packages/domain/src/errors.ts` | OK |
| `packages/domain/src/index.ts` | OK |
| `packages/domain/src/schema/memory-items.ts` | OK |
| `packages/domain/src/tenant/tenant.test.ts` | OK |
| `packages/domain/src/tenant/tenant.ts` | P1 |
| `packages/domain/src/user/user.test.ts` | OK |
| `packages/domain/src/user/user.ts` | P1 |
| `packages/domain/vitest.config.ts` | OK |
| `packages/observability/src/index.ts` | OK |
| `packages/observability/src/logger.ts` | P1 |
| `packages/observability/src/tracing.ts` | OK |

### Configs / Docker / CI / evals

| File | Top |
|------|-----|
| `package.json` | OK |
| `pnpm-workspace.yaml` | OK |
| `turbo.json` | P3 |
| `tsconfig.base.json` | GOOD |
| `docker-compose.yml` | P2 |
| `docker/docker-compose.yml` | P1 |
| `.github/workflows/ci.yml` | OK |
| `apps/api/Dockerfile` | P2 |
| `apps/worker/Dockerfile` | P2 |
| `apps/dashboard/Dockerfile` | GOOD |
| `evals/promptfooconfig.yaml` | P2 |


---

# Detailed reviews by area

> Format per file: **Role** · top findings. Full agent narratives were consolidated; every file in the inventory has an entry.

---

## 1. `packages/application` (44)

### Ports
- **`index.ts`** — Public barrel. P2 secrets-bearing records on public API; OK otherwise.
- **`ports/ai-provider.port.ts`** — Mega AI port (10 methods). P2 kitchen-sink ResponseContext; GOOD contracts import.
- **`ports/conversation.repository.port.ts`** — P1 missing tenant on `findRecentMessages` / `updateMessageDelivery`; OK `findById`.
- **`ports/ingestion.repository.port.ts`** — P1 signingSecret in identity DTO; P2 no explicit idempotency contract; GOOD tenant on creates.
- **`ports/workspace-connection.repository.port.ts`** — P1 plaintext secrets on record; P2 `findFirstByTenant` ambiguous.
- **`ports/outbox.port.ts`** — P1 GroupReportPayload lacks tenantId; GOOD most payloads carry tenant+trace.
- **`ports/memory.repository.port.ts`** — P1 `supersede` missing tenantId; GOOD other methods scoped.
- **`ports/goal.repository.port.ts`** — GOOD tenant + typed status; P2 category stringly.
- **`ports/scheduled-action.repository.port.ts`** — P1 dedup exists without tenant; P2 stringly type/intent.
- **`ports/follow-up-context.port.ts`** — GOOD policy DTO; P2 over-fetches secrets.
- **`ports/proactive-scheduler.repository.port.ts`** — GOOD SQL pushdown + batch limit; P2 default multi-tenant scan.
- **`ports/survey.repository.port.ts`** — **P0** many methods lack tenantId; P1 team methods mixed in; P2 no batch evidence API.
- **`ports/pulse-backlog.repository.port.ts`** — P1 several methods lack tenant; GOOD typed backlog status.
- **`ports/risk-signal.repository.port.ts`** — GOOD tenant; P2 stringly type/severity.
- **`ports/data-deletion.repository.port.ts`** — P1 incomplete erasure surface (no survey/goals/pulse); GOOD counts + tenant.
- **`ports/escalation.port.ts`** — OK thin; P2 stringly fields.
- **`ports/audit-log.port.ts`** — GOOD actorType union; P2 stringly action/resource.
- **`ports/feature-flag.port.ts`** — GOOD catalog; P2 `isEnabled(key: string)` defeats catalog typing.
- **`ports/encryption.port.ts`** — GOOD design; **P1 unused** while secrets still plaintext elsewhere.

### Types / services / utils
- **`types/records.ts`** — P1 pervasive stringly statuses; P1 secrets on WorkspaceConnectionRecord; P2 SurveyEvidence lacks tenantId.
- **`services/pulse-backlog.service.ts`** — P1 `covered` status never emitted by scoring; P2 hard-coded group order.
- **`services/pulse-backlog.service.test.ts`** — GOOD coverage; P2 mock drift vs port.
- **`utils/quiet-hours.ts`** — GOOD wrap logic; P2 invalid TZ throws.
- **`utils/text-similarity.ts`** — GOOD bilingual overlap coefficient.
- **`utils/survey-scoring.ts`** — P1 returns string / never `covered`; GOOD thresholds.
- **`utils/survey-scoring.test.ts`** — GOOD boundaries.
- **`utils/group-scoring.ts`** — P2 unknown polarity silent; GOOD clamps.
- **`utils/group-scoring.test.ts`** — GOOD; P3 no unknown polarity case.
- **`vitest.config.ts`** — OK; P3 no coverage gates.

### Use-cases
- **`conversation-orchestrator.ts`** — **P0** god UC + optional DI; P1 N+1 scoring, tenant holes, probe/crisis/Phase-B issues (see branch review); GOOD parallel classify.
- **`conversation-orchestrator.test.ts`** — GOOD Phase A/B; P1 coverage gaps (risk/probe/flags).
- **`survey-evidence.use-case.ts`** — P1 N+1 + expensive backfill; GOOD supersede/reversal; P2 hard-coded versions.
- **`survey-evidence.use-case.test.ts`** — GOOD; P2 naming confusion covered vs scored.
- **`memory-extraction.use-case.ts`** — P1 trust AI existingItemId within tenant; GOOD similarity gate.
- **`proactive-scheduler.use-case.ts`** — GOOD SRP; P2 sequential enqueue; no feature-flag gate.
- **`proactive-scheduler.test.ts`** — GOOD quiet-hours timers.
- **`proactive-check-in.use-case.ts`** — GOOD first-contact no-probe; P2 optional DI fail-open flags.
- **`proactive-check-in.use-case.test.ts`** — GOOD probe lifecycle; P2 mock drift.
- **`follow-up-scheduler.use-case.ts`** — P1 hard-coded UTC TZ; P2 ignores earliestDays/relevanceChecks.
- **`follow-up-scheduler.test.ts`** — GOOD gates; P2 mock port drift.
- **`follow-up-execution.use-case.ts`** — GOOD PolicyDecision union; P1 unsafe context cast; GOOD crisis postpone.
- **`follow-up-execution.test.ts`** — GOOD policy matrix; P2 missing reminder bypass tests.
- **`group-report.use-case.ts`** — P1 no tenant on team fetch; re-id risk in summaries; P2 Slack formatting in domain.
- **`data-deletion.use-case.ts`** — **P0/P1** incomplete GDPR surface; GOOD audit + parallel deletes.

---

## 2. `apps/api` (43)

### Bootstrap / auth / infra
- **`main.ts`** — GOOD migrate-before-listen + rawBody for Slack; P3 console.log debug.
- **`app.module.ts`** — **P0** ENABLE_DEV_ENDPOINTS mounts DevModule in prod.
- **`auth/api-key.guard.ts`** — GOOD fail-closed prod; **P1** non-timing-safe compare; P2 single shared key.
- **`database/database.module.ts`** — OK global.
- **`database/database.service.ts`** — GOOD pool close; OK.
- **`queue/queue.module.ts`** — GOOD registry; P2 Redis URL parse gaps; P1 dead queues also registered here (risk/followup).
- **`queue/queue.types.ts`** — GOOD core jobs; P2 incomplete vs all QUEUE_NAMES.
- **`queue/redis.service.ts`** — OK; P2 duplicate URL parse.
- **`health/*`** (module, controller, db, redis) — GOOD live/ready split; OK.

### Channel
- **`channel/channel.module.ts`** — OK.
- **`channel/ingestion.service.ts`** — GOOD decrypt credentials; P1 user create race; P2 JSON.parse shape.
- **`channel/event-idempotency.service.ts`** — GOOD NX+TTL.
- **`channel/slack-events.controller.ts`** — **P1** skip verify if rawBody missing; P2 url_verification before sig.
- **`channel/slack-ingest.service.ts`** — GOOD shared pipeline; P2 missing event_id skips idempotency.
- **`channel/slack-socket-mode.service.ts`** — OK optional; P2 direct process.env.

### Dev
- **`dev/dev.module.ts`** — P0 context when mounted.
- **`dev/dev-simulate.controller.ts`** — **P0** no auth; wipe/force/backfill blast radius.

### Users / audit
- **`audit/*`** — OK/GOOD port adapter.
- **`users/users.module.ts`** — OK.
- **`users/user-memory.service.ts`** — GOOD tenant scoped.
- **`users/user-memory.controller.ts`** — P1 PLACEHOLDER_TENANT.
- **`users/user-preferences.controller.ts`** — P1 PLACEHOLDER_TENANT; P2 no DTO validation.
- **`users/user-data.controller.ts`** — P1 incomplete GDPR + placeholder tenant.

### Admin
- **`admin/admin.module.ts`** — OK.
- **`admin/audit-logs.controller.ts`** — GOOD limits; P2 omit tenant → all tenants.
- **`admin/queues.controller.ts`** — P1 DLQ returns full job.data; P2 missing proactive-scan.
- **`admin/analytics.controller.ts`** — GOOD k-anonymity.
- **`admin/feature-flags.controller.ts`** — P2 no key allowlist; P3 no audit.
- **`admin/llm-runs.controller.ts`** — P2 select * may expose payloads.
- **`admin/user-debug.controller.ts`** — GOOD audit+redaction; P1 empty default tenant.
- **`admin/user-insights.controller.ts`** — P1 ignored tenantId.
- **`admin/pulse-overview.controller.ts`** — GOOD tenant filters; P2 all questions unscoped.
- **`admin/survey-coverage.controller.ts`** — GOOD k-anonymity.
- **`admin/manager-team.controller.ts`** + **aggregate(+test)** — GOOD pure aggregate + tests.
- **`admin/manager-trends.controller.ts`** + **aggregate(+test)** — GOOD parameterized SQL + tests.

---

## 3. `apps/worker` (45)

### Bootstrap / queue / health
- **`main.ts`**, **`app.module.ts`**, **`database/*`** — OK/GOOD.
- **`queue/queue.module.ts`** — **P1** dead RISK_ANALYSIS / FOLLOWUP_PLANNING; P2 no TLS parse.
- **`queue/redis.service.ts`** — P2 TLS/username.
- **`health/*`** — GOOD live/ready.

### Conversation / send
- **`conversation/conversation.module.ts`** — GOOD factory DI; P2 queue re-register noise.
- **`conversation/conversation.processor.ts`** — P2 logs response snippet PII.
- **`conversation/ai.service.ts`** — GOOD full port.
- **`conversation/outbox.service.ts`** — **P1** no deterministic jobIds.
- **`conversation/llm-run.repository.ts`** — OK.
- **`conversation/repositories/conversation.repository.ts`** — P2 tenant gaps on message ops.
- **`conversation/repositories/workspace-connection.repository.ts`** — P3 dead `findSlackAccountByUserId`.
- **`message-send/*`** — **P1** retry can double-send Slack; P2 logs full text in dev.

### Crypto / memory / followup
- **`crypto/local-encryption.adapter.ts`** — P3 dead (unused).
- **`memory/memory.module.ts`** — P2 couples follow-up schedule.
- **`memory/memory-extraction.processor.ts`** — P2 schedule failure after extract commit.
- **`memory/repositories/memory.repository.ts`** — P1 supersede without tenant.
- **`memory/repositories/goal.repository.ts`** — OK.
- **`followup/followup.module.ts`** — P2 duplicate providers.
- **`followup/follow-up-execution.processor.ts`** — OK.
- **`followup/repositories/scheduled-action.repository.ts`** — **P1** dedup ignores status.
- **`followup/repositories/follow-up-context.repository.ts`** — GOOD parallel load; P2 conversation without tenant.

### Flags / survey / safety / proactive
- **`feature-flags/*`** — GOOD tenant-over-global + hash rollout.
- **`survey/survey.module.ts`** — GOOD confirmation path removed.
- **`survey/survey-evidence.processor.ts`** — OK backfill branch.
- **`survey/group-report.processor.ts`** — P1 double-DM on retry.
- **`survey/repositories/survey.repository.ts`** — P2 window create / assessment upsert races.
- **`survey/repositories/group-state.repository.ts`** — P2 untyped status; no tenant on pending/awaiting lists.
- **`survey/repositories/pulse-backlog.repository.ts`** — P2 N+1 resolveIgnoredEntries.
- **`survey/repositories/team.repository.ts`** — P2 no tenant on find.
- **`safety/escalation-stub.service.ts`** — **P1** stub only.
- **`safety/repositories/*`** — OK.
- **`proactive/proactive-scan.processor.ts`** — GOOD fixed jobId repeatable.
- **`proactive/check-in-enqueue.service.ts`** — P1 no jobId.
- **`proactive/proactive-scheduler.repository.ts`** — GOOD SQL candidates.
- **`proactive/proactive-scheduler.module.ts`** — OK.

---

## 4. `packages/database` (27)

- **`index.ts`**, **`client.ts`**, **`migrate.ts`**, **`drizzle.config.ts`**, **`vitest.integration.config.ts`**, **`__tests__/*`** — OK/GOOD (tests cover cascade/isolation).
- **`seed.ts`** — P1 policy JSON drift vs domain; P2 duplicated crypto.
- **`schema/tenants.ts`** — P1 untyped jsonb policies; no RLS.
- **`schema/users.ts`** — P1 quiet-hours shape drift; P2 index drift vs SQL.
- **`schema/teams.ts`** — P1 no unique active membership; P2 Slack-specific manager id.
- **`schema/conversations.ts`** — GOOD unique key.
- **`schema/messages.ts`** — P1 plaintext PII; P2 no composite history index.
- **`schema/memory-items.ts`** — P1 plaintext sensitive content.
- **`schema/audit-logs.ts`** — GOOD no FK by design; P2 no append-only DB enforce.
- **`schema/llm-runs.ts`** — GOOD no prompt bodies.
- **`schema/channel-accounts.ts`** — P2 unique omits tenantId.
- **`schema/workspace-connections.ts`** — GOOD encryptedCredentials naming.
- **`schema/user-goals.ts`** — OK.
- **`schema/risk-signals.ts`** — P1 cascade erases risk history with user.
- **`schema/scheduled-actions.ts`** — GOOD due/status index; P2 nullable dedup unique.
- **`schema/survey.ts`** — P1 evidence/assessments lack tenantId; windows missing indexes.
- **`schema/survey-group-states.ts`** — GOOD tenant+unique; P2 free-text status.
- **`schema/pulse-backlog.ts`** — GOOD indexes.
- **`schema/feature-flags.ts`** — P1 unique only in SQL not Drizzle.
- **`schema/index.ts`** — OK.

---

## 5. `packages/ai-openai` (20)

- **`index.ts`** — GOOD public surface for evals.
- **`openai-provider.ts`** — GOOD truncation/retry; P2 scoreSentiment no sanitize.
- **`ai-provider-router.ts`** — GOOD fallback composition.
- **`circuit-breaker.ts`** — GOOD; P3 no dedicated tests.
- **`vitest.config.ts`** — OK.
- **`prompts/sanitize.ts`** — GOOD central; P2 not used for system-prompt embeds.
- **`prompts/respond.ts`** — **P1** unsanitized confirmation evidence in system; P2 memory embeds; P2 rule contradiction.
- **`prompts/classify.ts`**, **`risk.ts`**, **`survey.ts`** — GOOD sanitize+fence.
- **`prompts/memory.ts`** — GOOD transcript; P2 existing memory unsanitized.
- **`prompts/group-confirmation.ts`** — P2 missing UNTRUSTED markers (but sanitizes).
- **`prompts/group-report.ts`** — GOOD intent.
- **`prompts/confirm-interpret.ts`** — **GOOD** best sandbox.
- **`prompts/respond-examples.ts`**, **`style-antipatterns.ts`(+test)** — GOOD.
- **`prompts/respond.test.ts`**, **`openai-provider.test.ts`**, **`ai-provider-router.test.ts`** — GOOD/OK.

---

## 6. `apps/dashboard` (14)

- **`lib.ts`** — GOOD key server-side; P1 no login (network trust).
- **`types.ts`** — P2 duplicated DTOs.
- **`layout.tsx`**, **`page.tsx`**, **`components/Nav.tsx`**, **`components/TeamTable.tsx`** — OK.
- **`pulse/page.tsx`**, **`DevControls.tsx`**, **`actions.ts`** — **P0** always-on destructive.
- **`pulse/[userId]/page.tsx`** — GOOD displayStatus; P1 open PII surface.
- **`trends/page.tsx`**, **`trends/charts.tsx`** — OK/GOOD KISS charts.
- **`next.config.ts`** — GOOD standalone; OK.
- **`next-env.d.ts`** — OK generated.

---

## 7. Small packages

### domain (9)
- **`errors.ts`** — GOOD TenantIsolationError.
- **`user/user.ts`(+test)** — GOOD quiet-hours logic; P1 shape drift vs records/DB.
- **`tenant/tenant.ts`(+test)** — P1 policy field drift vs seed; P2 generic Error.
- **`conversation/conversation.ts`** — OK.
- **`schema/memory-items.ts`** — P3 dead placeholder.
- **`index.ts`**, **`vitest.config.ts`** — OK.

### contracts (6)
- **`channel.ts`**, **`events.ts`**, **`ai.ts`(+test)** — GOOD Zod contracts; P2 unbounded text / open records.
- **`index.ts`**, **`vitest.config.ts`** — OK.

### config (2)
- **`env.ts`** — P1 ADMIN_API_KEY not enforced in prod; P1 proactive days=0; GOOD OpenAI XOR Azure.
- **`index.ts`** — OK.

### crypto-utils (2)
- **`aes-gcm.ts`** — GOOD AES-GCM; P2 no AAD/key versioning.
- **`index.ts`** — OK.

### observability (3)
- **`logger.ts`** — P1 no redact paths.
- **`tracing.ts`** — P2 no auto-instrumentations.
- **`index.ts`** — OK.

### channel-core (2)
- **`ports/channel-adapter.port.ts`** — P1 UpdateOutgoingMessage lacks channel id (causes Slack bug).
- **`index.ts`** — OK.

### channel-slack (3)
- **`slack.adapter.ts`** — **P0** updateMessage channel bug; GOOD HMAC+timingSafe+skew.
- **`slack.normalizer.ts`** — OK; P2 empty teamId fallback.
- **`index.ts`** — OK.

---

## 8. Root / Docker / CI / evals

- **`package.json`**, **`pnpm-workspace.yaml`**, **`tsconfig.base.json`** — GOOD/OK.
- **`turbo.json`** — P3 dashboard outputs may under-cache.
- **`docker-compose.yml`** — OK local pgvector; P2 weak creds (dev).
- **`docker/docker-compose.yml`** — P1 postgres image without pgvector vs root compose.
- **`.github/workflows/ci.yml`** — GOOD placeholders; OK.
- **`apps/api/Dockerfile`**, **`apps/worker/Dockerfile`** — GOOD deploy; P2 root user.
- **`apps/dashboard/Dockerfile`** — GOOD non-root.
- **`evals/promptfooconfig.yaml`** + datasets + `providers/respond-prompt.js` — GOOD respond production bridge; P2 most suites use stub prompts not prod builders.

---

## Recommended fix order (whole repo)

1. **Security gates:** DevModule auth + DevControls gate; Slack updateMessage; rawBody HMAC; ADMIN_API_KEY prod refine  
2. **Tenant isolation:** survey/pulse/message port+repo tenantId; insights/users tenant; consider RLS  
3. **Delivery correctness:** Bull jobIds; message-send/group-report idempotency; dedup status filter  
4. **Confirmation cleanup:** extract service + ConfirmationTurn (existing plan Tasks 1–2)  
5. **Data/privacy:** GDPR completeness; logger redaction; encrypt or restrict sensitive columns  
6. **Schema/contracts:** quiet-hours + tenant policy alignment; Drizzle index/unique sync; status unions  
7. **Ops hygiene:** remove dead queues; wire or delete EncryptionPort/LocalEncryptionAdapter; non-root Docker; escalation real sink  

---

## Coverage attestation

| Bucket | Count | Reviewed |
|--------|------:|----------|
| `apps/worker` TS | 45 | ✅ all |
| `packages/application` TS | 44 | ✅ all |
| `apps/api` TS | 43 | ✅ all |
| `packages/database` TS | 27 | ✅ all |
| `packages/ai-openai` TS | 20 | ✅ all |
| `apps/dashboard` TS/TSX | 14 | ✅ all |
| `packages/domain` TS | 9 | ✅ all |
| `packages/contracts` TS | 6 | ✅ all |
| channel/config/crypto/observability TS | 12 | ✅ all |
| Root/Docker/CI/evals | 11 | ✅ all |

**Every file in `_inventory-ts-files.txt` plus listed configs was reviewed.**  
Previous branch-only doc remains useful for PR-scoped deltas; this document is the full-repo baseline.
