---
title: 'Story 12.5: ClockPort in the Application Layer'
type: 'refactor'
created: '2026-10-25'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The conversation and proactive paths read the wall clock directly (`new Date()`, `Date.now()`), so working-hours, gap and cadence behavior cannot be tested at a chosen instant, and the L0 executor (12.7) and cadence policy (12.6) have nothing to inject.

**Approach:** Add `ClockPort { now(): Date }` + `systemClock` (AD-5, authorized product change #1), inject it as the defaulted last parameter of the four use cases, make the quiet-hours utils take the instant explicitly, thread the same clock through the sim harness fakes, and lock it in with a scoped ESLint rule.

## Boundaries & Constraints

**Always:** Production behavior is unchanged: every former wall-clock read becomes exactly one `clock.now()` read at the same point (no collapsing into one per-turn instant). `clock: ClockPort = systemClock` is the last constructor parameter. Worker wiring passes `systemClock` explicitly. `new Date(value)` (argument-bearing) stays allowed. Active runtime remains TypeScript-only and disconnected from MAF.

**Decisions (approved 2026-10-25):**
- `PulseBacklogService` is out of scope (AD-5 authorizes only the listed use cases and utils); its engagement window and `coverageSnapshotAt` stay on the wall clock.
- The clock is also threaded into `InMemoryMemoryRepository`, `InMemoryGoalRepository` and `InMemoryScheduledActionRepository` in `fakes/repositories.ts`, defaulting to `systemClock`.
- The harness `traceId` keeps the turn number and gains a clock-derived suffix: `sim-turn-<n>-<clock.now().getTime()>`.

**Never:** No Vitest fake timers. No change to `proactive-scheduler.repository.ts` SQL or cadence (12.6). No edits to `agent-service`, `maf-*` files, migrations or `apps/api` source. No new dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default construction | Use case built without clock | Identical to today (system time) | N/A |
| Fixed clock, quiet hours | clock = 2026-01-05T23:30Z, tz UTC, default 22–8 | `isInQuietHours` true; scheduler skips; follow-up postpones by 8h30m | N/A |
| Fixed clock, follow-up not due | `dueAt` > clock.now() | `skip: not_due_yet` | N/A |
| Fixed clock, reminder in past | LLM `dueAt` <= clock.now() | due = clock.now() + 60s | invalid ISO -> null as today |
| Harness with clock | `new CoachHarness({ clock })` | inbound/outbound `occurredAt`, `sentAt`, `userTimezoneUpdatedAt`, memory/goal/scheduled-action timestamps equal clock readings; traceId `sim-turn-<n>-<epoch ms>` | N/A |
| Reintroduced `new Date()` | zero-arg `new Date()` or `Date.now()` in a scoped file | `pnpm lint` fails | N/A |

</frozen-after-approval>

## Code Map

Wall-clock reads to replace (all in `packages/application/src/`):
- `utils/quiet-hours.ts:10-16,19-30` -- `getLocalHour(timezone)` reads `new Date()`; becomes `getLocalHour(now, timezone)`, `isInQuietHours(now, timezone, quietHours)`. Exported at `index.ts:88`; callers only follow-up/scheduler + `quiet-hours.test.ts`.
- `use-cases/conversation-orchestrator.ts` -- ctor `:159-176` (last param `logger = SILENT_LOGGER`; clock goes after it); `:264` and `:1367` outbound `occurredAt`; `:336` tz-stale `Date.now()`; `:1333` `requestedAt`; module fns `parseReminderDueAt` `:2340-2346` (call `:881`), `computeRiskExpiry` `:2356` (call `:871`), `describeLocalTime` `:2369` (calls `:1120,1290,2016`) gain a `now: Date` param. Leave `:533` and `:2341` (`new Date(arg)`).
- `use-cases/proactive-check-in.use-case.ts` -- ctor `:56-63`; `:134` disclosure lookup instant, `:222` `occurredAt`, `:253` `recordProbeSent`.
- `use-cases/follow-up-execution.use-case.ts` -- ctor `:39-45`; `:57` due guard, `:91` quiet hours, `:111` inbound gap, `:165` `occurredAt`, `:191` postpone; module fns `msUntilEndOfQuietHours` `:211-220`, `getLocalMinute` `:222-226` take `now`.
- `use-cases/proactive-scheduler.use-case.ts` -- ctor `:41-48` (`config?` is 3rd; clock 4th); `:61` quiet hours, `:72` traceId `Date.now()`.

Construction sites:
- `apps/worker/src/conversation/conversation.module.ts:84-101,129-136`, `apps/worker/src/followup/followup.module.ts:36`, `apps/worker/src/proactive/proactive-scheduler.module.ts:34` -- pass `systemClock`.
- `apps/api` -- constructs none; no change.
- Tests (default, no change needed): `conversation-orchestrator.test.ts` (106), `proactive-check-in.use-case.test.ts` (18), `follow-up-execution.test.ts` (11), `proactive-scheduler.test.ts` (7), worker `*.integration.test.ts` (4), `conversation-sim/src/scenarios/proactivity-reminders.sim.test.ts:107,167`.

Harness/fakes (`packages/conversation-sim/src/`):
- `harness/coach-harness.ts:55-70` options, `:136` `userTimezoneUpdatedAt`, `:168-188` orchestrator ctor (pass `undefined` logger then clock), `:215` traceId `sim-turn-${turn}` becomes `sim-turn-${turn}-${clock.now().getTime()}`.
- `fakes/repositories.ts:29` `InMemoryConversationRepository` ctor, `:93-104` `saveMessage` stamps `occurredAt`/`createdAt`.
- `fakes/repositories.ts:133-144,171-190` memory repo (expiry compare + stamps), `:199-234` goal repo, `:239-311` scheduled-action repo -- ctor gains `clock = systemClock`; harness passes its clock.
- `fakes/inline-outbox.ts:31-38` ctor options, `:50` `sentAt`.

Lint: root `.eslintrc.cjs` (no per-package config; `packages/eslint-config` is unused by these packages) -- add an `overrides` entry.

Do not touch: `services/pulse-backlog.service.ts` (out of scope, stays wall clock), `maf-primary-*.ts`, `memory-extraction`, `follow-up-scheduler`, `profile-hydration`, `style-adaptation`, `topic-question-policy` (already takes `now`).

## Tasks & Acceptance

**Execution:**
- [ ] `packages/application/src/ports/clock.port.ts` -- add `ClockPort`, `systemClock = { now: () => new Date() }`; export both from `index.ts`.
- [ ] `packages/application/src/utils/quiet-hours.ts` + `quiet-hours.test.ts` -- explicit `now` first param; tests use fixed instants (cover cross-midnight and same-day windows).
- [ ] The four use-case files -- add `private readonly clock: ClockPort = systemClock` last; replace each read listed in Code Map 1:1; pass `now` to module helpers.
- [ ] The four use-case test files -- add fixed-clock tests for each matrix row (quiet hours, not-due, past reminder, scheduler traceId, outbound `occurredAt` equals clock).
- [ ] Three worker modules -- pass `systemClock` explicitly; extend `conversation.module.test.ts` to assert it and keep the "no agent runtime router" test green.
- [ ] `conversation-sim` harness/fakes -- `clock?: ClockPort` option (default `systemClock`) threaded into all in-memory repos, outbox and orchestrator; traceId gets the clock suffix; add a harness test with a fixed clock.
- [ ] `.eslintrc.cjs` -- `overrides` for the five application files: `no-restricted-syntax` with `NewExpression[callee.name='Date'][arguments.length=0]` and `CallExpression[callee.object.name='Date'][callee.property.name='now']`.

**Acceptance Criteria:**
- Given the five scoped files, when grepped for zero-arg `new Date()` / `Date.now()`, then none remain and `pnpm lint` passes.
- Given a temporary `Date.now()` added to a scoped file, when `pnpm lint` runs, then it fails (revert afterwards).
- Given existing suites, when run unchanged, then they pass with no snapshot or expectation edits beyond signature updates in `quiet-hours.test.ts`.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm install --offline --frozen-lockfile && pnpm --filter './packages/*' build` -- fresh worktree prerequisite.
- `pnpm --filter @entalent/application typecheck && pnpm --filter @entalent/application test` -- green.
- `pnpm --filter @entalent/application build && pnpm --filter @entalent/worker typecheck && pnpm --filter @entalent/worker test` -- green, incl. `conversation.module.test.ts` MAF-disconnection check.
- `pnpm --filter @entalent/api typecheck && pnpm --filter @entalent/api test` -- green (consumer unaffected).
- `pnpm --filter @entalent/conversation-sim test` -- green.
- `pnpm lint` -- green; negative check above fails as expected.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- report receipt path.
