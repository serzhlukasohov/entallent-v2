# Epic 14 Context: Full-Application Verification on the Real Path (L2)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Extend the conversation evaluation suite (already running at L0 on every PR and at L1 with a live coach) to a third level, L2, that drives the same case records through the real local API, BullMQ queue, worker and Postgres via development-only endpoints. QA then sees the criteria that the dashboard and database expose observed on the real product path, not substituted from in-memory repositories. Runs happen weekly and on demand in CI against a disposable stack. Each case gets its own fresh persona, and replies are attributed by trace, so an asynchronous worker or a proactive check-in cannot be mistaken for a reply.

## Stories

- Story 14.1: Additive Development Read Endpoints
- Story 14.2: L2 Application Executor with Isolation and Reply Attribution
- Story 14.3: Weekly L2 Workflow and the First L2 Baseline

## Requirements & Constraints

- L2 targets only the local docker stack (API, worker, Postgres, Redis) through `/api/v1/dev` endpoints. It never targets Railway or production, and no level reads `SLACK_*`.
- Base URL guard: refuse any `SUITE_L2_API_BASE` whose host is not `localhost`, `127.0.0.1` or `[::1]`. Env contract: `SUITE_L2_API_BASE`, `SUITE_L2_TENANT_ID`, `ADMIN_API_KEY`. Send `X-Api-Key` on every call.
- L2 runs `journey` tests only. Atomic tests never declare L2. Observation tests at L2 are deferred, so their criteria are `NOT_RUN` reason `level-not-declared`.
- An L2 run reports the verdict `n/a (journeys only)` with no layer table. Journey results are reported and diffed in their own section.
- State criteria (`questionProgress`, `stagedBundleCount`, `surveyEvidenceCount`, `outboundCount`) are answered from dev endpoints with `CriterionResult.method: 'observed'`. At L2 they stay snapshot-based, with no `effect-count` pairing, because L2 does not declare `events`. The event log at L2 is deferred.
- Product-side changes are limited to additive, read-only GET routes or fields in `dev-simulate.controller.ts`. They read existing repositories, add no write path and exist only in the dev module. Nothing else in product code changes.
- Known expected reds stay red. Do not change product behavior to make a criterion green.
- The baseline for L2 requires `n >= 3` and changes only through `suite:baseline:accept`, under the `baseline-change` label and a QA CODEOWNERS review.
- L2 must stay TypeScript-only. Retired MAF and `agent-service` stay untouched.

## Technical Decisions

- **Executor port:** `l2-application-executor.ts` (`level: 'L2'`) and `dev-api-client.ts` live in `packages/conversation-sim/src/suite/executors/`. The executor implements `SuiteExecutor { level, supports(fixture), observes(), run(case, options) }` and returns a `CaseRun`, never a status. It declares supported fixtures: at least `pulseCycle`, `disclosureDelivered` and `freshPersona`. `seededHistory`, `confirmationState` and `clock` are unsupported at L2. An unsupported fixture yields `NOT_RUN` reason `unsupported-fixture:<name>` and an INCOMPLETE run.
- **Isolation per case:**
  1. Create the external user `suite-<runId>-<testId>` via `GET /dev/find-conversation`.
  2. Call `POST /dev/reset-user { userId, tenantId, deep: true }`.
  3. Verify the conversation is empty.
  4. Record the ids in `CaseRun.subject`.

  `freshPersona` means only "no seeded memory, style or survey state".
- **Step execution:** Wait `interMessageGapMs` (default 60000, from `suite.config.json`) for real before each step after the first, and record it as `gapMs`. Send each step with `POST /dev/simulate-message`, then take `traceId` and the inbound message id from its response.
- **Polling and attribution:**
  - Poll `GET /dev/conversation/:id/messages?after=<inboundMessageId>` every 500 ms for up to 60 s.
  - Stop when the trace has at least one outbound and the next poll adds none.
  - Outbounds with a foreign `traceId` go to `unsolicited`. A foreign outbound before the reply is `ERROR kind: infrastructure` reason `unsolicited-outbound`.
  - A `400` (unknown `after`) is an infrastructure error.
  - On timeout: if `jobStatus` is `completed` and there is no outbound, record `reply: null`, which is product silence and gets evaluated. Any other job status on timeout is `ERROR`.
- **Dev endpoint additions:**
  - Message rows carry `metadata` (already present before 14.1) and gain `jobStatus`. `jobStatus` is one of `queued | processing | completed | failed`, or `null` for outbound and for an inbound whose job is not found within the bounded scan. It is resolved by finding the conversation queue job whose payload `messageId` equals the inbound id. An unknown `after` returns `400` instead of the full history.
  - New `GET /dev/user/:userId/question-confirmation?tenantId=&group=` (`tenantId` is a required UUID; `group` optional, one of `autonomy|growth|purpose|belonging`) returns per-question statuses, `progress { answered, total }`, applied verdict receipts, staged bundle count and pending clarification. It reads the V2 question-confirmation tables directly (the repository lives in the worker) and is tenant-scoped.
  - `GET /dev/user/:userId/survey-state` returns `count` (already present before 14.1); it counts non-superseded evidence across all of the user's windows and is not tenant-scoped.
  - None of these routes exist when `NODE_ENV=production`.
- **State-query table:** `suite/fixtures/state-queries.ts` is the single table mapping each `StateQueryName` to an `l1` accessor and an `l2: { method, path }` route. Per-query schemas live in `suite/schema.ts`, shared by all levels. L2 fills in the `l2` rows.
- **Retry:** The retry unit is the case. An infrastructure `SuiteExecutionError` discards the `CaseRun`, re-applies fixtures and re-runs once, incrementing `attempt`. Product errors never retry. The error kind comes from `gate/failure-kind.ts`.
- **API and worker setup:** The L2 API runs with `NODE_ENV=test`, so `DevModule` mounts and `ApiKeyGuard` is active. The L2 worker runs with proactive scheduling disabled through the env var named in `suite.config.json.l2.workerEnv`. Story 14.3 defines that var's name. The executor refuses to start when `l2.workerEnv` is absent.
- **CI:** A new `.github/workflows/conversation-suite-l2.yml` runs on `schedule` and `workflow_dispatch`:
  1. Starts `pgvector/pgvector:pg16` and `redis:7-alpine` services, then applies migrations and seed.
  2. Starts `api` and `worker` from the checkout and waits for health.
  3. Runs `pnpm suite:run --suite p-v1 --level L2 --runs 3` and `suite:diff --merge-base`.
  4. Uploads `runs/suites/**` plus the API and worker logs.
  5. Writes the journey results, the verdict and the journey diff to the step summary.

  The diff reads the baseline from the merge-base. Exit codes: 0 clean, 1 diff failed, 2 baseline invalid, 3 judge infra, 4 budget exceeded.
- **Baseline file:** `packages/conversation-sim/baselines/p-v1/L2.json`, keyed `<testId>/<criterionId>`.
- **User decision (2026-10-25):** QA suite `p-v1` (12.4) is out of scope and empty; the team's smoke scenarios will live in `smoke-v1` after the framework. The `p-v1` names above come from the planning AC and stay to be reconciled in 14.3.

## Cross-Story Dependencies

- Story 14.2 depends on 14.1. The executor's `jobStatus`-based timeout handling, its `400`-on-`after` handling and its state queries need the new dev reads.
- Story 14.3 depends on 14.2. It also defines the `l2.workerEnv` flag that 14.2's executor requires, and documents it in `suite.config.json` and `packages/conversation-sim/README.md`.
- Builds on Epics 12-13:
  - Epic 12: loader, schema, runner, evaluate/score, report, diff, `suite:baseline:accept`, `SuiteExecutionError` and the failure-kind predicates, the P-suite journeys.
  - Epic 13: judge and `JudgeTrust` for meaning criteria in journeys, the state-query table with its L1 accessors, `suite.config.json` budgets and minSamples.
- Product touchpoints: `apps/api/src/dev/dev-simulate.controller.ts` and the existing question-confirmation, survey and conversation repositories. The worker's proactive scheduler is touched only through an env toggle.
