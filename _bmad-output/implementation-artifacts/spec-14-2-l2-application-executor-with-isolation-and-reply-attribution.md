---
title: 'Story 14.2: L2 Application Executor with Isolation and Reply Attribution'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '0aef189af8fb02998b682d4f7b77e64ee89bb47b'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-14-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      reset-user may queue an onboarding intro that lands after the isolation empty check and ends step 1 unsolicited-outbound on both attempts.
    evidence: |-
      dev-simulate.controller resetUser restarts onboarding and enqueues onboarding-only when restart.unitId is set; the executor ignores onboarding.introQueued. Settled by a real stack run: does a suite-* dev user without an org onboarding delivery ever get a unitId?
    location: >-
      packages/conversation-sim/src/suite/executors/l2-application-executor.ts isolate
    severity: medium (unverified)
  - summary: >-
      A completed job outside the 500-per-state scan resolves jobStatus null, so product silence is reported reply-timeout:none.
    evidence: |-
      14.1 DEV_JOB_SCAN_LIMIT 500 vs removeOnComplete 1000; only on a long-lived Redis. A disposable CI stack (14.3) avoids it.
    location: >-
      apps/api/src/dev/dev-simulate.controller.ts DEV_JOB_SCAN_LIMIT
    severity: low
  - summary: >-
      The disclosureDelivered satisfied path is untested and unreachable through the executor (isolation guarantees an empty conversation before verify).
    evidence: |-
      isolate() requires zero rows; verify reads the same conversation. 14.3 or smoke-v1 must decide how disclosure (and pulseCycle) state can exist at L2 without a write path.
    location: >-
      packages/conversation-sim/src/suite/executors/l2-application-executor.ts l2DisclosureDeliveredFixture
    severity: low
  - summary: >-
      The dev-api-client zod response schemas were never checked against the real 14.1 controllers.
    evidence: |-
      All tests use a fake transport by user decision. Settled by the first local stack run or an API-side contract test.
    location: >-
      packages/conversation-sim/src/suite/executors/dev-api-client.ts
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** The suite runs journeys only in process (L0/L1); nothing drives a case record through the real local API, queue, worker and Postgres, so dashboard-origin `state` criteria are never observed and an asynchronous worker or check-in reply could not be told apart from the step's reply.

**Approach:** Add `dev-api-client.ts` (env-validated, localhost-only client over an injected HTTP transport, `X-Api-Key` on every `/api/v1/dev` call) and `l2-application-executor.ts` (`level: 'L2'`, journeys only): a fresh persona per case through the existing dev endpoints, verify-only L2 fixtures, steps sent with `simulate-message`, replies attributed by `traceId` from bounded polling, and `state` criteria read from the dev reads with `method: 'observed'`. The executor is reachable only from the gated live entry `run-live.ts` with `--level L2 --live-model --live-app`; the default `suite:run` keeps refusing L2.

**User decisions (2026-10-25, recorded as intent):** QA suite `p-v1` (12.4) is out of scope and empty; smoke scenarios come later in `smoke-v1`, after the framework. No live model calls and no run against a real application stack in this story: every test uses a fake transport. Default `suite:run` refuses L2 without an explicit live gate, and the client refuses any non-local base URL (never production). L2 never mutates the database directly; isolation per test uses the existing dev endpoints; tenant from `SUITE_L2_TENANT_ID`.

**Planning decisions:** (1) **Live gate:** `run-live.ts` accepts `--level L2` only with both `--live-model` (the L2 run calls the live pinned judge, and the stack's worker calls its own coach model) and the new `--live-app` (drives a running local stack); `--live-app` at any other level is refused; `ci --level L2` stays refused (14.3 owns the workflow). (2) **Fixtures are verify-only at L2:** AD-12 authorizes no write path and the user forbids direct DB mutation, so `freshPersona`, `pulseCycle` and `disclosureDelivered` are supported with `apply()` writing nothing and `verify()` reading the dev endpoints; when the stack has not established the state, every criterion is `INVALID precondition:<name>` (honest, never seeded green). `seededHistory`, `confirmationState`, `clock`, `pendingBotQuestion`, `proactiveUsers` are unsupported. (3) **Budgets:** coach calls run inside the app worker and are not observable, so L2 makes no `CallBudget` reservation, `coachModel` is `null` (`models.coach: null`), and `maxCoachCallsPerRun` does not apply; the judge budget applies unchanged through `runSuite`. Coach calls are bounded by steps x tests x `--runs`. (4) **`l2.workerEnv`** (name and refusal) is Story 14.3's AC and is not added here. (5) **Live P-10.J run** (AC 4) cannot run: the suites are empty by user decision and a real stack run is forbidden; it is covered by a fake-transport journey test and left to 14.3/`smoke-v1`.

## Boundaries & Constraints

**Always:**
- Env contract (`devApiConfigFromEnv(env)`): `SUITE_L2_API_BASE` required, `http:`/`https:`, hostname exactly `localhost`, `127.0.0.1` or `[::1]`, path empty, `/` or `/api/v1`, no userinfo, query or hash; `SUITE_L2_TENANT_ID` a UUID; `ADMIN_API_KEY` non-empty. A refusal names the variable and the rule, never the value. Every request goes to `<origin>/api/v1/dev/...` with header `X-Api-Key`; the key is never logged or put in an error.
- Client errors: a non-2xx status, a transport rejection, a per-request timeout or a body failing its zod schema throws `DevApiError { operation, status | null }`; the executor maps it to `SuiteExecutionError` `infrastructure` reason `dev-api:<operation>`, except `messages` with `after` answering `400`, reason `messages-after-rejected`.
- Isolation per test attempt: external user `suite-<runId>-<testId>` (suffix `-s<sample>-a<attempt>` when sample or attempt is above 1); `GET find-conversation?tenantId&userId&userName` -> `POST reset-user { userId, tenantId, deep: true }` -> `GET find-conversation` again (deep reset deletes the conversation) -> `GET conversation/:id/messages` must be empty (else `infrastructure` `isolation-not-empty`) -> `subject { externalUserId, userId, conversationId, tenantId }`. `ExecutorOptions` gains optional `runId` and `sample`, passed by `runSuite`; missing `runId` at L2 is an infrastructure error `run-id-missing`.
- Steps: before every step after the first wait `interMessageGapMs` plus `advanceClock` for real through the injected `sleep` (`stepGap`), record `gapMs`; `POST simulate-message { tenantId, userId: externalUserId, text }`; a response `conversationId` different from the subject is `infrastructure` `conversation-mismatch`.
- Polling: `GET messages?after=<inboundMessageId>` every 500 ms until 60 s from the send (injected `now`/`sleep`). A row whose id is the inbound id, or any inbound row, is `infrastructure` `after-not-honored`. Outbound with the step `traceId` is the reply; any other outbound is `unsolicited`; a foreign outbound seen while the step has no own outbound yet ends the case `ERROR infrastructure unsolicited-outbound`. Polling ends on the first poll after one with own outbounds that adds no new own outbound. On timeout without own outbound: read the inbound's `jobStatus` from an unfiltered messages read; `completed` -> re-poll once, then `reply: null` if still none; `failed` -> `product` `job-failed`; `queued`/`processing`/`null`/missing -> `infrastructure` `reply-timeout:<status|none>`.
- Reply shape: messages in `occurredAt` order, `ReplyMessage { id, text, occurredAt: ISO, metadata: object ({} when null) }`, `text` joined with `REPLY_MESSAGE_SEPARATOR`. `observed` = `reply.text`, `reply.messages`, `steps.gapMs`, `state.questionProgress`, `state.stagedBundleCount`, `state.surveyEvidenceCount`, `state.outboundCount`; never `events`, `turn.*` or `window.outbound`; `events: []`; no `clock`.
- State queries: `suite/fixtures/state-queries.ts` stays the single table, each row gaining `l2: { method: 'GET', path, select }` (pure, no network): `questionProgress` and `stagedBundleCount` -> `/dev/user/:userId/question-confirmation?tenantId=&group=` (`progress`, `stagedBundleCount`); `surveyEvidenceCount` -> `/dev/user/:userId/survey-state` (`count`); `outboundCount` -> `/dev/conversation/:conversationId/messages` (outbound rows). Values validate against `STATE_QUERY_VALUE_SCHEMAS` (invalid -> `infrastructure` `state-query:<name>`). Snapshots `before` (after fixtures), `afterStep` for `afterStepsNamed(test)`, `after`. `group` is `pulseCycleGroupOf(test)`.
- `evaluate` sets `method: 'observed'` for `state` criteria at L2 (L1 `substituted`, else `n/a`). `schema.ts` rejects `observation` tests declaring L2 (deferred), so they are `NOT_RUN level-not-declared`; the executor also refuses any non-journey test (`product` `l2-journeys-only`).
- Fixture verify at L2: `freshPersona` -> memory `count` 0, survey-state `count` 0, question-confirmation `surveyWindowId` null, `stagedBundleCount` 0, `pendingClarification` null (style and goals have no dev read; the detail says so). `pulseCycle` -> an active window whose `questions` hold, for every declared uncovered topic, a question of that group not `confirmed`/`declined` (param window and question ids are not compared). `disclosureDelivered` -> an outbound with non-null `sentAt` and `metadata.reportingDisclosureVersion === version`.
- Rule preconditions and `stop` checkpoints reuse `executors/shared.ts` (`rulePrecondition`, `stopCheckpoint`, `stepGap`, `unsupportedFixtureError`).

**Never:**
- No change to `apps/*`, `packages/*` other than `packages/conversation-sim`, `agent-service` or MAF paths; no dev write endpoint; no direct DB or Redis access; no `SLACK_*` read.
- No live model call, no real network or stack run in tests; no global `fetch` outside the default transport factory, which only `run-live.ts` calls.
- The default CLI and runner never reach the L2 executor or `dev-api-client.ts`; no baseline file, CI workflow, `smoke-v1`/`p-v1` case or `l2.workerEnv` is added.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy journey | 2 steps; each poll returns own outbound then nothing new | 2 steps with replies, `gapMs` 0 then 60000, state snapshots, subject ids | none |
| Multi-message reply | own outbounds arrive over two polls | reply has both, text joined | none |
| Unsolicited after reply | own outbound, later foreign outbound | foreign in `unsolicited` | none |
| Unsolicited first | foreign outbound before own | run errors `unsolicited-outbound` | infrastructure (retried) |
| Silence | timeout, `jobStatus: completed`, re-poll empty | `reply: null` | none |
| Late reply race | timeout, `completed`, re-poll has own outbound | reply recorded | none |
| Job failed / stuck | timeout, `failed` / `processing` | `job-failed` / `reply-timeout:processing` | product / infrastructure |
| Bad after | messages `?after=` answers 400 | `messages-after-rejected` | infrastructure |
| Not empty | conversation has rows after reset | `isolation-not-empty`, nothing sent | infrastructure |
| Bad env | remote host, non-UUID tenant, missing key, path `/x` | run-live exits 1, no request | refusal names variable only |
| Gate | L2 without `--live-app`; `--live-app` at L1; default CLI L2 | exit 1, nothing built | message names the gate |
| Unsupported fixture | journey with `seededHistory`/`clock` | `unsupported-fixture:<name>`, nothing sent | per runner |
| Fixture unmet | `disclosureDelivered` absent on fresh persona | precondition unsatisfied -> criteria INVALID | none |

</intent-contract>

## Code Map

- `packages/conversation-sim/src/suite/executors/types.ts` -- `SuiteExecutor`, `ExecutorOptions` (add `runId?`, `sample?`), `SuiteExecutionError`.
- `packages/conversation-sim/src/suite/runner.ts` -- `attemptCase` builds `ExecutorOptions` (~line 230): pass `runId: input.runId` and `sample`; `executionErrorKind`/`caseRunFailureKind` drive the one infrastructure retry; `execute` validates the `CaseRun` with `CaseRunSchema`.
- `packages/conversation-sim/src/suite/executors/l1-orchestrator-executor.ts` -- reference shape for `run()`: `fail`/`finish`, fixtures -> preconditions -> snapshot -> steps -> after; `CONVERSATION_FIELDS`.
- `packages/conversation-sim/src/suite/executors/shared.ts` -- reuse `unsupportedFixtureError`, `fixtureRefs`, `stepGap`, `stopCheckpoint`, `rulePrecondition`, `describeError`; its `FixtureRegistry`/`applyFixtures` are typed to the in-memory `FixtureContext`, so L2 fixtures get their own small registry/context in the executor folder (reuse each module's exported `params` schema: `freshPersonaFixture.params`, `pulseCycleFixture.params`, `disclosureDeliveredFixture.params`).
- `packages/conversation-sim/src/suite/executors/state-queries-l0.ts` -- `afterStepsNamed(test)`.
- `packages/conversation-sim/src/suite/fixtures/state-queries.ts` -- `L1_STATE_QUERIES` table, `readL1Snapshot`; add the `l2` column (rename/alias the table if needed but keep `L1_STATE_QUERIES` importers compiling: `l1-orchestrator-executor.ts`, `fixtures/state-queries.test.ts`).
- `packages/conversation-sim/src/suite/fixtures/pulse-cycle.ts` -- `pulseCycleGroupOf`, `CLOSED` statuses.
- `packages/conversation-sim/src/suite/schema.ts` -- `refineSuiteTest` (~line 357, add the observation/L2 rule), `CaseRunSchema`, `StepObservationSchema`, `ReplyMessageSchema` (strict; `metadata` is `ParamsSchema`), `STATE_QUERY_VALUE_SCHEMAS`.
- `packages/conversation-sim/src/suite/evaluate.ts:232` -- `method` for state criteria.
- `packages/conversation-sim/src/suite/run-live.ts` -- `LIVE_MODEL_FLAG`, level/command refusals, `createExecutor`; add `LIVE_APP_FLAG = '--live-app'`, L2 wiring with `devApiConfigFromEnv(cliDeps.env)` validated before `deps.run`, injectable `createDevApiTransport` in `RunLiveDeps`.
- `packages/conversation-sim/src/suite/cli.ts` -- `unsupportedLevel('L2')` (~line 910) message and `HELP`; `defaultDeps().createExecutor` keeps refusing L2.
- `packages/conversation-sim/src/suite/executors/import-graph.test.ts` -- add L2 executor and `dev-api-client.ts` to the "runner/cli never reach" list and assert `run-live.ts` reaches them; keep the existing violation set for run-live unchanged.
- `packages/conversation-sim/README.md` -- "Conversation suites" section: add an "L2 executor" subsection next to "L1 executor" (~line 377).
- Dev API facts (`apps/api/src/dev/dev-simulate.controller.ts`, read-only): global prefix `api/v1` (`apps/api/src/main.ts:26`); `ApiKeyGuard` reads `x-api-key`; `simulate-message` -> `{ traceId, messageId, conversationId, userId }` (202), external conversation `dev-conv-<externalUserId>` same as `find-conversation`; `find-conversation` -> `{ conversationId, userId }`; `reset-user` deep deletes messages, conversations, memory, goals, style, survey windows/evidence (user row kept; `onboarding.introQueued` may queue an intro, which then shows as a foreign outbound); messages rows `{ id, direction, text, occurredAt, traceId, messageType, sentAt, metadata, jobStatus }`; `user/:userId/memory` -> `{ count }`; `survey-state` -> `{ count }`; `question-confirmation` -> `DevQuestionConfirmationState` (group must be `autonomy|growth|purpose|belonging`, else 400; 409 on two windows). JSON dates arrive as ISO strings.

## Tasks & Acceptance

**Execution:**
- `packages/conversation-sim/src/suite/executors/dev-api-client.ts` -- `devApiConfigFromEnv`, `DevApiTransport` type, `createFetchTransport(timeoutMs)`, `DevApiClient` (findConversation, resetUser, simulateMessage, messages(conversationId, after?), questionConfirmation(userId, group), surveyState, memory), `DevApiError`, zod response schemas -- the AC's env, guard and header contract.
- `packages/conversation-sim/src/suite/executors/l2-application-executor.ts` -- `L2ApplicationExecutor` (options: client, `sleep`, `now`, poll interval/timeout overrides for tests), L2 fixture registry, isolation, steps, polling/attribution, snapshots -- AC 2 and 3.
- `packages/conversation-sim/src/suite/fixtures/state-queries.ts` -- `l2` column -- AD-10 single table.
- `packages/conversation-sim/src/suite/executors/types.ts`, `runner.ts` -- `runId`/`sample` options.
- `packages/conversation-sim/src/suite/evaluate.ts`, `schema.ts` -- `observed` at L2; observation tests never declare L2.
- `packages/conversation-sim/src/suite/run-live.ts`, `cli.ts` -- `--live-app` gate and L2 wiring; default refusal message.
- Tests: `executors/dev-api-client.test.ts` (env guard rows, header on every call, URL building, error mapping, 400), `executors/l2-application-executor.test.ts` (a scripted fake dev API over the transport covering every I/O row, fake `sleep`/`now`, a P-10-like journey run through `runSuite` with a stub judge showing `method: 'observed'`, verdict `n/a (journeys only)` and the subject ids), updates to `run-live.test.ts`, `cli.test.ts`, `runner.test.ts` (options carry runId/sample), `evaluate.test.ts`, `schema.test.ts`, `fixtures/state-queries.test.ts`, `import-graph.test.ts`.
- `packages/conversation-sim/README.md` -- L2 executor subsection: env contract, gate, isolation, attribution, budgets note, fixtures verify-only, how a human runs it.
- `docs/agent-task-log.md` -- one row for this task.

**Acceptance Criteria:**
- Given the package tests, when `pnpm --filter @entalent/conversation-sim test`, `typecheck` and `lint` run, then all pass with no network access and no model credentials.
- Given the default CLI, when `suite:run --suite smoke-v1 --level L2` runs, then it exits 1 naming `suite:run:live ... --live-model --live-app` and writes nothing; given `run-live.ts run --level L2 --live-model` without `--live-app`, it exits 1 before building an executor.
- Given the import graph, when the runner and CLI graphs are walked, then neither reaches `l2-application-executor.ts` or `dev-api-client.ts`, and `run-live.ts` does.
- Given the diff, when inspected, then nothing outside `packages/conversation-sim/`, `docs/agent-task-log.md` and BMad artifacts changed.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 32 findings — high 0, medium 3, low 17, false 6, maybe-false 6
- findings:
  - `[maybe-false]` `[defer]` (blind) reset-user may queue an onboarding intro that lands after the empty check and ends step 1 `unsolicited-outbound` on both attempts — settled only by a real stack run: whether `OnboardingRestartService.restart` yields a unitId for a `suite-*` dev user without an org onboarding delivery; deferred (medium, unverified) to 14.3.
  - `[low]` `[reject]` (blind) `disclosureDelivered` can never be satisfied at L2 (isolation guarantees an empty conversation before verify) — true, and exactly the intent-contract planning decision (2): verify-only, INVALID when the stack has not established the state; the fix (unsupported or a seeding path) edits the spec; surfaced for 14.3.
  - `[low]` `[reject]` (blind) `pulseCycle` almost certainly unsatisfiable on a deep-reset persona and ignores param ids — same planning decision (2); ids not compared by spec; surfaced for 14.3.
  - `[low]` `[defer]` (blind) a completed job outside the 500-per-state scan resolves `jobStatus: null`, so silence becomes `reply-timeout:none` — pre-existing 14.1 bound (already deferred there); bites only on a long-lived Redis; deferred.
  - `[low]` `[reject]` (blind) quiet period of one 500 ms poll can cut multi-part replies — the AC fixes the stop rule ("the next poll adds none"); changing it edits the spec.
  - `[medium]` `[patch]` (blind) fetch follows redirects, so `X-Api-Key` could leave localhost on a 3xx — patched: `redirect: 'error'` plus test.
  - `[low]` `[patch]` (blind) `ruleChecks` JSDoc now sits on `stateMethod` in evaluate.ts — patched: moved.
  - `[low]` `[patch]` (blind) HELP L2 block splits the L1 usage line from its paragraph — patched: reordered.
  - `[low]` `[patch]` (blind) README coach bound omits retries and multiple calls per step — patched wording; "no L2 coach cap" part rejected (planning decision 3).
  - `[low]` `[patch]` (blind) subject ids lost when isolation fails; `run-id-missing` retried — subject now recorded right after the post-reset find; `run-id-missing` kind is fixed by the spec (rejected part).
  - `[maybe-false]` `[reject]` (blind) suite personas accumulate in the tenant and may get proactive check-ins — the L2 worker runs with proactive scheduling disabled (`l2.workerEnv`, 14.3); if true only low.
  - `[false]` `[reject]` (blind) non-stop checkpoints get `after = before` — `stopCheckpoint` returns `continue` before calling the lazy `partial()` for non-stop checkpoints, so the state is never read.
  - `[false]` `[reject]` (blind) unknown errors reject the whole run — `runner.ts` `execute` catches any non-SuiteExecutionError and synthesizes an `executor-error` run; runSuite continues.
  - `[medium]` `[patch]` (verification-gap) `createFetchTransport` method/body forwarding never tested — patched: POST case asserting method, body, content type; GET without body.
  - `[medium]` `[patch]` (verification-gap) freshPersona `pending-clarification` branch untested — patched: test with only pendingClarification dirty.
  - `[low]` `[defer]` (verification-gap) disclosureDelivered satisfied path untested — unreachable through the executor (see above); defer until 14.3 settles how the state can exist.
  - `[low]` `[reject]` (verification-gap other) disclosureDelivered never satisfiable — duplicate of the blind row; planning decision (2).
  - `[low]` `[patch]` (verification-gap other) pulseCycle `declined` member of CLOSED unpinned — patched: test.
  - `[low]` `[patch]` (edge) foreign and own outbound in the same poll: an earlier foreign is filed unsolicited instead of ERROR — patched: occurredAt comparison plus test.
  - `[low]` `[reject]` (edge) multi-part reply beyond one interval — duplicate of the quiet-period row; AC-fixed.
  - `[low]` `[patch]` (edge) first own outbound on the deadline poll breaks without the trailing poll — patched: one trailing poll plus test.
  - `[low]` `[reject]` (edge) late reply after `completed` re-poll may span several messages — rare (a reply landing in the race window and split); a loop adds complexity.
  - `[maybe-false]` `[defer]` (edge) intro queued after reset — duplicate of the first blind row; deferred with it.
  - `[low]` `[patch]` (edge) collected afterStep snapshots dropped from an errored CaseRun — patched: errored run keeps before/afterStep.
  - `[low]` `[patch]` (edge) `SUITE_L2_API_BASE` with `/api/v1/` refused — patched: trailing slashes normalized plus test.
  - `[maybe-false]` `[reject]` (intent) end-to-end P-10.J run on a real stack not exercised — user decision: no real stack run, suites empty (planning decision 5).
  - `[false]` `[reject]` (intent) command shape `suite:run --level L2` refuses — user decision requires an explicit live gate.
  - `[maybe-false]` `[reject]` (intent) supported fixtures yield INVALID instead of evaluated criteria — duplicate; planning decision (2).
  - `[false]` `[reject]` (intent) base URL allows no "explicitly configured test target" — the AC and spine allow only localhost hosts; stricter than the user's ceiling.
  - `[maybe-false]` `[defer]` (intent) zod schemas never checked against the real 14.1 controllers — settled by the first real stack run or an API contract test; deferred (medium, unverified) to 14.3.
  - `[false]` `[reject]` (intent) atomic-never-L2 only enforced at runtime — `schema.ts` `refineSuiteTest` already rejects atomic tests declaring L2.
  - `[false]` `[reject]` (intent) budgets diverge from "call CallBudget" — the intent allows documenting instead; documented in README and the executor doc.

## Design Notes

Polling loop sketch (per step, all time through injected `now`/`sleep`):

```
deadline = sendAt + 60_000; own = []; sawOwnLastPoll = false
loop: rows = messages(conv, after=inbound)         // 400 -> messages-after-rejected
  newOwn = rows outbound with traceId == trace, not in own
  foreign = rows outbound with traceId != trace, not yet recorded -> unsolicited
  if foreign && own.empty && newOwn.empty -> ERROR unsolicited-outbound
  if sawOwnLastPoll && newOwn.empty -> done
  own += newOwn; sawOwnLastPoll = own.nonEmpty
  if now >= deadline -> timeout branch (own.nonEmpty -> done) ; sleep(500)
```

Human run against a local stack (documented, not run in this story): API with `NODE_ENV=test` and `ADMIN_API_KEY`, worker running, then `SUITE_L2_API_BASE=http://localhost:3000 SUITE_L2_TENANT_ID=<uuid> pnpm suite:run:live --suite <id> --level L2 --live-model --live-app --case <test>`.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim exec vitest run src/suite` -- expected: pass.
- `pnpm --filter @entalent/conversation-sim test` -- expected: pass.
- `pnpm --filter @entalent/conversation-sim typecheck` and `pnpm --filter @entalent/conversation-sim lint` -- expected: clean.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: receipt written; report its path.

## Auto Run Result

Status: done

**Summary:** L2 application executor over the local `/api/v1/dev` API, reachable only from `run-live.ts` with `--level L2 --live-model --live-app`. `dev-api-client.ts` validates `SUITE_L2_API_BASE` (localhost/127.0.0.1/[::1] only, path empty or `/api/v1`), `SUITE_L2_TENANT_ID` (UUID) and `ADMIN_API_KEY`, sends `X-Api-Key` on every call, refuses redirects, and checks every response with zod. `L2ApplicationExecutor` runs journeys only. Each attempt gets a fresh persona (`suite-<runId>-<testId>`, plus `-s<n>-a<n>` above 1): find, deep reset, find again, then an empty check. Fixtures are verify-only. Each step waits the real gap and is sent with `simulate-message`. Replies are attributed by `traceId` through 500 ms / 60 s polling, with `unsolicited` and `unsolicited-outbound`. On timeout the `jobStatus` branch decides: `completed` re-polls once, `failed` is `job-failed`, anything else is `reply-timeout:<status>`. State criteria are read from the dev routes and reported as `observed`. Coach calls are not budgeted at L2 (`coachModel: null`; the judge budget still applies).

**Files changed:**
- `packages/conversation-sim/src/suite/executors/dev-api-client.ts` (new) -- env guard, client, fetch transport, errors.
- `packages/conversation-sim/src/suite/executors/l2-application-executor.ts` (new) -- executor, verify-only L2 fixtures, polling and attribution, snapshots.
- `packages/conversation-sim/src/suite/executors/dev-api-client.test.ts`, `l2-application-executor.test.ts` (new) -- fake-transport tests for every I/O row; a P-10-like journey through `runSuite`.
- `packages/conversation-sim/src/suite/fixtures/state-queries.ts` -- single `STATE_QUERIES` table with an `l2` column (`L1_STATE_QUERIES` alias kept).
- `packages/conversation-sim/src/suite/executors/types.ts`, `runner.ts` -- `ExecutorOptions.runId` and `sample`.
- `packages/conversation-sim/src/suite/evaluate.ts` -- `method: 'observed'` for L2 state criteria.
- `packages/conversation-sim/src/suite/schema.ts` -- observation tests never declare L2.
- `packages/conversation-sim/src/suite/run-live.ts`, `cli.ts` -- `--live-app` gate and L2 wiring; default CLI refuses L2; HELP.
- Test updates: `run-live.test.ts`, `cli.test.ts`, `runner.test.ts`, `evaluate.test.ts`, `schema.test.ts`, `fixtures/state-queries.test.ts`, `executors/import-graph.test.ts`.
- `packages/conversation-sim/README.md` -- L2 executor section.
- `docs/agent-task-log.md` -- task row.

**Review:** 32 findings (high 0, medium 3, low 17, false 6, maybe-false 6).
- Patched:
  - Redirect refusal, so the key cannot leave localhost.
  - Fetch transport method and body tests.
  - Trailing-slash base.
  - Foreign-before-own outbound within the same poll.
  - Trailing poll on the deadline.
  - Subject and snapshots kept on error.
  - freshPersona pendingClarification and pulseCycle `declined` tests.
  - JSDoc placement, HELP order and README budget wording.
- Deferred (frontmatter):
  - Onboarding intro after reset (unverified).
  - `jobStatus` scan bound from 14.1.
  - Unreachable disclosureDelivered satisfied path.
  - Zod schemas never checked against the real controllers (unverified).
- Rejected, with reasons in the triage log:
  - Verify-only fixtures that are always INVALID on a fresh persona. This is planning decision (2); fixing it means editing the spec.
  - The AC-fixed stop rule for multi-part replies.
  - The late multi-part reply race (rare).
  - Persona accumulation, which proactive scheduling being off in 14.3 covers.
  - The false items: non-stop checkpoint state, runner abort on unknown errors, command shape, base-URL ceiling, atomic L2 rule, budgets.

**Follow-up review recommended:** true. Three medium entries were patched (redirect refusal, transport forwarding test, freshPersona branch test). The unverified risk is the transport and zod contracts against the real 14.1 API: the first local stack run (14.3) should exercise POST bodies and the response schemas. Patched counts by entry verdict: medium 3, low 10.

**Verification:**
- `pnpm --filter @entalent/conversation-sim test`: 58 files, 1155 tests passed.
- `typecheck` and `lint`: clean.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` passed; receipt `runs/harness/receipt-1792970435754-c0d4265d.json`.

**Residual risks:**
- Never run against a real local stack (by user decision).
- `pulseCycle` and `disclosureDelivered` cannot be satisfied on a fresh, deep-reset persona without a seeding path. Criteria using them are INVALID until 14.3 or smoke-v1 decides how that state exists.
- An onboarding intro after reset may trip `unsolicited-outbound`.
- `l2.workerEnv` is not added (it is 14.3's AC).
