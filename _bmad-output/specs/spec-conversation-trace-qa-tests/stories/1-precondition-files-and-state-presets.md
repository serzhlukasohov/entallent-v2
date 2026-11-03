---
title: 'Precondition files and state presets'
type: 'feature'
created: '2026-10-31'
status: 'done'
baseline_commit: '55a8fb9514d9a098bd01ab30703a2acdd4e43d9f' # snapshot of the dirty working tree (dangling commit, parent 04a72313fa7e9c9a299fb6e9891efa1eeb3b3fd4); diff with a temp index that includes untracked files
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-conversation-trace-qa-tests/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-conversation-trace-qa-tests/precondition-format.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every sim scenario builds its own starting state in code (history helpers, inline port stubs for pulse and onboarding), so state cannot be shared, reviewed, or produced by anyone but a developer, and the report cannot say where it came from.

**Approach:** A versioned JSON precondition file plus named presets describe the full state before a test; one loader validates it and builds a ready `CoachHarness` from it, and the scenario context carries the precondition so the report's Given block shows it (SPEC CAP-1, CAP-4).

## Boundaries & Constraints

**Always:**
- Precondition files are JSON with `schemaVersion: 1`, validated with zod; an unknown version or invalid field fails with the file name and field path.
- Coverage follows `precondition-format.md`: user (name, timezone), start time, history, memory, goals, style profile, onboarding state, pulse cycle (per-topic question statuses, collected evidence, next probe question), pending scheduled actions, presets, origin.
- Presets apply first, then explicit fields override them.
- Presets v1: `onboarding-done`, `cycle-open` (parameters: topics total, topics closed), `elapsed` (time since the last history message).
- The start time is applied in the test process only (fake `Date`, still advancing); production code gets no clock parameter.
- Existing scenarios and `CoachHarness` options keep working unchanged.
- Framework tests run with `ScriptedAiProvider`; no live LLM calls.

**Never:**
- No product-code changes outside `packages/conversation-sim` (no orchestrator, port or contract edits).
- No QA test-file runner, expected-result checks, recording or approval (stories 2–3).
- No ready confirmation bundles or pending clarifications in the precondition in this story; cycle state covers question statuses, evidence and the next probe only.
- No migration of existing scenarios beyond the one example below.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full file | precondition with every area set | harness repos hold the history, memory, goals, scheduled actions; onboarding and cycle ports answer from the file | N/A |
| Presets only | `presets: [onboarding-done, {cycle-open, total 3, closed 1}]` | onboarding completed; `findCycleProgress` yields 3 topics, 1 closed | N/A |
| Override | preset `cycle-open` plus explicit cycle topics | explicit topics win | N/A |
| Elapsed | history plus `elapsed: 90 minutes` | last history message is 90 minutes before start time; earlier ones keep their spacing | N/A |
| Bad version | `schemaVersion: 2` | load fails | error names file and `schemaVersion` |
| Bad field | goal status `paused` | load fails | error names file and field path |
| Unknown preset | `presets: [vacation]` | load fails | error lists known presets |

</frozen-after-approval>

## Code Map

- `packages/conversation-sim/src/harness/coach-harness.ts` -- options :57-76, fixed ids :53-55, memory seeding :193-204, `context()` :296-320, `ScenarioContext` :95-99; add optional seeds without changing existing behavior.
- `packages/conversation-sim/src/fakes/repositories.ts` -- reuse `InMemoryConversationRepository` (:25), `InMemoryGoalRepository` (:199, `.save` forces `active`, push into `.goals` for other statuses), `InMemoryScheduledActionRepository` (:239), `InMemoryStyleProfileRepository` (:317).
- `packages/conversation-sim/src/fakes/onboarding-turn.ts` -- `InMemoryOnboardingTurn(state)`; base `initialOnboardingState` from `packages/application/src/onboarding/onboarding-state.ts:14`.
- `packages/application/src/ports/question-confirmation.port.ts:75` -- `CycleProgressSnapshot` shape; `packages/application/src/utils/cycle-progress.ts:30-31` -- closed = `confirmed|declined`, awaiting = `pending_confirmation|pending_clarification`.
- `packages/application/src/services/pulse-backlog.service.ts:63` -- `getNextProbeQuestion` result shape; full `SurveyQuestionRecord` example `AUTONOMY_QUESTION` in `src/scenarios/topic-steering.sim.test.ts`.
- `packages/conversation-sim/src/scenarios/topic-steering.sim.test.ts` (:26, :44, :102), `answer-then-bundle.sim.test.ts`, `pulse-capture-exact-message.sim.test.ts` -- current inline stubs to model the cycle fake on; history seeding marks outbound messages delivered via `updateMessageDelivery`.
- `packages/conversation-sim/src/harness/report.ts:46,221,361-367` -- context written to `runs/*.json` and the Markdown setup block.
- `packages/conversation-sim/report/from-sim-run.mjs` `given(s)` (~:383-420) -- reads setup strings, memory, messages and turn-1 inputs; teach it to prefer `context.precondition`.
- `packages/contracts` -- already depends on `zod ^3.23.8`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/conversation-sim/package.json` -- add `zod` at the version contracts uses, and add `src/preconditions` to the `test` script (it lists folders explicitly) -- schema validation; new tests actually run.
- [x] `packages/conversation-sim/src/preconditions/schema.ts` -- zod schema and types for precondition v1 -- one validated format.
- [x] `packages/conversation-sim/src/preconditions/presets.ts` -- the three presets as functions producing partial preconditions -- states hard to reach by chatting.
- [x] `packages/conversation-sim/src/fakes/pulse-cycle.ts` -- one in-memory cycle state backing `QuestionConfirmationPort.findCycleProgress` (other methods inert), the harness survey stub's pulse-capture evidence, and `getNextProbeQuestion` -- replaces per-scenario inline stubs.
- [x] `packages/conversation-sim/src/preconditions/load.ts` -- `loadPrecondition(path)` and `harnessFromPrecondition(precondition, overrides)`: validate, apply presets then fields, seed repos and history, wire onboarding and cycle fakes, set start time, attach `context.precondition` -- single entry point.
- [x] `packages/conversation-sim/src/harness/coach-harness.ts` -- optional `precondition` summary in `ScenarioContext` -- report sees the source.
- [x] `packages/conversation-sim/report/from-sim-run.mjs` -- Given block reads `context.precondition` (name, origin, presets, goals, onboarding, cycle, evidence, scheduled actions) when present -- shows the real starting state.
- [x] `packages/conversation-sim/preconditions/examples/cycle-open-with-history.json` and `src/preconditions/load.test.ts` -- example file and unit tests covering every matrix row with `ScriptedAiProvider` -- proof without LLM.
- [x] `packages/conversation-sim/report/README.md` -- short "Preconditions" section -- how to write one.

**Acceptance Criteria:**
- Given the example precondition, when a scripted test sends one message, then the orchestrator's response inputs show the file's memory, goals and cycle progress, and `runs/*.json` carries `context.precondition`.
- Given a run built from a precondition, when the suite report is generated, then the test's Given block lists the precondition name, presets and each state area from the file.
- Given existing scenarios, when `pnpm --filter @entalent/conversation-sim test` runs, then they pass unchanged.

## Implementation Notes

- Implemented by a fresh subagent from this spec; added `src/harness/clock.ts` (shifted `Date`, real `runAt`), `SIM_SCOPE`, `PreconditionSummary`, `vitest.config.ts` include for `src/preconditions`.
- The implementation subagent ran `pnpm harness:check`, which executed two untracked live scenarios with real LLM calls; logged as an open tooling defect in docs/agent-failures.md.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | edge, blind | History offsets can go out of order or after startTime with no error | medium | patch | `seedHistory` mixes explicit and positional offsets and shifts by `elapsedMinutes - offsets[last]` with no monotonic check |
| 2 | blind | `elapsed` overrides explicit `minutesBeforeStart` | low | reject | Documented in README ("moves the whole history"); matches matrix row "earlier ones keep their spacing" |
| 3 | edge, blind | Fake returns pulse evidence when `open: false` | low | patch | `findPulseCaptureForConversation` filters only by message id; `snapshot()`/backlog return null when closed |
| 4 | edge, blind | Fake ignores `beforeOccurredAt` and scope | false | reject | Orchestrator passes it (conversation-orchestrator.ts:1101) but the fake holds only seeded evidence, all older than any test inbound |
| 5 | edge, blind | Duplicate question ids / groups across topics | low | reject | Unlikely in authored files; fix adds a guard |
| 6 | edge, blind | Date proxy `construct` ignores `newTarget` | low | patch | Direct correction with `Reflect.construct` |
| 7 | edge, blind | Shifted clock leaks when caller forgets `restoreClock` | medium | patch | Global `Date` replaced for the worker; only a README comment guards it |
| 8 | edge, blind, verification | Double space in negative `dueInMinutes` summary | low | patch | Template yields `due  30 min ago` |
| 9 | edge | Known-presets hint missing for non-union preset errors | low | patch | Hint gated on `invalid_union_discriminator` only |
| 10 | edge, blind | Tests resolve paths from `process.cwd()`; fixture dir inside package | low | patch | `EXAMPLE`, `from-sim-run.mjs`, fixture dir are cwd-relative |
| 11 | verification | Closed cycle (`open: false`) never tested | gap | patch | No test or fixture sets `open: false` |
| 12 | verification | Markdown precondition block not asserted | gap | defer | Same data pinned in run JSON and suite Given; filed disposition defer |
| 13 | blind | Status and onboarding enums hand-copied from application | medium | patch | Drift would accept invalid or reject valid files; types are exported, constants are not |
| 14 | blind | Cycle group order hand-copied (`CANONICAL_GROUP_ORDER` not exported) | medium | defer | Fixing needs an export in packages/application, outside this story's boundary |
| 15 | blind | `cycle-open` accepts more than 4 topics, invents `topic-5` | low | patch | Direct schema cap |
| 16 | blind | Fake survey repo throws opaque "is not a function" for unimplemented methods | low | reject | Adds a Proxy; current scenarios reach only the three implemented reads |
| 17 | blind | Evidence may point at bot messages; duplicate groups | low | reject | Unlikely authoring error; fix adds guards |
| 18 | blind | `description` not shown in reports | low | reject | Spec asks for name, presets and state areas; adding it widens the summary surface |
| 19 | blind | Markdown context shows less than suite Given | low | reject | Human-read secondary report; suite Given is the QA view |
| 20 | blind | `overrides` can make summary disagree with the run | low | reject | Overrides are a developer escape hatch; not used by QA flows |
| 21 | blind | Tests read private `options` | low | reject | Test-only coupling; the scripted-turn test asserts through orchestrator inputs |
| 22 | blind | Other untested paths (partial onboarding merge, origin labels, bad timezone) | low | reject | Fallback paths with low reach; closed cycle covered by #11 |
| 23 | blind, verification | `./undefined` reports from existing test; no agent-failures entry | low | defer | Pre-existing in coach-harness.test.ts, not caused by this story |

## Design Notes

Cycle presets expand to question statuses, so `cycle-open {total: 3, closed: 1}` becomes three groups with statuses `confirmed`, `collecting`, `collecting`; the existing `cycle-progress` utility then derives everything else. History entries carry `role`, `text` and optional `minutesBeforeStart`; when absent, messages are spaced 60 s apart ending at `elapsed` before start.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: all pass, including `src/preconditions/load.test.ts`.
- `pnpm --filter @entalent/conversation-sim typecheck` -- expected: no errors.
- `pnpm --filter @entalent/conversation-sim lint` -- expected: no errors.
