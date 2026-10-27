---
title: 'Story 12.3a: Suite Rule Implementations — params validation and reply/turn rules'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_commit: '53d21de8ca56a8b3abee2373460c93f6c8e58963'
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
- [x] `suite/rules/registry.ts` -- Add `params?: z.ZodType` and `RuleContext`, extend the `run` signature, and register 8 rules (11 total). Gives each rule typed params and seed access.
- [x] `suite/loader.ts` -- In `checkRules`, parse `check.params` with the entry's schema and throw `invalid-rule-params` with the Zod path. Closes the 12.1 deferred params item.
- [x] `suite/rules/terms/{internal-terms,greeting-phrases}.ts` -- Frozen data lists:
  - Internal terms: topic(s), index(es), pulse(s), cycle(s), matched as whole words, case-insensitive.
  - Greeting and self-introduction phrases: hi, hello, hey, good morning, "I'm your coach", "my name is".
- [x] `suite/rules/{single-question,no-internal-terms,no-greeting-restart,cause-question-present,no-two-replies-without-cause-question}.ts` -- Reply-text rules; each requires `reply.text`.
- [x] `suite/rules/reply-present.ts` -- Requires `reply.messages`, not `reply.text`, so it can decide P-01 at L0.
- [x] `suite/rules/bundle-staged.ts` -- Requires `reply.messages[].metadata.v2ConfirmationBundle`. PASSes when any message of the selected reply has `true`.
- [x] `suite/rules/answer-then-bundle.ts` -- Requires `turn.bundleReply`. PASSes when the selected step's value is `'answer_then_bundle'`.
- [x] `suite/rules/repeated-question.ts` -- Include seeded coach texts from `context` in the comparison transcript.
- [x] `suite/rules/registry.test.ts` and `suite/rules/<rule>.test.ts` -- Assert that every registry `fail` fixture FAILs and every `pass` fixture PASSes. Give each rule at least one PASS, one FAIL and one NOT_OBSERVABLE case, and cover the I/O matrix.
- [x] `suite/isolation.test.ts` -- Scan `packages/*/src` and `apps/*/src`, excluding `conversation-sim`, for imports of `@entalent/conversation-sim` or any `suite/` path, and assert there are none.

**Acceptance Criteria:**
- Given the registry, when it is loaded, then it holds the 3 wrapped rules and the 8 new rules, each with `requires`, `pass` and `fail`.
- Given a rule check whose params do not match the rule's schema, when `validateSuite` runs, then it throws `invalid-rule-params` naming the test id and path.
- Given product packages and apps, when `isolation.test.ts` runs, then it finds no import of `suite/`.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Review 1 (2026-10-25; Blind Hunter, Edge Case Hunter, Verification Gap):

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Quoted internal terms (`'topic'`, `‘pulse’`) not matched | medium | patch | Lookbehind `(?<![\p{L}\p{N}'])` rejects a leading quote; curly quotes normalize to `'`. |
| 2 | `no-greeting-restart` reads past the first message when it lacks end punctuation | low | patch | `firstSentence` splits only on `[.!?]\s`; joined text `Got it\n\nHello again!` is one sentence. |
| 3 | Registry test evidence check loosened for all rules; hidden early return for `reply-present` | low | patch | `\bturn N\b` replaced `^turn N — `; the early return passes without asserting. |
| 4 | `answer-then-bundle` / `bundle-staged` conversation scope untested with several steps | medium | patch | Verification-gap layer: all cases use one-step runs; `some` vs `every` indistinguishable. |
| 5 | Loader validates params but rules receive raw params (defaults/transforms lost) | maybe-false (medium if true) | defer | No 12.3a rule has a params schema; first schemas arrive in 12.3b. |
| 6 | Hyphenated compounds (`hi-fi`, `off-topic`) match | low | reject | Rare in coach replies; whole-word matching is what the spec asks for. |
| 7 | Seed history order not enforced in `no-two-replies-without-cause-question` | false | reject | Schema enforces chronological seed order (schema.ts:205-210). |
| 8 | Isolation test misses scripts/, `vi.mock`, package.json deps | low | reject | Intent covers product code; spec scans `packages/*/src` and `apps/*/src`. |
| 9 | Isolation `suite/` pattern could flag a product folder named `suite` | low | reject | None exists; failure would be loud, not silent. |
| 10 | `answer-then-bundle` ignores `bundleReply` on a silent step | low | reject | Not demonstrated reachable; orchestrator sets `bundleReply` only on replies. |
| 11 | `no-internal-terms` false positives on common words; no `indices` | false | reject | Frozen spec list: topic(s), index(es), pulse(s), cycle(s). |
| 12 | Greeting matched anywhere in the first sentence; phrase list incomplete | false | reject | Frozen spec: check the first sentence against the listed phrases. |
| 13 | Only the first Zod issue reported | low | reject | Spec asks for test id and Zod path; one issue suffices. |
| 14 | `cause-question-present` without a meaning judge passes any `?` | false | reject | Frozen spec: the meaning companion judges the cause; rule is the question gate. |
| 15 | Term-file docstrings claim isolation the test does not check inside conversation-sim | low | reject | Docstring wording; no harm demonstrated. |
| 16 | `hasQuestion` imported from another rule file | low | reject | Shared by design (spec: pair rule applies `cause-question-present`). |
| 17 | Task-log row / diff bookkeeping incomplete | low | patch | Fixed in bookkeeping (row rewritten with receipt). |

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: all suite tests pass offline.
- `pnpm --filter @entalent/conversation-sim typecheck` -- expected: no errors.
- `pnpm --filter @entalent/conversation-sim lint` -- expected: no errors.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: a passing JSON receipt; report its path.
