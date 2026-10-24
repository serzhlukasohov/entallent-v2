---
title: 'Story 12.3b: Suite Rule Implementations — proactive window, clock and state/event rules'
type: 'feature'
created: '2026-10-25'
status: 'draft'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-3-suite-rule-implementations.md'
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

- `packages/conversation-sim/src/suite/rules/registry.ts` -- Register the 7 rules, using 12.3a's `params` and `RuleContext`.
- `.../suite/schema.ts:537-580` `CaseRunSchema` -- Add optional `clock` and a `from ≤ to` refinement. `:39-69` `StateQueryNameSchema` and `STATE_QUERY_VALUE_SCHEMAS` parse `expected`. `:497` `RunEvent` provides `stepIndex`, `port`, `method` and `outcome`.
- `.../suite/schema.test.ts` -- Add `clock` validity cases.
- `.../suite/rules/synthetic-run.ts` -- Fixtures spread `window`, `clock`, `state` and `events` onto the built run.
- `packages/application/src/use-cases/proactive-check-in.use-case.ts:224` -- `messageType: 'proactive_check_in'` is a message column; this is the source of the 12.7 contract. Read only.
- `packages/application/src/utils/quiet-hours.ts:7` -- 22–08 default, the reason for the known red. Do not import.

## Tasks & Acceptance

**Execution:**
- [ ] `suite/schema.ts` and `schema.test.ts` -- Add optional `CaseRun.clock` with its refinement and tests. This is the `clock-leak` range source.
- [ ] `suite/rules/proactive-initiated.ts` -- Requires `window.outbound`. PASSes with at least one bot-initiated message.
- [ ] `suite/rules/proactive-spacing.ts` -- Requires `window.outbound`. Params `{ minGapMs }`, default 172800000 (48 h). Every pair of consecutive initiations, ordered by `occurredAt`, must be at least `minGapMs` apart.
- [ ] `suite/rules/proactive-working-hours.ts` -- Requires `window.outbound`. Params `{ timezone (IANA), fromHour: 9, toHour: 18 }`. Every initiation's local hour must be at least `fromHour` and below `toHour`. An invalid timezone fails at load.
- [ ] `suite/rules/clock-leak.ts` -- Requires `reply.messages`. Every `occurredAt` in `steps[].reply`, `unsolicited` and `window.outbound` must lie within `clock`.
- [ ] `suite/rules/effect-count.ts` -- Requires `events`. Params `{ port, method, step, expected }`. Counts `ok` events on that step.
- [ ] `suite/rules/state-equals.ts` -- Requires `state.<query>`. Params `{ query, at, expected }`, deep equality. `at` is `before`, `after` or `after-step:<n>`.
- [ ] `suite/rules/state-not-greater-than.ts` -- Requires `state.<query>`. Params `{ query, at, delta, max }`, where `max` is either an integer or `{ repliesWithMetadata: key }`. For P-09 ("new summaries not greater than seen"), `after − before` must not exceed the number of reply messages that carry `metadata[key] === true`.
- [ ] `suite/rules/<rule>.test.ts` -- At least one PASS, one FAIL and one NOT_OBSERVABLE per rule. Cover the I/O matrix; the registry `fail` fixture must FAIL.

**Acceptance Criteria:**
- Given the registry, when it is loaded, then it holds all 18 rules (3 wrapped, 8 from 12.3a, 7 here).
- Given a `window.outbound` whose messages lack `metadata.messageType`, when the proactive rules run, then they count no initiations, which surfaces a broken 12.7 contract as a FAIL or NOT_OBSERVABLE, never a PASS.
- Given an existing `CaseRun` without `clock`, when it is parsed, then it stays valid, so 12.1 and 12.2 fixtures need no change.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

These rules take params because `run` sees only `Pick<Criterion, 'id' | 'evaluatedAt'>`, not `stateQuery`. Story 12.2 synthesizes `effect-count` params from the manifest's `stateEffect`, with `step` set to the evaluated step.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: all suite tests pass offline.
- `pnpm --filter @entalent/conversation-sim typecheck` -- expected: no errors.
- `pnpm --filter @entalent/conversation-sim lint` -- expected: no errors.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: a passing JSON receipt; report its path.
