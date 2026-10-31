---
title: 'RPT-09: Employee reporting-rights intake through a verified Slack DM protocol'
type: 'feature'
created: '2026-10-31'
status: 'done'
review_loop_iteration: 0
baseline_commit: 237d7075ff08f262ccf3cbe2bf7c36cb390d204e
context:
  - '{project-root}/_bmad-output/planning-artifacts/pulse-check-reports/PRODUCTION-BLOCKERS-PLAN.md'
  - '{project-root}/_bmad-output/planning-artifacts/pulse-check-reports/RPT-02-DESIGN.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Full/partial reporting withdrawal (PR-017, FR-006/007) is implemented in application and worker but has no caller, so an employee cannot exercise it. Readiness gate G03 keeps the pilot blocked.

**Approach:** Add an explicit, button-committed Slack DM protocol. The conversation model may only propose opening a rights menu; the employee commits through signed buttons and a confirm step. API admits each verified click durably in PostgreSQL, the worker applies the existing `WithdrawReportingPermissionUseCase` with `verified_subject` provenance and confirms in the personal language.

## Boundaries & Constraints

**Always:** Derive tenant and subject only from the signed workspace/user and the existing linked-person lookup, never from payload values. Bind menu options to a server-stored menu token owned by that subject; re-verify lineage ownership in the existing repository. Persist admission before acknowledging Slack; Redis only transports it, and a DB repair sweep re-enqueues unapplied admissions. Use the DB clock for `receivedAt`. Partial targets list only the subject's lineages in open or not-yet-final cycles, titled from question definitions in the personal language. Withdrawal stays one-way. Keep onboarding stop, bundle verdicts, `surveyEnabled` and admin capability separate from reporting rights. Receipts and logs hold IDs and statuses only.

**Ask First:** Slack app manifest changes (slash command, App Home), an internal admin/support rights-request route, re-grant of permission, historical-cycle withdrawal, live Slack or model calls, production migration, commits/push/PR.

**Never:** Lexical or regex intent detection; withdrawal without an explicit confirm click; trusting lineage IDs, tenant or user from Slack values; reading private conversation text in the rights path; editing delivered snapshots; touching retired MAF or applied migrations 0000–0098.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Model proposes menu | Employee asks not to share answers; reply plan `reportingRightsRequest='open_menu'` | Reply carries `Withdraw all` / `Choose topics` buttons; nothing withdrawn | Invalid field value ignored, reply unchanged |
| Full withdrawal | `Withdraw all` then `Confirm` in own DM | One admission, one use-case call, permission revision recorded, confirmation DM | Duplicate click replays the same `requestId` |
| Partial | `Choose topics`, select 1 of 3, `Confirm` | Only that lineage excluded; denominator unchanged | Foreign or stale lineage rejected, content-free notice |
| Forged or foreign | Unsigned body, non-DM channel, unknown workspace, unlinked user, other subject's token, expired token | No admission, no worker job | Dropped with typed debug reason |
| Lost queue | Admission committed, Redis job lost | Repair sweep re-enqueues; applied once | Idempotency conflict surfaces typed failure, no partial state |
| Nothing to withdraw | No open lineages | Menu offers full withdrawal only | N/A |

</frozen-after-approval>

## Code Map

- `packages/application/src/use-cases/withdraw-reporting-permission.use-case.ts`, `ports/reporting-permission.repository.port.ts` -- existing command and provenance contract; reuse unchanged.
- `apps/worker/src/survey/repositories/reporting-permission.repository.ts` -- transactional application of exclusions; reuse.
- `apps/api/src/channel/slack-interaction.ts`, `slack-ingest.service.ts` -- signed `block_actions`, DM and linked-person checks; today only `onboarding:*`.
- `packages/channel-slack/src/slack.normalizer.ts` -- interaction normalization (action id, value, ts).
- `packages/contracts/src/ai.ts`, `packages/application/src/utils/reply-plan.ts`, `packages/ai-openai/src/prompts/classify.ts` -- model reply plan where the typed field belongs (ADR-013 D2).
- `apps/worker/src/message-send/message-send.processor.ts` -- outbound metadata actions (buttons).
- `packages/database/src/schema/survey-report-scopes.ts` -- existing withdrawal request/permission tables.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/reporting-rights.ts`, `queue.ts`, `index.ts` -- action namespace `reporting_rights:*`, menu/admission/job schemas, new queue name.
- [x] `packages/database/src/schema/survey-reporting-rights.ts`, generated migration 0099 -- `survey_reporting_rights_menus` (subject, lineage set, expiry) and `survey_reporting_rights_admissions` (unique Slack action identity, DB-clock `received_at`, status, `request_id`).
- [x] `packages/application/src/use-cases/reporting-rights-intake.use-case.ts` + ports -- open menu, stage selection, admit confirm, apply via existing use case; typed outcomes.
- [x] `apps/api/src/channel/reporting-rights-interaction.ts`, wire in `slack-ingest.service.ts` -- verify, admit, enqueue.
- [x] `apps/worker/src/survey/reporting-rights.processor.ts`, repository, `survey.module.ts` -- apply admission, repair sweep, render menu and confirmation through message-send.
- [x] `packages/contracts/src/ai.ts`, `packages/ai-openai/src/prompts/classify.ts`, `packages/application/src/utils/reply-plan.ts`, `use-cases/conversation-orchestrator.ts` -- typed `reportingRightsRequest`, schema validation, button attachment on the reply; no text matching.
- [x] Tests for every matrix row plus a real-ingress integration through signed body to DB state.

**Acceptance Criteria:**
- Given a signed confirm click, when processed twice concurrently, then exactly one withdrawal request row and one revision exist, and the second returns `replayed=true`.
- Given a full withdrawal before an unpublished intermediate with roster 10, when the lifecycle forms it, then denominator 8 and threshold 7 apply and delivered snapshots stay byte-identical.
- Given an employee mentions withdrawal but never clicks Confirm, then no permission state changes.

## Design Notes

Recommended over a slash command or App Home: it needs no manifest change, keeps the conversation as the discoverable entry point and keeps the commit deterministic. Durable admission in API is required because Slack needs an acknowledgment within 3 seconds and Redis is not authoritative. `verificationId` is the admission ID; `requestId` derives from the admission so retries replay.

## Verification

**Commands:**
- `pnpm --filter './packages/*' build` then `pnpm --filter @entalent/application test` and `pnpm --filter @entalent/api test` -- pass.
- `pnpm db:generate` against an owned local database, review 0099 SQL; `pnpm test:integration` on new owned PostgreSQL/Redis after `pnpm harness:preflight` -- pass, zero skips in new suites.
- `pnpm typecheck`, `pnpm lint`, `pnpm harness:check -- --base 237d7075ff08f262ccf3cbe2bf7c36cb390d204e` -- exit 0 with receipt.
- `SIM_GATE_RUNS=1 pnpm sim:gate` -- not run until model egress is authorized; record as `not_run`.

**Manual checks:**
- Native Slack rendering of the rights menu is part of EXT-B (G07), not this package.

## Implementation and verification evidence — 2026-10-31

Implemented locally after `[A]` approval; frozen intent unchanged. Step04 Blind Hunter and Edge Case Hunter findings were triaged in `runs/rpt-09/step04-triage.json`: ten patches (P1–P10) applied with counterexample tests, three items deferred to `deferred-work.md`, seven rejected after source checks. Exact review delta: `runs/rpt-09/implementation-review-delta.patch` / `.json`.

- Official pinned-base harness (default PostgreSQL-only profile) passed: `runs/harness/receipt-1793444994105-955e4503.json`; diff-check, typecheck, lint, test passed; model evals not run. Attempt1 `runs/harness/receipt-1793444631737-f0b19715.json` failed only because the coordinator supplied an unmigrated database; retained.
- The default profile has no `REDIS_URL`, so the new 6-test integration suite skips there; it passed 6/6 with zero skips on the final source against owned PostgreSQL 55460 / Redis 56460 (`entalent_rpt09_final`).
- `pulse-report-delivery.integration.test.ts` passed 39/39 inside the official gate; earlier failures under host load average 68–118 also reproduced on a database without 0099 (`runs/rpt-09/delivery-flake-discrimination.json`).
- Preservation: no unexpected changes against `runs/rpt-09/start-snapshot.json`; migrations 0000–0098 and the two legacy RPT-07 fixtures unchanged; journal append-only (0099).
- Not run: live model/sim gate, native Slack client rendering (EXT-B / G07), production. G03 moves to locally implemented; it still needs native Slack-client and deployed-binding evidence before it counts as passed.

## Suggested Review Order

**Trust boundary: signed click to durable admission**

- Entry point: tenant and subject come only from signed workspace/user and linked person.
  [`reporting-rights-interaction.ts:44`](../../apps/api/src/channel/reporting-rights-interaction.ts#L44)

- Menu row lock serializes Confirm against Cancel and duplicate clicks; one admission per menu.
  [`reporting-rights-interaction.ts:129`](../../apps/api/src/channel/reporting-rights-interaction.ts#L129)

- Rights clicks are admitted before Socket Mode ack; other events keep the old order.
  [`slack-socket-mode.service.ts:33`](../../apps/api/src/channel/slack-socket-mode.service.ts#L33)

- HTTP path: failed admission returns 503 so Slack shows an error.
  [`slack-events.controller.ts:51`](../../apps/api/src/channel/slack-events.controller.ts#L51)

**Application of the withdrawal**

- Intake use case: click routing, staging, admission and bounded post-commit enqueue.
  [`reporting-rights-intake.use-case.ts:115`](../../packages/application/src/use-cases/reporting-rights-intake.use-case.ts#L115)

- Existing withdraw command runs with verified_subject provenance derived from the admission.
  [`reporting-rights-intake.use-case.ts:208`](../../packages/application/src/use-cases/reporting-rights-intake.use-case.ts#L208)

- Repair sweep re-enqueues unapplied admissions and unsent notices; attempts are bounded.
  [`reporting-rights.processor.ts:55`](../../apps/worker/src/survey/reporting-rights.processor.ts#L55)

- Open-cycle filter: exclusions and native final completions decide which topics are offered.
  [`reporting-rights.repository.ts:42`](../../apps/worker/src/survey/repositories/reporting-rights.repository.ts#L42)

- Settlement writes status and the localized confirmation or failure notice atomically.
  [`reporting-rights.repository.ts:99`](../../apps/worker/src/survey/repositories/reporting-rights.repository.ts#L99)

**Model proposes, never commits**

- Menu opens before generation, outside the turn transaction, only on eligible Slack DM turns.
  [`conversation-orchestrator.ts:974`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L974)

- Reply plan advertises buttons only from what the adapter actually attached.
  [`reply-plan.ts:98`](../../packages/application/src/utils/reply-plan.ts#L98)

- Idempotent root menu per turn, locale stored on the menu, full-denial status path.
  [`reporting-rights.repository.ts:53`](../../apps/worker/src/survey/repositories/reporting-rights.repository.ts#L53)

- Classifier field, fail-closed to none.
  [`classify.ts:121`](../../packages/ai-openai/src/prompts/classify.ts#L121)

- Response contract mentions buttons only when the menu is attached.
  [`respond.ts:479`](../../packages/ai-openai/src/prompts/respond.ts#L479)

**Schema and contracts**

- Menus and admissions; request id derived from admission id by CHECK.
  [`0099_reporting-rights-intake.sql:1`](../../packages/database/migrations/0099_reporting-rights-intake.sql#L1)

- Drizzle schema mirror of migration 0099.
  [`survey-reporting-rights.ts:32`](../../packages/database/src/schema/survey-reporting-rights.ts#L32)

- Action namespace, button values, job schemas and copy keys.
  [`reporting-rights.ts:4`](../../packages/contracts/src/reporting-rights.ts#L4)

- Outbound rights buttons with Slack label limit.
  [`message-send.processor.ts:203`](../../apps/worker/src/message-send/message-send.processor.ts#L203)

**Tests**

- Real signed ingress to DB state: duplicates, forgery, partial/full, repair, poison, stale.
  [`reporting-rights-intake.integration.test.ts:21`](../../packages/database/src/__tests__/reporting-rights-intake.integration.test.ts#L21)
