---
title: 'Story 14.1: Additive Development Read Endpoints'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '906343b45fa46b023a616415f4179d5e9a89cc64'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-14-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      jobStatus resolution scans up to ~4000 job hashes on every messages poll; an O(1) lookup would need a messageId-derived jobId at enqueue.
    evidence: |-
      BullMQ getJobs applies the range per state (queued group has 5 states x 500) and loads each job hash; simulate-message enqueues without jobId, and changing that write path is outside this read-only story.
    location: >-
      apps/api/src/dev/dev-simulate.controller.ts resolveJobStatuses
    severity: medium
  - summary: >-
      A completed job older than the newest 500 completed jobs (retention keeps 1000) resolves jobStatus null.
    evidence: |-
      DEV_JOB_SCAN_LIMIT = 500 vs removeOnComplete count 1000; 14.2 polls within 60 s of enqueue, so this only bites on a long-lived shared stack.
    location: >-
      apps/api/src/dev/dev-simulate.controller.ts DEV_JOB_SCAN_LIMIT
    severity: low
  - summary: >-
      Messages rows are read before the queue scan, so a reply persisted between the two reads can show the inbound as completed with no outbound yet.
    evidence: |-
      getMessages reads Postgres, then scans the queue; the 400-before-queue rule keeps that order. The 14.2 executor should re-poll once after observing completed before recording reply null.
    location: >-
      apps/api/src/dev/dev-simulate.controller.ts getMessages
    severity: medium
  - summary: >-
      GET dev/user/:userId/survey-state is not tenant-scoped and counts non-superseded evidence across all of the user's windows.
    evidence: |-
      Pre-existing route (count already returned before 14.1); a fresh L2 persona has one window, so surveyEvidenceCount matches L1 there.
    location: >-
      apps/api/src/dev/dev-simulate.controller.ts getSurveyState
    severity: low
---

<intent-contract>

## Intent

**Problem:** The L2 executor (14.2) must observe reply job state, question-confirmation progress and survey evidence through the development API, but `GET /dev/conversation/:id/messages` has no job status and silently returns the full history for an unknown `after`, and there is no development read for question-confirmation state.

**Approach:** Additive, read-only changes in `apps/api/src/dev/dev-simulate.controller.ts` only: message rows gain `jobStatus` (from a bounded, read-only scan of the conversation queue), an unknown `after` returns `400`, and a new tenant-scoped `GET /dev/user/:userId/question-confirmation?tenantId=&group=` reads the V2 question-confirmation tables. `survey-state` already returns `count` and message rows already carry `metadata`; both are locked by tests, not re-implemented.

**User decisions (2026-10-25, recorded as intent):** QA suite `p-v1` (12.4) is out of scope and empty; smoke scenarios come later in `smoke-v1`, after the framework. This story touches only the dev API surface; it adds no suite cases.

**Planning decisions:** (1) The question-confirmation repository lives in `apps/worker` and the API cannot import it, so the controller reads the same tables (`survey_question_working_insights`, `survey_question_confirmation_bundles`, `survey_question_verdict_receipts`, `survey_windows`, `survey_questions`) with direct Drizzle selects, mirroring the repository's read semantics (V2 groups, open-ended questions, missing working row = `no_data`), as the controller already does for memory and survey state. It skips the worker's v2-mode/policy checks: a dev read reports raw state and never throws on policy. (2) `tenantId` is a required UUID query parameter (the same validation as `force-checkin`); `userId` is the internal user UUID returned by `find-conversation`. (3) `group` is optional (absent = whole window, matching `StateQueryArgs.group: null`); a value outside `autonomy|growth|purpose|belonging` is `400`. (4) `stagedBundleCount` counts every bundle of the active window in any status, ignoring `group`, matching the L1 fake's `stagedBundleCount()`. (5) A job that cannot be found within the scan bound yields `jobStatus: null` (same as outbound); a queue read error propagates (infrastructure).

## Boundaries & Constraints

**Always:**
- Message row shape: existing fields unchanged plus `jobStatus: 'queued' | 'processing' | 'completed' | 'failed' | null`. Mapping of BullMQ states: `active` → `processing`; `waiting`, `delayed`, `prioritized`, `paused`, `waiting-children` → `queued`; `completed` → `completed`; `failed` → `failed`. A job matches when `job.data.messageId === row.id` and `job.data.conversationId === :conversationId`. Outbound rows are always `null`.
- Queue access is only `queue.getJobs(types, 0, DEV_JOB_SCAN_LIMIT - 1, false)` (newest first, `DEV_JOB_SCAN_LIMIT = 500` per state group, four calls at most), made once per request and only when the returned rows contain an inbound message. When the same message matches several jobs, precedence is `processing` > `queued` > `failed` > `completed`.
- `after` present (non-empty) and not a message of that conversation → `400` with message `after message not found in conversation`, before any queue call. Empty or absent `after` returns the full history as today.
- New route response (`DevQuestionConfirmationState`): `{ surveyWindowId: string | null, group: string | null, questions: Array<{ surveyQuestionId, stableKey, questionGroup, status }>, progress: { answered, total }, appliedVerdicts: Array<{ inboundMessageId, questionGroup, verdictKind, appliedAt }>, stagedBundleCount: number, pendingClarification: { surveyQuestionId, questionGroup, clarificationAttempts, promptSent: boolean } | null }`. `progress.answered` counts `status === 'confirmed'`, `total` counts `questions` (the shape of the suite's `QuestionProgressValueSchema`). No active window → `surveyWindowId: null`, empty lists, `progress {0,0}`, `stagedBundleCount 0`, `pendingClarification null`. Two active windows → `409`. Every select filters on `tenantId` and `userId`; `appliedVerdicts` and `questions` filter by `group` when given. No working summary, statement or displayed text is returned.
- Validation (`400` before any storage access): missing/non-UUID `tenantId`, non-UUID `userId`, unknown `group`.
- The development module is not mounted when `NODE_ENV=production` (existing `shouldMountDevModule`); a test proves no `dev/` route is mounted there. Existing `ApiKeyGuard` on the controller stays the auth.

**Never:**
- No write path, no queue mutation (`add`, `remove`, `clean`, `obliterate`, `retry`, `promote`, `drain`), no schema/migration change, no change to `apps/worker`, `packages/*`, `agent-service` or MAF paths, no new module providers or constructor parameters.
- No change to existing response fields of any route other than adding `jobStatus` and the `400` for unknown `after`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Messages happy path | inbound with an active job, outbound reply | inbound `jobStatus: 'processing'`, outbound `null`, `metadata` present | none |
| Each state | jobs in waiting/delayed/completed/failed | `queued`/`queued`/`completed`/`failed` | none |
| No job | inbound with no matching job | `jobStatus: null` | none |
| Known after | `after` = inbound id | only later rows, with `jobStatus` | none |
| Unknown after | `after` not in conversation | `400` | no queue call |
| No inbound | only outbound rows returned | rows with `null` | no queue call |
| QC no window | valid ids, no active window | empty state, `progress {0,0}` | none |
| QC happy | active window, 3 growth questions, one confirmed, 1 bundle, 1 receipt, a pending clarification | `progress {1,3}` for `group=growth`, counts and pending set | none |
| QC bad input | missing/non-UUID tenant, non-UUID user, `group=bogus` | `400` | db untouched |
| QC two windows | two active windows | `409` | none |
| Survey count | two evidence rows | `count: 2` | none |
| Production | `NODE_ENV=production` | no `dev/` routes mounted | none |

</intent-contract>

## Code Map

- `apps/api/src/dev/dev-simulate.controller.ts` -- target. `getMessages` (lines ~182-209: selects `metadata` already, unknown `after` falls back to all rows at line 205), `getSurveyState` (~253-272: already returns `{ count, evidence }`), `forceCheckIn` (`UUID_PATTERN` validation pattern to reuse), injected `this.queue` (`QUEUE_NAMES.CONVERSATION`, typed `Queue<ConversationJob | CheckInJob>`).
- `apps/api/src/queue/queue.types.ts` -- `ConversationJob.messageId`/`conversationId`; `CheckInJob` has no `messageId`.
- `apps/api/src/queue/queue.module.ts` -- `removeOnComplete: { count: 1000 }`, `removeOnFail: { count: 5000 }`, so completed jobs stay findable within the scan bound.
- `apps/api/src/dev/dev-endpoints.ts`, `apps/api/src/app.module.ts:15-28` -- production gating (read-only; reuse).
- `apps/api/src/dev/dev-simulate.controller.test.ts` -- existing unit tests construct the controller positionally with fakes (7 args); extend here.
- `apps/api/src/private-production-route-boundary.test.ts` -- production route test; its inline snapshot covers only `admin/` routes, so it needs no snapshot update; add a `dev/` assertion.
- `apps/worker/src/survey/repositories/question-insight.repository.ts` -- read-only reference: `findCycleProgress` (~1080), `findPendingQuestionClarification` (~100), `findAppliedQuestionVerdictForInbound` (~63), `V2_QUESTION_GROUPS`.
- `packages/database/src/schema/survey-insight-v2.ts` -- tables `surveyQuestionWorkingInsights`, `surveyQuestionConfirmationBundles`, `surveyQuestionVerdictReceipts` (exported from `@entalent/database`).
- `packages/conversation-sim/src/fakes/question-confirmation.ts` -- L1 semantics for `questionProgress(group)` and `stagedBundleCount()` the L2 values must match.
- Callers of `messages?after=`: `scripts/chat.ts` (passes ids it just received; `get` throws on non-OK), `scripts/live-maf-primary-app-smoke.ts` and `scripts/maf-smoke-runner.sh` (retired MAF; pass the inbound id just returned). None relies on the unknown-`after` fallback.

## Tasks & Acceptance

**Execution:**
- `apps/api/src/dev/dev-simulate.controller.ts` -- add `jobStatus` resolution helper with `DEV_JOB_SCAN_LIMIT`, `400` for unknown `after`, the `question-confirmation` GET with validation and tenant-scoped selects, exported response types -- the AC reads.
- `apps/api/src/dev/dev-simulate.controller.test.ts` -- unit tests for every I/O row except Production, using a fake queue exposing only `getJobs` (records arguments; asserts bound and that nothing else is called) and a chainable fake DB returning queued results per `select`.
- `apps/api/src/private-production-route-boundary.test.ts` -- assert no mounted route starts with `dev/` in production; add a non-production check that `DevSimulateController` declares `GET dev/user/:userId/question-confirmation` and `GET dev/conversation/:conversationId/messages`.
- `docs/agent-task-log.md` -- one row for this task.

**Acceptance Criteria:**
- Given the API test suite, when `pnpm --filter @entalent/api test` runs, then all tests pass including the new ones, and `pnpm --filter @entalent/api typecheck` passes.
- Given the diff, when inspected, then only the three source/test files above (plus docs/spec artifacts) changed, and the controller adds no `Post`/`Put`/`Delete`/`Patch` handler and no queue mutation call.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 36 findings — high 0, medium 7, low 16, false 13, maybe-false 0
- findings:
  - `[medium]` `[patch]` (blind) jobStatus groups scanned in precedence order with early exit; a job moving waiting->active between calls is missed and resolves null — patched: lifecycle-order scan of all four groups, latest observed state per job id, precedence applied across distinct jobs; race test added.
  - `[low]` `[patch]` (blind) DEV_JOB_SCAN_LIMIT is per BullMQ state, not per group (BullMQ 5.80.5 `getRanges` applies start/end per type; queued group can return 5 x 500) — still bounded; patched the doc comment.
  - `[medium]` `[defer]` (blind) every poll loads up to ~4000 job hashes; an O(1) lookup needs `jobId: messageId` on enqueue, which changes the simulate-message write path the intent forbids — deferred.
  - `[low]` `[defer]` (blind) completed jobs older than the newest 500 (retention 1000) resolve null — 14.2 polls within 60 s of enqueue so the newest-first scan finds them; raising the limit changes the contract constant — deferred note for 14.2.
  - `[low]` `[reject]` (blind) pendingClarification ignores `group` — matches the spec (only questions/appliedVerdicts filter) and the ungrouped L1 fake `pendingClarification()`.
  - `[medium]` `[patch]` (blind) untested branches: purged pending row, promptSent false — patched with tests (two-pending ordering and other-window receipt covered by the predicate-value assertions below).
  - `[medium]` `[patch]` (blind) new SQL never run against Postgres — grouped with the verification-gap finding; patched by asserting literal predicate values; a live DB run stays unverified (no DATABASE_URL) and is reported.
  - `[low]` `[defer]` (blind) survey-state count is not tenant-scoped and spans all windows — pre-existing route; noted in epic-14-context for 14.2 (fresh persona has one window).
  - `[low]` `[reject]` (blind) getMessages does not validate conversationId (500 on non-UUID) — pre-existing behavior; 14.2 passes ids returned by find-conversation; fix adds a guard.
  - `[low]` `[patch]` (blind) epic-14-context stale (metadata/count pre-existed, tenantId param missing) — patched epic-14-context.md.
  - `[false]` `[reject]` (blind) the patch omits the spec — by workflow design the spec is the claims file, passed separately.
  - `[false]` `[reject]` (blind) harness base 3af7d0e differs from baseline_revision — the base is mandated by the user for this epic run.
  - `[medium]` `[defer]` (blind) DB rows are read before the queue scan, so a reply persisted between the two reads can show inbound `completed` without its outbound — real but narrow; reordering conflicts with the 400-before-queue rule; 14.2 should re-poll once after seeing `completed` before recording reply null — deferred.
  - `[medium]` `[patch]` (edge) waiting->active move between scans resolves null — same root cause as the first row; patched.
  - `[low]` `[patch]` (edge) getRanges range per type — same as the bound row; comment patched.
  - `[low]` `[defer]` (edge) completed jobs beyond 500 resolve null — same as the retention row; deferred.
  - `[low]` `[reject]` (edge) non-UUID conversationId gives 500 — pre-existing; see above.
  - `[low]` `[reject]` (edge) repeated `?group=a&group=b` arrives as an array and returns the whole window — unlikely in practice, fix adds a guard.
  - `[low]` `[reject]` (edge) `group` not trimmed while tenantId is — unlikely, fix adds normalization branch; a padded group still fails loudly with 400.
  - `[low]` `[patch]` (edge) no periodEnd check vs worker findCycleProgress — by spec decision (raw state, L1 semantics); doc comment patched to name the skipped check.
  - `[low]` `[patch]` (edge) groups of any size counted vs worker's three-question rule — matches the L1 fake; doc comment patched.
  - `[low]` `[patch]` (edge) pendingClarification skips the worker's prompt/summary/periodEnd checks — by spec; doc comment patched.
  - `[low]` `[patch]` (edge) the second route-boundary test claims a non-production condition while NODE_ENV is still stubbed to production — renamed the test.
  - `[medium]` `[patch]` (verification-gap) fake DB ignores every predicate except tenant/user, so removing the active-window, open_ended, receipts-window or bundles-window filters stays green — patched: assertions on 'active', 'open_ended' and the window id in the recorded where params.
  - `[low]` `[patch]` (verification-gap other) "mirrors the worker repository" overstates parity (three-question rule) — doc comment patched.
  - `[false]` `[reject]` (verification-gap other) pendingClarification not grouped — duplicate of the blind row; by spec.
  - `[false]` `[reject]` (intent) repository vs tables — the worker repository cannot be imported by the API; spec planning decision (1); reading the same tables is the only additive read-only option.
  - `[false]` `[reject]` (intent) appliedVerdicts are receipts, not per question — per-question applied outcome is `questions[].status` (confirmed/declined/pending_clarification); receipts add the verdict list.
  - `[false]` `[reject]` (intent) required tenantId query param not in the AC URL — the AC requires tenant scoping and the route has no other tenant source.
  - `[false]` `[reject]` (intent) jobStatus not tenant-filtered — a job matches only on the conversation id of the requested conversation, which belongs to one tenant; the messages read itself is pre-existing.
  - `[false]` `[reject]` (intent) production absence proven on module graph, not HTTP — the module is not mounted, so no route can exist; the existing company-admin-session integration test already probes `/dev/conversation/...` for 404 when a DB is present.
  - `[false]` `[reject]` (intent) bounded scan null means outbound or not-found — explicit spec decision (5).
  - `[false]` `[reject]` (intent) metadata/count already existed — framing only; locked by tests.
  - `[false]` `[reject]` (intent) caller check is prose only — callers pass ids they just received; chat.ts throws visibly on non-OK.
  - `[false]` `[reject]` (intent) epic-14-context still names p-v1 — grouped with the epic-context patch: user decision recorded there; p-v1 names remain from the planning AC for 14.3.
  - `[false]` `[reject]` (intent) all behavior exercised via direct controller calls — the guard is covered by the existing metadata test; DB/Redis runs are reported as unverified, not a defect.

## Verification

**Commands:**
- `pnpm --filter @entalent/api exec vitest run src/dev src/private-production-route-boundary.test.ts` -- expected: pass.
- `pnpm --filter @entalent/api test` -- expected: pass (DB-backed suites skip without `DATABASE_URL`).
- `pnpm --filter @entalent/api typecheck` -- expected: pass.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: receipt written; report its path.

## Auto Run Result

Status: done

**Summary:** Additive, read-only dev reads in `apps/api/src/dev/dev-simulate.controller.ts`: message rows gain `jobStatus` (bounded, read-only `queue.getJobs` scan of the conversation queue, 500 newest per BullMQ state, lifecycle-order scan, precedence processing > queued > failed > completed across jobs, only when inbound rows are returned); an unknown `after` is `400` before any queue call; new tenant-scoped `GET dev/user/:userId/question-confirmation?tenantId=&group=` over the V2 confirmation tables (400 validation before storage, 409 on two active windows, no statement text). `metadata` on message rows and `count` on survey-state already existed and are now locked by tests.

**Files changed:**
- `apps/api/src/dev/dev-simulate.controller.ts` -- jobStatus resolution, after-400, question-confirmation route, exported response types.
- `apps/api/src/dev/dev-simulate.controller.test.ts` -- unit tests for every I/O row except Production (fake queue exposing only `getJobs`; chainable fake DB with predicate assertions).
- `apps/api/src/private-production-route-boundary.test.ts` -- no `dev/` route in production; new routes declared on the controller. The inline `admin/` snapshot was not changed (it does not cover `dev/`).
- `docs/agent-task-log.md` -- task row.
- `_bmad-output/implementation-artifacts/epic-14-context.md` -- compiled Epic 14 context, corrected after review (tenantId param, pre-existing fields, user decision on p-v1).

**Review:** 36 findings (high 0, medium 7, low 16, false 13). Patched: scan race (lifecycle order), bound comment, parity doc comment, predicate-value and promptSent/purged tests, test rename, epic-context corrections. Deferred (frontmatter): per-poll scan cost (jobId-at-enqueue option), completed beyond the 500 bound, DB-then-queue read race (14.2 re-poll), survey-state scoping. Rejected with reasons in the triage log: pending clarification ungrouped (by spec, L1 fake), non-UUID conversationId 500 (pre-existing), repeated/whitespace `group` (unlikely, adds guards), and the false intent-divergence items.

**Follow-up review recommended:** false -- no high patched; medium patched entries (scan race, predicate verification) are covered by new tests. Patched counts by entry verdict: medium 2 entries (scan race; predicate/branch verification), low 4 entries.

**Verification:** `pnpm --filter @entalent/api exec vitest run src/dev src/private-production-route-boundary.test.ts` 37 passed / 8 skipped; `pnpm --filter @entalent/api test` 358 passed / 27 skipped (DB-backed suites, no `DATABASE_URL`); `pnpm --filter @entalent/api typecheck` and `lint` clean; `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` passed, receipt `runs/harness/receipt-1792968859130-54b3f84c.json`.

**Residual risks:** the new SQL and the BullMQ scan were never run against a live Postgres/Redis (no local database); 14.2's first local-stack run is the first real exercise. Callers of `messages?after=` (`scripts/chat.ts`, retired MAF smoke scripts) pass ids they just received, so none relies on the old fallback.
