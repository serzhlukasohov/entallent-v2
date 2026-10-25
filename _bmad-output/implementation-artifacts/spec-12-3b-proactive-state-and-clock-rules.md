---
title: 'Story 12.3b: Suite Rule Implementations — proactive window, clock and state/event rules'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: 'dee02bf6a73ec365c3ac0fb0b824ecf681c420d9'
route: 'dispatch'
review_loop_iteration: 1
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-3-suite-rule-implementations.md'
warnings: ['oversized']
deferred:
  - summary: >-
      `__fixtures__/evaluation.ts` still overrides `effect-count` with the 12.2 stand-in, so most evaluate pairing paths run against the stand-in, not the real rule.
    evidence: |-
      Story 12.3b review (2026-10-25): only `effect-count.test.ts` calls `evaluate` with the real `RULES`. Swap the stand-in once 12.4 cases and the 12.7 executor exist.
    location: >-
      packages/conversation-sim/src/suite/__fixtures__/evaluation.ts:36
    severity: medium
  - summary: >-
      A `change` state criterion whose own check is `state-not-greater-than` always comes out INVALID `precondition:already-satisfied`, because `alreadySatisfied` substitutes the `before` snapshot.
    evidence: |-
      Verification Gap and implementer report (Story 12.3b review); `evaluate.ts:220-233`. 12.4 authors must put upper bounds on `invariant` criteria.
    location: >-
      packages/conversation-sim/src/suite/evaluate.ts:220
    severity: medium
  - summary: >-
      The 12.7 contract (copy the message column into `metadata.messageType` for `window.outbound`, `steps[].reply.messages` and `unsolicited`) is recorded only in rule-side docs; nothing at the executor surface asserts it.
    evidence: |-
      Intent Alignment (Story 12.3b review). Settle in 12.7 with an executor test that every bot-initiated message carries the key.
    location: >-
      packages/conversation-sim/src/suite/rules/proactive.ts
    severity: medium (unverified)
  - summary: >-
      `evaluate.ruleChecks` synthesizes `effect-count` with `step: 0` for observation tests, which counts only seed and fixture events.
    evidence: |-
      Blind Hunter (Story 12.3b review); pre-existing 12.2 synthesis. Settle when the first observation test pairs a state effect (12.4).
    location: >-
      packages/conversation-sim/src/suite/evaluate.ts:94
    severity: medium (unverified)
  - summary: >-
      State rule params duplicate the criterion's `stateQuery` and the loader does not cross-check them, so a mismatched `at`/`query` or a `before` read on a `change` criterion comes out INVALID already-satisfied.
    evidence: |-
      Edge Case Hunter (loop 2); `evaluate.ts:216-233`. A loader cross-check is the durable fix.
    location: >-
      packages/conversation-sim/src/suite/loader.ts
    severity: medium
  - summary: >-
      The P-09 bound `max: { repliesWithMetadata }` counts only `steps[].reply.messages`, not `unsolicited`.
    evidence: |-
      Blind Hunter (loop 2). Settle in 12.4 by checking whether survey summaries can arrive unsolicited.
    location: >-
      packages/conversation-sim/src/suite/rules/state-not-greater-than.ts
    severity: medium (unverified)
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The rule-based criteria for P-06 (initiation, 48-hour spacing, working hours), P-09 (state), the vacuous-pass guard `effect-count` and the L0 `clock-leak` check have no rules, so 12.4 cases and 12.7's L0 executor cannot be decided.

**Approach:** Add 7 rules under `suite/rules/`, one file each. They are pure functions over `CaseRun` plus params that the 12.3a params mechanism validates. Add an optional `CaseRun.clock { from, to }` so `clock-leak` has a range. This story depends on 12.3a.

## Boundaries & Constraints

**Always:**
- Use the 12.3a `RuleEntry` (params schema, optional `RuleContext`), with `pass` and `fail` fixtures and strict params.
- Do time math only over `CaseRun` timestamps and params, using `Intl.DateTimeFormat` for the local hour. Never use `Date.now()`, and work whether or not 12.5 has landed.
- Identify proactive messages by the rule below; never infer them from text.
- **Bot-initiated:** an outbound message with `messageType: 'proactive_check_in'`. **Contract for 12.7:** the L0 executor (and later L1) copies the message column into `ReplyMessage.metadata.messageType` for every message in `window.outbound`, `steps[].reply.messages` and `unsolicited`. A message without that key is not bot-initiated.
- **P-06 working hours:** use the suite text literally: 09:00–18:00 local, any day, start inclusive and end exclusive. Weekends stay Confluence open item 2. This is a known red against product quiet hours 22–08 and is recorded as FAIL.
- **`clock-leak` range:** a new optional `CaseRun.clock = { from, to }` (ISO timestamps with offset, `from ≤ to`), filled by the 12.7 executor. The schema change is part of this story. A missing `clock` is NOT_OBSERVABLE `no-clock-range`.

**Never:**
- Change product behavior to turn P-06 green.
- Import `isInQuietHours`, `getLocalHour` or `DEFAULT_QUIET_HOURS`.
- Mirror the scheduler's QA 2 h/4 h cadence branch.
- Change any schema other than adding the optional `clock`.
- Implement `evaluate` or the synthesis of the `effect-count` pairing (Story 12.2).
- Make model calls or read env vars.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No initiation | `window.outbound` has none proactive | `proactive-initiated` FAILs; `proactive-spacing` and `proactive-working-hours` NOT_OBSERVABLE `no-initiations` | N/A |
| Window absent | `window.outbound` declared, `window` missing | NOT_OBSERVABLE `no-window` | N/A |
| Spacing boundary | initiations 48:00 h apart / 47:59 h apart | PASS / FAIL listing both timestamps | N/A |
| Hour boundary | 18:00 local / 08:59 local / Saturday 10:00 | FAIL / FAIL / PASS | N/A |
| Timezone | 07:30 UTC, `Europe/Kyiv` (10:30 local) | PASS | N/A |
| Clock leak | one `occurredAt` outside `clock` | FAIL with message id and timestamp | N/A |
| effect-count | 1 `ok` + 1 `error` call on step 1, `expected: 1` | PASS (only `ok` counts) | N/A |
| Step not reached | `effect-count step: 2`, run has 1 step | NOT_OBSERVABLE `step-not-reached:2` | N/A |
| State not read | `state-equals` at `after`, key absent | NOT_OBSERVABLE `state-not-read:<query>@after` | N/A |
| Bad params | `state-equals` with an `expected` that does not match the query's value schema | load fails `invalid-rule-params` | SuiteLoadError |

</frozen-after-approval>

## Code Map

- `packages/conversation-sim/src/suite/rules/registry.ts` -- `RuleEntry` (`requires`, optional `params` Zod schema, `run(run, criterion, params?, context?)`, `fixtures`), `RULES`, `RULE_NAMES`. Register the 7 rules here. `fixtures` gains an optional `params` so param rules can ship runnable fixtures.
- `.../suite/rules/registry.test.ts` -- The `describe.each` block assumes reply-text rules (`turn <n> — ` evidence, `no-replies`, `step-not-reached`). Scope it to the 11 reply/turn rules; add a generic block for the 7 new rules (schema-valid fixtures, fixture FAIL/PASS with `fixtures.params`, `params` schema present). Update the name list and the `effect-count` not-in-registry assertion.
- `.../suite/evaluate.ts:83-108` -- `ruleChecks` synthesizes `{ port, method, expected, step }` (`step` may be 0) for `effect-count`; `runCheck` checks `entry.requires`, then calls `run` with RAW `check.params`. Read only.
- `.../suite/__fixtures__/evaluation.ts:36-50` -- 12.2's stand-in `effect-count`; its FAIL evidence `effect-count <port>.<method>@<step>: <count>` is the format to keep. Read only.
- `.../suite/loader.ts:226-246` `checkRuleParams` -- validates params with `entry.params.safeParse` at load, discards the parsed value. Read only.
- `.../suite/schema.ts:39-80` `StateQueryNameSchema`, `STATE_QUERY_VALUE_SCHEMAS`, `StateSnapshotSchema`; `:118` `fieldObserved`; `:155` `stateAtStep`; `:497` `RunEventSchema`; `:537-580` `CaseRunSchema` (add `clock` here).
- `.../suite/rules/reply-selection.ts` -- `RuleOutcome`, `missingField`, `formatEvidence`. Reuse; do not reuse `selectReplies` (these rules are not reply-text rules).
- `.../suite/rules/synthetic-run.ts` -- `syntheticRun` base for fixtures; `BASE_TIME` is 2026-01-05 (a Monday) 10:00 UTC.
- `packages/application/src/use-cases/proactive-check-in.use-case.ts:224`, `packages/application/src/utils/quiet-hours.ts:7` -- context for the 12.7 contract and the known red. Read only, do not import.

## Tasks & Acceptance

**Execution:**
- [x] `suite/schema.ts`, `schema.test.ts` -- Optional `CaseRun.clock = { from, to }` (`IsoTimestampSchema`, strict) with a `from ≤ to` issue at `['clock', 'to']`; tests for valid, inverted and absent. Export the existing `STATE_AT` pattern (as a schema or regex) so rules reuse it instead of re-declaring it.
- [x] `suite/rules/proactive.ts` -- Shared helper: `initiations(run)` returns `window.outbound` messages with `metadata.messageType === 'proactive_check_in'`, ordered by `occurredAt`; returns an outcome `no-window` when `run.window` is absent. Production helpers only: fixture builders (`outbound`, `windowRun`, state fixture runs) live in `rules/synthetic-run.ts`.
- [x] `suite/rules/proactive-initiated.ts`, `proactive-spacing.ts`, `proactive-working-hours.ts` -- As in the frozen block. Params: `proactive-initiated { min = 1 }`, `proactive-spacing { minGapMs = 172800000 }`, `proactive-working-hours { timezone }` (required; hours fixed at the suite's 09:00–18:00, no hour params). Spacing FAIL evidence names both timestamps; working-hours FAIL names each offending timestamp and its local `HH:MM`. `timezone` is validated with `Intl.DateTimeFormat` inside the params schema. A missing hour or minute part from `formatToParts` throws instead of defaulting.
- [x] `suite/rules/clock-leak.ts` -- `requires: ['reply.messages']`. Inclusive range over `steps[].reply.messages`, `unsolicited` and `window.outbound`; FAIL lists `<message id> <occurredAt>` per leak and the clock range once. A run with a clock but no recorded message is NOT_OBSERVABLE `no-messages`, never a PASS.
- [x] `suite/rules/effect-count.ts` -- `requires: ['events']`; params `{ port, method, expected, step }`; NOT_OBSERVABLE `step-not-reached:<step>` when `step > run.steps.length`; FAIL evidence in the stand-in format `effect-count <port>.<method>@<step>: <count>` (12.2's tests pin it).
- [x] `suite/rules/state.ts` -- Shared helper: resolve `at` to a snapshot key, check `state.<query>` is observed (`unobservable:state.<query>@<level>`), and return NOT_OBSERVABLE `state-not-read:<query>@<at>` for an absent key.
- [x] `suite/rules/state-equals.ts` -- Params `{ query, at, expected }`; `expected` refined with `STATE_QUERY_VALUE_SCHEMAS[query]`; deep equality that tells arrays from objects.
- [x] `suite/rules/state-not-greater-than.ts` -- Params `{ query, at, max, delta = false }`. `query` is a count query, derived from `StateQueryNameSchema` minus `questionProgress`. `max` is an integer OR `{ repliesWithMetadata: <metadata key> }`, which resolves to the number of reply messages in `steps[].reply.messages` whose `metadata[key] === true` (the P-09 form: "new summaries not greater than seen" is `{ delta: true, max: { repliesWithMetadata: key } }`). `delta: true` compares `snapshot(at) − snapshot(before)` and is rejected at load with `at: 'before'`. FAIL evidence names the measured value and the resolved max.
- [x] `suite/rules/registry.ts`, `registry.test.ts` -- Register the 7 rules; optional `fixtures.params`; test changes per the Code Map. The param-rule block also asserts each rule returns NOT_OBSERVABLE on its fail fixture with `observed: []`.
- [x] `suite/rules/<rule>.test.ts` -- One file per new rule, covering the I/O matrix rows that belong to it, plus PASS, FAIL and NOT_OBSERVABLE each; working hours also covers a DST date in `Europe/Kyiv`; `state-not-greater-than` covers both `max` forms. Loader tests for `invalid-rule-params` on: `state-equals` with a mistyped `expected`, `proactive-working-hours` with an unknown timezone, and `state-not-greater-than` with `query: 'questionProgress'`.

**Acceptance Criteria:**
- Given the registry, when it is loaded, then it holds all 18 rules (3 wrapped, 8 from 12.3a, 7 here).
- Given a `window.outbound` whose messages lack `metadata.messageType`, when the proactive rules run, then they count no initiations, which surfaces a broken 12.7 contract as a FAIL or NOT_OBSERVABLE, never a PASS.
- Given an existing `CaseRun` without `clock`, when it is parsed, then it stays valid, so 12.1 and 12.2 fixtures need no change.
- Given a change criterion paired by `evaluate` with the real `effect-count`, when a test runs `evaluate` against `RULES`, then pairing works with no stand-in (12.2's `evaluate.test.ts` keeps passing).
- Given a param rule called with params that omit a defaulted field (as `runCheck` passes raw params), when it runs, then the default applies.
- Given a P-09-shaped run (2 replies carrying `metadata[key] === true`, `before` 0, `after` 2 / 3), when `state-not-greater-than` runs with `{ delta: true, max: { repliesWithMetadata: key } }`, then it PASSes / FAILs.

## Implementation Notes

- Params: `proactive-initiated { min = 1 }`, `proactive-spacing { minGapMs = 172800000 }`, `proactive-working-hours { timezone }` (IANA `Area/Location` or UTC only; hours fixed at 09:00–18:00), `clock-leak {}`, `effect-count { port, method, expected, step }`, `state-equals { query, at, expected }`, `state-not-greater-than { query, at, max: int | { repliesWithMetadata }, delta = false }`. All-optional schemas wrap in `.default({})`.
- `repliesWithMetadata` counts reply messages over the steps the `at` snapshot covers (all for `after`, 1..n for `after-step:n`); combining it, or `delta`, with `at: 'before'` is rejected at load.
- `clock-leak` checks only the declared collections (`reply.messages` → replies and unsolicited; `window.outbound` → window), NOT_OBSERVABLE `no-messages` when nothing was recorded.
- `effect-count` is also NOT_OBSERVABLE `step-not-reached` past `stoppedAtStep`.

## Spec Change Log

### 2026-10-25 — Review loop 1 (bad_spec)
- Trigger: Blind Hunter, Verification Gap and Intent Alignment all found the P-09 bound `max: { repliesWithMetadata: key }` missing. The planning rewrite of Tasks had dropped it from the draft, so the implementation accepted an integer `max` only and P-09 could not be written.
- Amended: `state-not-greater-than` task restores both `max` forms, rejects `delta` with `at: 'before'`, derives count queries from the schema; new P-09 acceptance criterion. Also tightened: `clock-leak` requires `reply.messages` and is NOT_OBSERVABLE with no messages (no vacuous PASS), fixture builders move to `synthetic-run.ts`, `STATE_AT` is reused, `localTime` throws on missing parts, extra loader and registry tests.
- Known-bad state avoided: a P-09 criterion that cannot be expressed, and a `clock-leak` that PASSes a run that recorded nothing.
- KEEP: attempt 1 (patch at `/private/tmp/claude-501/-Users-illiamilevskiy-Documents-entallent-v2/40239844-4d11-4aa9-84cb-378f6f8f8c64/scratchpad/12-3b-attempt-1.patch`) was otherwise correct and passed all checks: reuse it as the starting point. Keep its rule files, self-parsing of raw params in `run`, `.default({})` on all-optional schemas, the `readState` / `initiations` helpers, the `effect-count` evaluate pairing test, the 11/7 split of `registry.test.ts`, and its I/O matrix tests.

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 33 findings — high 0, medium 7, low 16, false 4, maybe-false 6
- findings:
  - `[medium]` `[bad_spec]` (intent) P-09 bound cannot be expressed; tests show no P-09-shaped case — amended the `state-not-greater-than` task and added a P-09 AC.
  - `[maybe-false]` `[defer]` (intent) 12.7 `messageType` copy contract recorded only in a JSDoc; no executor test — settle in 12.7 when the executor exists.
  - `[medium]` `[defer]` (intent) 6 of 7 rules never run through loader → evaluate → runCheck; `__fixtures__/evaluation.ts` still overrides `effect-count` with the stand-in — swap the stand-in for the real rule in 12.7/12.8 when cases exist; recorded in `deferred`.
  - `[false]` `[reject]` (intent) working-hours hour params dropped — the frozen block fixes 09:00–18:00 literally; hour params were only in the non-frozen draft.
  - `[low]` `[reject]` (intent) fixtures are minimal runs, not 12.7-shaped — 12.7 owns realistic fixtures; adding them here adds no coverage of these rules.
  - `[medium]` `[bad_spec]` (blind) P-09 `repliesWithMetadata` dropped, not logged — same root cause as the first row.
  - `[low]` `[reject]` (blind) Spec Change Log empty after Tasks rewrite — fix is a spec edit.
  - `[medium]` `[bad_spec]` (blind) `clock-leak` PASSes a run that recorded nothing — amended the `clock-leak` task.
  - `[low]` `[bad_spec]` (blind) `clock-leak` FAIL evidence omits the range — amended (range once in evidence); window-inside-clock check rejected as scope growth.
  - `[low]` `[reject]` (blind) `effect-count` evidence lacks expected count — the format is pinned by 12.2's evaluate tests.
  - `[maybe-false]` `[defer]` (blind) synthesized `step` 0 for observation tests counts only seed events — pre-existing 12.2 synthesis (`ruleChecks`); settle when the first observation test pairs a state effect (12.4).
  - `[medium]` `[defer]` (blind) stand-in still in evaluate fixtures — same as the intent row; deferred once.
  - `[low]` `[bad_spec]` (blind) no loader test for invalid timezone / non-count query — amended the test task.
  - `[low]` `[bad_spec]` (blind) `StateAtSchema` duplicates `STATE_AT`; `COUNT_QUERIES` hard-coded — amended (reuse and derive).
  - `[low]` `[bad_spec]` (blind) `sameValue` equates `[]` and `{}` — amended (`state-equals` deep equality tells arrays from objects).
  - `[low]` `[bad_spec]` (blind) param-rule registry block has no NOT_OBSERVABLE assertion — amended the registry test task.
  - `[low]` `[bad_spec]` (blind) fixture builders in production modules — amended (move to `synthetic-run.ts`).
  - `[low]` `[reject]` (blind) task log row cites `--base 3af7d0e` — the base the spec's Verification names; the wider range still passed.
  - `[low]` `[bad_spec]` (blind) no DST test; `localTime` falls back to `00` — amended (DST test, throw on missing parts).
  - `[low]` `[bad_spec]` (edge) `delta` with `at: 'before'` is always 0 — amended (reject at load).
  - `[low]` `[reject]` (edge) negative growth with `delta` PASSes — "not greater than" holds for a drop; a reset is a different criterion.
  - `[false]` `[reject]` (edge) `effect-count` FAILs a step past `stoppedAtStep` — `evaluate.ts:180` returns NOT_RUN for that step before any rule check runs.
  - `[maybe-false]` `[reject]` (edge) unparseable `occurredAt` treated as in range — `CaseRun` timestamps are `IsoTimestampSchema`; would be low even if reachable.
  - `[maybe-false]` `[reject]` (edge) sub-millisecond leak truncates — executors write ms ISO strings; low if real.
  - `[maybe-false]` `[reject]` (edge) unparseable `occurredAt` breaks sort — same schema guarantee; low if real.
  - `[low]` `[reject]` (edge) `minGapMs` not a whole minute prints misleading evidence — no case uses one; cosmetic.
  - `[low]` `[bad_spec]` (edge) `formatToParts` missing part defaults to 00:00 — same root as the DST row; amended.
  - `[maybe-false]` `[defer]` (edge) evaluate pairing mostly verified against the stand-in — same as the stand-in row.
  - `[false]` `[reject]` (verification) no verification gaps — not a defect.
  - `[medium]` `[defer]` (verification) `state-not-greater-than` under a `change` criterion is always INVALID via `alreadySatisfied` — upper bounds belong on `invariant` criteria; recorded in `deferred` for 12.4 authors.
  - `[medium]` `[bad_spec]` (verification) P-09 bound dropped — same root cause as the first row.
  - `[false]` `[reject]` (verification) weakened `requires` assertion leaves no regression unpinned — the new NOT_OBSERVABLE assertion covers it anyway.
  - `[low]` `[reject]` (blind) "nothing could leak" PASS note in Implementation Notes — superseded by the `clock-leak` amendment.

### 2026-10-25 — Review pass (loop 2)
- verdicts: 27 findings — high 0, medium 7, low 15, false 3, maybe-false 2
- findings:
  - `[medium]` `[defer]` (intent a) rules exercised at `run`, not through 12.4 cases and the 12.7 executor — carried in substance from loop 1 (stand-in / executor contract); deferred-work.
  - `[medium]` `[patch]` (intent b) `clock-leak` cannot check a window-only observation run — patched: `requires: []`, NOT_OBSERVABLE only when neither `reply.messages` nor `window.outbound` is declared.
  - `[low]` `[patch]` (intent c) Kyiv matrix row (07:30 UTC = 10:30) only tested in January — patched: summer case added.
  - `[false]` `[reject]` (intent d) interfaces changed beyond `clock` — `StateAtSchema` export reuses the same regex and `fixtures.params` is a TS type; no zod data schema besides `clock` changed.
  - `[low]` `[patch]` (verification) `at: 'before'` with `repliesWithMetadata` untested — patched: the combination is rejected at load, with tests.
  - `[medium]` `[patch]` (blind) `clock-leak` skips window-only runs — same root as intent b.
  - `[low]` `[patch]` (blind) `clock-leak` fail fixture leaks outside its own window — patched fixture.
  - `[maybe-false]` `[defer]` (blind) `initiations()` does not bound by `window.from`/`to` — the 12.7 executor owns emitting in-window messages; deferred-work.
  - `[low]` `[patch]` (blind) timezone check accepts `EST`, `+02:00` — patched: IANA `Area/Location` or UTC only, with tests.
  - `[medium]` `[defer]` (blind) no load-time guard for `state-not-greater-than` on a `change` criterion — grouped with the params/stateQuery cross-check; loader change out of this story's surface; deferred-work.
  - `[low]` `[patch]` (blind) `at: 'before'` + `repliesWithMetadata` always resolves 0 — same root as the verification row.
  - `[maybe-false]` `[defer]` (blind) P-09 bound ignores `unsolicited` — depends on whether summaries can arrive unsolicited; deferred-work.
  - `[low]` `[reject]` (blind) `requires: []` on state rules hides the dependency from the static gate — chosen in Design Notes; `evaluate` maps the in-run NOT_OBSERVABLE to NOT_RUN the same way.
  - `[low]` `[reject]` (blind) task checklist unchecked, Implementation Notes empty — spec bookkeeping, updated at finalize.
  - `[low]` `[reject]` (blind) KEEP patch path is session-local — fix is a spec edit; the KEEP list is summarized inline.
  - `[low]` `[patch]` (blind) no `docs/agent-failures.md` entry for the loop-1 bad_spec — added the entry (workflow layer, open).
  - `[low]` `[patch]` (blind) deferred items missing from shared deferred-work — appended to `deferred-work.md`.
  - `[low]` `[patch]` (blind) authored `effect-count` past `stoppedAtStep` counts 0 — patched: NOT_OBSERVABLE `step-not-reached`, with a test.
  - `[low]` `[patch]` (blind) DST test skips the switch day — patched: instants on 2026-03-29 either side of 01:00 UTC.
  - `[low]` `[defer]` (edge) out-of-window messages count as initiations — same as the blind `initiations()` row.
  - `[medium]` `[defer]` (edge) `state-equals` params `at`/`query` differ from `stateQuery` → false INVALID — grouped loader cross-check; deferred-work.
  - `[medium]` `[defer]` (edge) `state-equals` `at: 'before'` on a `change` criterion → always INVALID — same group.
  - `[low]` `[reject]` (edge) `after-step:N` past the test's steps loads cleanly — fails loudly as NOT_RUN `state-not-read`; a load check adds a branch for a rare typo.
  - `[medium]` `[patch]` (edge) authored `effect-count` past `stoppedAtStep` FAILs — same root as the blind row.
  - `[low]` `[reject]` (edge) authored `effect-count` step past the test's steps loads cleanly — loud NOT_RUN at runtime; same reason as above.
  - `[false]` `[reject]` (edge) `repliesWithMetadata` counts steps past `stoppedAtStep` — an executor records no steps after it stops (`stoppedAtStep` marks the last recorded step).
  - `[false]` `[reject]` (edge) matrix says 10:30 for Kyiv but test gives 09:30 — the matrix holds for summer time; fix would edit the frozen intent; a summer test now pins it.

## Design Notes

These rules take params because `run` sees only `Pick<Criterion, 'id' | 'evaluatedAt'>`, not `stateQuery`. Story 12.2 synthesizes `effect-count` params from the manifest's `stateEffect`, with `step` set to the evaluated step.

**Params reach the rule raw.** `runCheck` passes `check.params` unparsed (deferred-work, 12.3a review). Each param rule parses its own params with its own schema at the top of `run` (`schema.parse(params ?? {})`). Defaults then apply, and the synthesized `effect-count` params are validated too; a parse failure there is a manifest bug and throws, like `evaluate`'s other contract errors. `evaluate` and `loader` stay unchanged.

**State rules read the query from params,** so their `requires` cannot name it statically: declare `requires: []` and check `fieldObserved('state.<query>')` inside `run`.

**`effect-count` counts on the evaluated step only** (the frozen intent), which settles the 12.2 deferred question for this story.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: all suite tests pass offline.
- `pnpm --filter @entalent/conversation-sim typecheck` -- expected: no errors.
- `pnpm --filter @entalent/conversation-sim lint` -- expected: no errors.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: a passing JSON receipt; report its path.

## Auto Run Result

**Summary:** Seven suite rules for P-06 (initiated, spacing, working hours), P-09 state (`state-equals`, `state-not-greater-than` with the `repliesWithMetadata` bound), the `effect-count` vacuous-pass guard and the L0 `clock-leak` check, plus the optional `CaseRun.clock`. The registry now holds 18 rules; `evaluate` and `loader` are unchanged.

**Files changed** (under `packages/conversation-sim/src/suite/`):
- `schema.ts` / `schema.test.ts` -- optional `CaseRun.clock` with `from ≤ to`; exported `StateAtSchema` reused by `StateQuerySchema`.
- `rules/proactive.ts` -- `initiations()` and the 12.7 `messageType` contract.
- `rules/state.ts` -- `readState`, deep `sameValue`.
- `rules/{proactive-initiated,proactive-spacing,proactive-working-hours,clock-leak,effect-count,state-equals,state-not-greater-than}.ts` + tests -- the seven rules.
- `rules/synthetic-run.ts` -- fixture builders `outbound`, `windowRun`, `stateFixtureRun`.
- `rules/registry.ts` / `registry.test.ts` -- 18 rules, optional `fixtures.params`, 11/7 test split.
- `loader.test.ts` -- `invalid-rule-params` cases.
- Docs: `docs/agent-failures.md` (planning-rewrite failure), `docs/agent-task-log.md`, `deferred-work.md`.

**Review:** two passes. Loop 1: 33 findings → bad_spec (P-09 bound dropped in planning) → spec amended, code re-derived from the attempt-1 patch. Loop 2: 27 findings → 2 medium and 9 low patched (window-only `clock-leak`, `effect-count` past `stoppedAtStep`, IANA-only timezone, `before` + `repliesWithMetadata` rejected, fixture and DST tests, failure log and deferred-work entries); 6 deferred (stand-in `effect-count`, params/`stateQuery` cross-check, 12.7 contract and window bounds, step-0 synthesis, unsolicited summaries); 10 rejected with reasons in the triage log.

**Follow-up review recommended: true** -- two medium entries were patched in loop 2 (the `clock-leak` observability change and the `effect-count` `stoppedAtStep` guard) without another review pass over the patched code.

**Verification:** `pnpm --filter @entalent/conversation-sim test` 27 files / 451 tests passed; typecheck and lint clean; `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` passed (receipt `runs/harness/receipt-1792920248471-199c14e5.json`).

**Residual risks:** P-06 working hours is a known red against product quiet hours (by design). The six deferred items above must be settled in 12.4 / 12.7.
