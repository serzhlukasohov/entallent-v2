---
title: 'Story 12.5: ClockPort in the Application Layer'
type: 'refactor'
created: '2026-10-25'
status: 'done'
baseline_commit: '29d39ae061416a9d2bf1f301787e3bdc9837b94a'
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
- [x] `packages/application/src/ports/clock.port.ts` -- add `ClockPort`, `systemClock = { now: () => new Date() }`; export both from `index.ts`.
- [x] `packages/application/src/utils/quiet-hours.ts` + `quiet-hours.test.ts` -- explicit `now` first param; tests use fixed instants (cover cross-midnight and same-day windows).
- [x] The four use-case files -- add `private readonly clock: ClockPort = systemClock` last; replace each read listed in Code Map 1:1; pass `now` to module helpers.
- [x] The four use-case test files -- add fixed-clock tests for each matrix row (quiet hours, not-due, past reminder, scheduler traceId, outbound `occurredAt` equals clock).
- [x] Three worker modules -- pass `systemClock` explicitly; extend `conversation.module.test.ts` to assert it and keep the "no agent runtime router" test green.
- [x] `conversation-sim` harness/fakes -- `clock?: ClockPort` option (default `systemClock`) threaded into all in-memory repos, outbox and orchestrator; traceId gets the clock suffix; add a harness test with a fixed clock.
- [x] `.eslintrc.cjs` -- `overrides` for the five application files: `no-restricted-syntax` with `NewExpression[callee.name='Date'][arguments.length=0]` and `CallExpression[callee.object.name='Date'][callee.property.name='now']`.

**Acceptance Criteria:**
- Given the five scoped files, when grepped for zero-arg `new Date()` / `Date.now()`, then none remain and `pnpm lint` passes.
- Given a temporary `Date.now()` added to a scoped file, when `pnpm lint` runs, then it fails (revert afterwards).
- Given existing suites, when run unchanged, then they pass with no snapshot or expectation edits beyond signature updates in `quiet-hours.test.ts`.

## Implementation Notes

- Former reads that happened twice inside one helper now take one `now` from the call site: `parseReminderDueAt` (compare + nudge) and `msUntilEndOfQuietHours` (hour + minute, previously two `new Date()` reads). `describeLocalTime` receives `clock.now()` even when the timezone is null; the value is unused there. No behavioral difference beyond sub-millisecond drift.
- `computeRiskExpiry` copies `now` before mutating it with `setDate`.
- Existing use-case tests that use Vitest fake timers were left unchanged (default `systemClock` reads the faked `Date`); new fixed-clock tests are separate `describe` blocks without fake timers. `quiet-hours.test.ts` dropped fake timers and passes instants explicitly.
- `InlineOutbox` takes the clock through its existing options object (`clock?: ClockPort`) rather than a new positional parameter.
- Harness does not construct a scheduled-action repository (it is an injected option); the fake accepts the clock and the harness test passes the same clock to it.
- Lint negative check: appending `Date.now() + new Date().getTime()` to `proactive-scheduler.use-case.ts` produced two `no-restricted-syntax` errors; reverted.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | blind, edge | Follow-up quiet-hours path reads the clock twice (`isInQuietHours`, then `msUntilEndOfQuietHours`); an hour-boundary straddle postpones ~24h | low | reject | Real but pre-existing (original code made three wall-clock reads there); the frozen intent forbids collapsing reads, so it stays 1:1. |
| 2 | blind | No single per-turn/per-scan instant in orchestrator and scheduler | false | reject | Frozen Always rule explicitly says "no collapsing into one per-turn instant". |
| 3 | blind | `MemoryExtractionUseCase` expiry stays on wall clock while the memory fake filters by the injected clock | medium | defer | Confirmed (`computeExpiry` zero-arg `new Date()`); unchanged under systemClock, matters for multi-day 12.7 journeys. Logged in deferred-work. |
| 4 | blind | Harness `traceId` no longer deterministic under systemClock | false | reject | Approved decision 2026-10-25 (`sim-turn-<n>-<epoch ms>`); fix would edit the spec. |
| 5 | blind | No reusable fixed/manual test clock | low | reject | No named harm today; adds public surface; 12.7 can add one when it needs advancing time. |
| 6 | blind | ESLint rule misses `Date()` without `new` | low | patch | Direct correction: added `CallExpression[callee.name='Date']`; negative check fails as expected. Aliasing/glob widening rejected as unlikely. |
| 7 | blind, verif-gap | tzStale and risk `expiresAt` clock paths unpinned by tests | medium | patch | Pre-verified gap; added boundary tzStale test (dispatch `profile_hydration`) and risk expiry = clock + 30d with no mutation. |
| 8 | blind, edge | Worker wiring test casts `providers.find` without asserting it exists | low | patch | Added `expect(provider).toBeDefined()`; followup/scheduler module asserts rejected (dropping the arg is behavior-identical). |
| 9 | blind | Positional `undefined` constructor args are brittle | false | reject | Frozen Always rule mandates `clock` as the last constructor parameter. |
| 10 | blind | Tracking artifacts disagree (spec in-review vs sprint in-progress, `last_updated` earlier, harness base, receipt path) | low | patch (partial) | Status syncs at step 5; base 3af7d0e is the task-specified merge base; `last_updated` reflects real system time; task-log row now carries the receipt path. |
| 11 | blind | `isInQuietHours`/`getLocalHour` public signature changed without note | false | reject | Only in-repo callers, all updated; typecheck across api/worker/sim is green. |
| 12 | blind, edge | Harness accepts a scheduled-action repo built without its clock | low | patch | Added JSDoc on the option; building a default repo would change sim behavior. |
| 13 | edge | Invalid IANA timezone throws in scheduler loop | low | reject | Pre-existing (old `getLocalHour` threw identically); fix adds guards. |
| 14 | edge | Invalid Date from an injected clock gives opaque RangeError | low | reject | Unreachable with systemClock; fix adds guards. |
| 15 | edge | Fake `findMessagesThrough` drops prior turns when a frozen clock makes `occurredAt` tie | medium | patch | Confirmed: production repo keeps ties via order key; fake now keeps equal-timestamp messages stored at or before the anchor; two-turn frozen-clock test added. |
| 16 | edge | Pulse-capture receipt resolves `unresolved` when frozen clock makes `sentAt == occurredAt` | false | reject | Orchestrator logic is correct for equal instants; a frozen clock is unrealistic input — 12.7 should advance the clock between turns. |
| 17 | edge | Helpers collapse two former reads (`parseReminderDueAt`, `msUntilEndOfQuietHours`) contrary to 1:1 | low | reject | Same synchronous expression, sub-ms; removes a latent hour-boundary race; recorded in Implementation Notes. |
| 18 | verif-gap | Fake memory expiry filter and scheduled-action lifecycle stamps untested | medium | patch | Pre-verified gap; added expiry boundary and markSent/postpone/cancel stamp tests. |

## Verification

**Commands:**
- `pnpm install --offline --frozen-lockfile && pnpm --filter './packages/*' build` -- fresh worktree prerequisite.
- `pnpm --filter @entalent/application typecheck && pnpm --filter @entalent/application test` -- green.
- `pnpm --filter @entalent/application build && pnpm --filter @entalent/worker typecheck && pnpm --filter @entalent/worker test` -- green, incl. `conversation.module.test.ts` MAF-disconnection check.
- `pnpm --filter @entalent/api typecheck && pnpm --filter @entalent/api test` -- green (consumer unaffected).
- `pnpm --filter @entalent/conversation-sim test` -- green.
- `pnpm lint` -- green; negative check above fails as expected.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- report receipt path.
