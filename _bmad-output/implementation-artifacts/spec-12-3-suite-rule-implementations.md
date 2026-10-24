---
title: 'Story 12.3a: Suite Rule Implementations — params validation and reply/turn rules'
type: 'feature'
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

**Problem:** The 12.1 registry holds only the three wrapped legacy rules. P-suite reply and turn criteria (FR6, FR24) cannot be decided yet, `RuleCheck.params` is never validated, and nothing stops product code from importing `suite/`.

**Approach:** Add 8 reply/turn rules, one file each under `suite/rules/`, keeping phrase lists as data. Give `RuleEntry` an optional params schema that the loader enforces, plus an optional `RuleContext` argument that carries seed history. Add an import-graph test. The proactive, clock and state/event rules are Story 12.3b.

## Boundaries & Constraints

**Always:**
- Rules follow the 12.1 `RuleEntry` shape and `selectReplies` semantics, ship `syntheticRun` `pass`/`fail` fixtures, and never branch on `run.level`.
- **Params:** a rule with no params schema rejects any params at load time.
- **`RuleContext`:** `RuleEntry.run(run, criterion, params?, context?: RuleContext)` with `RuleContext = { seedHistory: readonly SeedTurn[] }`. 12.2 supplies it; if 12.2 has not landed, define it in `rules/registry.ts` (the second story to land reuses it). Absent `context` equals empty `seedHistory`.
- **`cause-question-present`:** passes when the selected reply contains at least one question. The meaning companion judges whether the question is about the cause.
- **`no-two-replies-without-cause-question`:** applies `cause-question-present` to each pair of consecutive coach replies. The sequence is the coach turns in `context.seedHistory` followed by the run's replies. It FAILs on the first pair where neither reply has a question. With fewer than two coach replies it is NOT_OBSERVABLE `fewer-than-two-replies`.

**Never:**
- Change product code, `schema.ts` types, `ScenarioRunReport`, `gate.config.json` or `run-gate.ts`; implement `evaluate`/`score` (12.2) or proactive, clock, state or effect rules (12.3b); call models, read env or the wall clock; export a phrase list outside `suite/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Silence | `reply:1`, reply `null` | `reply-present` FAILs `no-reply (turn 1)` | N/A |
| Field not declared | `bundle-staged`, run lacks `reply.messages` | NOT_OBSERVABLE `unobservable:reply.messages[].metadata.v2ConfirmationBundle@L1` | N/A |
| Zero or two questions | `single-question` | FAIL with the questions found (`none` when zero) | N/A |
| Greeting mid-reply | "Thanks. Hi again…" | `no-greeting-restart` checks only the first sentence | N/A |
| No bundle outcome | turn present, `bundleReply` undefined | `answer-then-bundle` FAILs `bundleReply:none` | N/A |
| Seeded prior reply | P-08 atomic: seeded coach reply without a question, new reply without a question | `no-two-replies-without-cause-question` FAILs at turn 1 | N/A |
| No context | same run, `context` absent | NOT_OBSERVABLE `fewer-than-two-replies` | N/A |
| Bad params | `single-question` with `{ max: 2 }` | Load fails with `invalid-rule-params`, test id and Zod path | SuiteLoadError |

</frozen-after-approval>

## Code Map

- `packages/conversation-sim/src/suite/rules/registry.ts` -- `RuleEntry`, `RULES`, `RuleNameSchema`. Add optional `params` schema and `RuleContext`, then register the new rules.
- `.../suite/rules/{reply-selection,synthetic-run,too-many-questions}.ts` -- Reuse the selection helpers and the fixture builder as-is; `too-many-questions` is the pattern to follow.
- `.../suite/rules/repeated-question.ts` -- its transcript ignores the seed (open 12.1 item in `deferred-work.md`). Prepend `context.seedHistory` coach texts.
- `.../suite/loader.ts:199` `checkRules`, `:223` `checkL0` -- add params validation and the `invalid-rule-params` error code.
- `.../suite/schema.ts:190-199` -- `SeedTurn` (read only), plus `TurnTrace.bundleReply` and `fieldObserved`.
- `packages/conversation-sim/src/harness/assertions.ts:151,169` -- `extractQuestions` and `firstSentence`. Reuse, do not modify.
- `packages/application/src/use-cases/conversation-orchestrator.ts:1167,1395-1398` -- source of `bundleReply = 'answer_then_bundle'` and `metadata.v2ConfirmationBundle: true`. Read only.

## Tasks & Acceptance

**Execution:**
- [ ] `suite/rules/registry.ts` -- Add `params?: z.ZodType` and `RuleContext`, extend the `run` signature, and register 8 rules (11 total). Gives each rule typed params and seed access.
- [ ] `suite/loader.ts` -- In `checkRules`, parse `check.params` with the entry's schema and throw `invalid-rule-params` with the Zod path. Closes the 12.1 deferred params item.
- [ ] `suite/rules/terms/{internal-terms,greeting-phrases}.ts` -- Frozen data lists:
  - Internal terms: topic(s), index(es), pulse(s), cycle(s), matched as whole words, case-insensitive.
  - Greeting and self-introduction phrases: hi, hello, hey, good morning, "I'm your coach", "my name is".
- [ ] `suite/rules/{single-question,no-internal-terms,no-greeting-restart,cause-question-present,no-two-replies-without-cause-question}.ts` -- Reply-text rules; each requires `reply.text`.
- [ ] `suite/rules/reply-present.ts` -- Requires `reply.messages`, not `reply.text`, so it can decide P-01 at L0.
- [ ] `suite/rules/bundle-staged.ts` -- Requires `reply.messages[].metadata.v2ConfirmationBundle`. PASSes when any message of the selected reply has `true`.
- [ ] `suite/rules/answer-then-bundle.ts` -- Requires `turn.bundleReply`. PASSes when the selected step's value is `'answer_then_bundle'`.
- [ ] `suite/rules/repeated-question.ts` -- Include seeded coach texts from `context` in the comparison transcript.
- [ ] `suite/rules/registry.test.ts` and `suite/rules/<rule>.test.ts` -- Assert that every registry `fail` fixture FAILs and every `pass` fixture PASSes. Give each rule at least one PASS, one FAIL and one NOT_OBSERVABLE case, and cover the I/O matrix.
- [ ] `suite/isolation.test.ts` -- Scan `packages/*/src` and `apps/*/src`, excluding `conversation-sim`, for imports of `@entalent/conversation-sim` or any `suite/` path, and assert there are none.

**Acceptance Criteria:**
- Given the registry, when it is loaded, then it holds the 3 wrapped rules and the 8 new rules, each with `requires`, `pass` and `fail`.
- Given a rule check whose params do not match the rule's schema, when `validateSuite` runs, then it throws `invalid-rule-params` naming the test id and path.
- Given product packages and apps, when `isolation.test.ts` runs, then it finds no import of `suite/`.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: all suite tests pass offline.
- `pnpm --filter @entalent/conversation-sim typecheck` -- expected: no errors.
- `pnpm --filter @entalent/conversation-sim lint` -- expected: no errors.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: a passing JSON receipt; report its path.
