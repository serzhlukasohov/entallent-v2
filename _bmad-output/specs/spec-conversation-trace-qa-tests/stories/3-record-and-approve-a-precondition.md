---
title: 'Record and approve a precondition from scratch'
type: 'feature'
created: '2026-11-01'
status: 'done'
baseline_commit: '04a72313fa7e9c9a299fb6e9891efa1eeb3b3fd4' # HEAD; the tree was already dirty, pre-change copies of touched files are in the session scratchpad baseline-story3 folder
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-conversation-trace-qa-tests/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-conversation-trace-qa-tests/precondition-format.md'
  - '{project-root}/_bmad-output/specs/spec-conversation-trace-qa-tests/stories/2-qa-tests-as-data-files.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** QA can write employee replies but cannot turn them into a starting state: a precondition still has to be hand-authored, and nothing guarantees a test starts from reviewed state rather than whatever a model produced.

**Approach:** A recording file (name, base precondition, replies) is run once through the harness by `pnpm sim:record`; the in-memory state after the run is exported as a candidate precondition plus the usual suite report. `pnpm sim:approve` marks a reviewed candidate approved (who, when, recorded from) and moves it into `preconditions/recorded/`, where QA tests use it with the history seeded, not replayed (SPEC CAP-5).

## Boundaries & Constraints

**Always:**
- Recording files are JSON `schemaVersion: 1`, zod strict: `name` (kebab-case), optional `description`, optional `base` (path inside `preconditions/` or an inline precondition; absent = empty state), `replies` (≥ 1).
- The record CLI requires an explicit `--live` or `--scripted`; scripted uses `ScriptedAiProvider`. It runs through Vitest (harness modules import Vitest) and reuses `from-sim-run.mjs` / `render-report.mjs`.
- Export is one function over the in-memory repos and fakes (history with metadata, active memory, goals, style profile, onboarding, pulse cycle, pending scheduled actions, user); its output validates as a precondition before it is written.
- Candidates live in `precondition-candidates/<name>/precondition.json` (reports under its `runs/`, already git-ignored), outside `preconditions/`, so QA tests cannot reference them.
- The loader rejects `origin.kind: recorded` that is not approved or lacks `approvedBy`/`approvedAt`; only the approve command reads candidates.
- Approve refuses a scripted recording unless `--allow-scripted`, an already approved file, or an existing target.
- A test from an approved precondition makes no model call before its first reply.

**Never:**
- No live recording run and no `pnpm sim`, `sim:gate`, `harness:check`; framework tests use the scripted provider.
- No product-code changes outside `packages/conversation-sim` (root `package.json` aliases only); no MAF or `agent-service`.
- No stateful pulse-cycle fake in this story: the exported cycle is what the fake holds.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Record from presets | inline base `onboarding-done`, 2 replies, scripted | candidate holds 4 history messages oldest first, onboarding, memory added by the run; origin `recorded`, not approved, provider `scripted` | N/A |
| Record from file base | base `examples/cycle-open-with-history.json` | base history, goals, cycle, scheduled actions carried over, recorded turns appended | N/A |
| Turn throws | provider throws on reply 2 | no candidate written; run report and failing test | error rethrown |
| Bad recording | `schemaVersion: 2`, missing replies, bad name, base outside `preconditions/` | load fails | error names file and field |
| Candidate used early | unapproved recorded file under `preconditions/` | load fails | error says to approve |
| Approve | candidate, `--by Olena` | `preconditions/recorded/<name>.json` with `approved`, `approvedBy`, `approvedAt`; candidate JSON removed | N/A |
| Approve refusals | scripted without flag, already approved, target exists, no approver | nothing moved | clear error |
| Approved in a QA test | QA file references `recorded/<name>.json` | harness transcript equals the recorded one; zero `llm` trace events before the first send | N/A |

</frozen-after-approval>

## Code Map

- `src/preconditions/load.ts` -- `parsePrecondition`, `PreconditionError`, `harnessFromPrecondition`, `summarize`; imports Vitest (`onTestFinished`), so move parsing into a Vitest-free `parse.ts` and re-export. Add `seedHarness` returning the harness plus its onboarding and cycle fakes.
- `src/preconditions/schema.ts` -- `originSchema` `recorded` variant: add optional `recordedAt`, `recordedFrom`, `base`, `provider`.
- `src/harness/coach-harness.ts` -- `transcript`, `memoryItems`, `goalRepo.goals`, `styleProfile()`, `scheduledActions`; `trace.events` kind `llm`.
- `src/fakes/onboarding-turn.ts` (`state`), `src/fakes/pulse-cycle.ts` (`state`), `src/fakes/repositories.ts` (`InMemoryScheduledActionRepository.actions`).
- `src/harness/report.ts` -- `reportRun` (needs a Vitest test); `SIM_GATE_REPORT_DIR` picks the runs folder.
- `src/qa/load.ts` -- `PRECONDITIONS_DIR`, path guard pattern; `report/run-sim.mjs` -- Vitest spawn and report chain to mirror.

## Tasks & Acceptance

**Execution:**
- [x] `src/preconditions/parse.ts`, `load.ts`, `schema.ts` -- Vitest-free parsing, approval enforcement, origin fields, `seedHarness`, approved origin label -- loader guard and approve CLI.
- [x] `src/recording/schema.ts`, `load.ts` -- recording file format and loader with base resolution.
- [x] `src/recording/export.ts` -- `exportPrecondition(seeded, meta)` -- state after the run as a validated candidate.
- [x] `src/recording/record.ts` -- `recordPrecondition`, `writeCandidate`, `CANDIDATES_DIR`.
- [x] `src/recording/approve.ts`, `approve-cli.ts` -- `approveCandidate` and its tsx CLI.
- [x] `src/recording/record.run.test.ts`, `report/record-precondition.mjs` -- env-driven Vitest runner (skipped without env) and the record CLI.
- [x] `src/recording/recording.test.ts` -- every matrix row plus one scripted CLI round trip.
- [x] `package.json`, root `package.json`, `vitest.config.ts` -- `sim:record`, `sim:approve`, `src/recording` in `test` and `include`.
- [x] `qa-tests/recordings/onboarded-release-week.json`, `precondition-candidates/README.md`, `qa-tests/README.md`, `report/README.md` -- example and how-to.

**Acceptance Criteria:**
- Given the example recording, when `sim:record --scripted` runs into a temp candidates folder and `sim:approve --allow-scripted` follows, then the approved file loads in a QA test and the suite report JSON for the recording shows the base precondition in Given and the recorded replies as steps.
- Given existing tests, when `pnpm --filter @entalent/conversation-sim test` runs, then the 79 earlier tests still pass.

## Implementation Notes

- Implemented directly by the build agent (dispatch note: no further subagent; no live runs).
- `src/preconditions/parse.ts` now holds `loadPrecondition`/`parsePrecondition`/`PreconditionError`/`historyOffsets` (Vitest-free, re-exported from `load.ts`), so the approve CLI runs under plain `node --import tsx`; `load.ts` imports Vitest, which cannot be `require`d from this CommonJS package outside Vitest.
- The record CLI (`report/record-precondition.mjs`) spawns Vitest on `src/recording/record.run.test.ts` with `SIM_RECORD_*` env and `SIM_GATE_REPORT_DIR=<candidate>/runs`, then `from-sim-run.mjs` (and `render-report.mjs` with `--html`); `--candidates <dir>` redirects output (used by tests). Relative paths resolve against `INIT_CWD`, so the root aliases work.
- Exercised `pnpm sim:record ... --scripted --html --candidates <scratch>` and `pnpm sim:approve` (refused without `--allow-scripted`, then approved with the git user) from the repo root; never `--live`.
- `src/recording/recording.test.ts` (21 tests after review) includes a scripted CLI round trip through nested Vitest (~2.5 s) and a relative-path approve CLI run.
- Review patches: startTime always pinned; `recordedFrom` never an absolute machine path; approve refuses unknown provider; loader rejects blank approver; approve CLI fails on a flag without value; runner needs `SIM_RECORD_RUNNER=1` and has a 30 min timeout; record CLI clears stale vitest/report outputs and allows 2 s mtime slack; README path notes for repo-root use; due-time and relative-path tests.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | blind | Candidate written although `harness.failures` non-empty | false | reject | `send` records a failure and rethrows, so `recordPrecondition` throws before `writeCandidate` |
| 2 | blind | PR-approved scripted file loads in tests | low | reject | Needs a reviewer to hand-approve a file showing `provider: scripted`; fix adds a loader option |
| 3 | blind | Approval not tied to reviewed content (no hash) | low | reject | Approval is a trust marker by SPEC assumption; hash adds format surface |
| 4 | blind | Export validation failure after a live run discards the run; `as` casts on goal status/priority | medium | defer | Real for live runs only; needs a raw dump path (new surface) |
| 5 | blind | Absolute onboarding dates drift when base has no `startTime` | medium | patch | `completedAt` exported as ISO while history was start-relative; `startTime` now always pinned, test asserts it |
| 6 | blind, edge | Memory loses `canonicalKey`, `sensitivity`, `confidence` | medium | defer | Precondition memory schema cannot hold them; extending the format is a separate change |
| 7 | blind, edge | Evidence/messages/goals silently dropped on export | low | reject | Unreachable with the sim fakes: one conversation, one user, evidence groups always topics |
| 8 | blind | Pulse cycle copied, not progressed during recording | medium | defer | Spec Never: no stateful cycle fake in this story; README states it |
| 9 | blind, edge | approve CLI accepts `--by`/`--preconditions` without a value | low | patch | Silently fell back to git user / default folder; now fails; test added |
| 10 | blind, edge | Stale `report.html`/`vitest.json` from an earlier recording | low | patch | CLI now removes its own previous outputs before the run |
| 11 | blind | Re-record overwrites a hand-edited candidate | low | reject | Re-recording is the intended way to refresh a candidate |
| 12 | blind, edge | Approve not atomic (rm after write) | low | reject | rm failure on a file just read is unlikely; guard adds branching |
| 13 | blind | Candidate `precondition.json` not git-ignored | low | reject | Deliberate: PR review path may commit a candidate |
| 14 | blind | Absolute machine path in `origin.recordedFrom` | low | patch | Now package-, else repo-relative, else file name; test updated |
| 15 | blind | Name regex duplicated in `.mjs`; default user duplicated | low | reject | `.mjs` cannot import the TS module; drift caught by runner validation |
| 16 | blind | Test gaps (PR-approved scripted, drops, negative due, onboarding round trip) | low | reject | Covered by rows 2, 7, 5 and the due-time test from row 21 |
| 17 | edge | Unknown `provider` approved as if live | low | patch | Approve now requires `provider: live` unless `--allow-scripted`; test added |
| 18 | edge | Whitespace `approvedBy` passes the loader | low | patch | `trim()` in `checkApproval`; test added |
| 19 | edge | Coarse mtime reports a fresh candidate as stale | low | patch | 2 s slack in the freshness check |
| 20 | edge | Live recording killed by the 300 s test timeout | medium | patch | Runner test timeout 30 min |
| 21 | edge | Stray `SIM_RECORD_FILE`+`live` in a shell turns `pnpm test` into a live recording | low | patch | Runner also requires `SIM_RECORD_RUNNER=1`, set only by the CLI |
| 22 | edge | READMEs give package-relative paths for repo-root commands | medium | patch | Paths resolve against `INIT_CWD`; READMEs now say where to run and the root prefix |
| 23 | edge | Exported role ignores a track change during recording | low | reject | Track changes only on `role_changed`, which the sim never emits |
| 24 | verification | Exported `dueInMinutes` never asserted | gap | patch | Test asserts 24 h and 72 h after round trip |
| 25 | verification | `INIT_CWD` relative-path resolution untested | gap | patch | Approve CLI spawned with `INIT_CWD` = temp dir and relative args |

## Design Notes

Decisions taken without a human (checkpoints auto-approved by Illia): the spec runs about 1,060 words (over the 1,600-token target) and is kept whole, since recording, export and approval are one goal; the dirty working tree is the expected state of this branch and stays as is. Export flattens presets into explicit state and records the base name in `origin.base`. History offsets come from message times, last message at least 1 min before start, kept strictly decreasing (0.01 min steps) so scripted turns in the same millisecond still validate; `startTime` is always exported as the moment the recording ended (changed in review, #5: onboarding dates are absolute, so a relative history alone would drift). Approver defaults to `git config user.name`. PR path: a reviewer may instead commit the candidate moved into `preconditions/recorded/` with the approval fields filled; the loader accepts it the same way.

```json
{ "schemaVersion": 1, "name": "onboarded-release-week",
  "base": { "schemaVersion": 1, "presets": ["onboarding-done"], "user": { "name": "Olena", "timezone": "Europe/Kyiv" } },
  "replies": ["Release week again, I'm swamped.", "Mostly the checklist and handover."] }
```

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: all pass, including `src/recording/recording.test.ts`.
- `pnpm --filter @entalent/conversation-sim typecheck` -- expected: no errors.
- `pnpm --filter @entalent/conversation-sim lint` -- expected: no errors.
