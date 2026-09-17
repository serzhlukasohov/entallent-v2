---
title: 'CAP-2: Session-scoped concise replies'
type: 'bugfix'
created: '2026-09-17'
status: 'done'
review_loop_iteration: 1
baseline_commit: '994f179'
context:
  - '_bmad-output/specs/spec-generic-conversation-bug-backlog/bug-catalog.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In D01-02 the coach acknowledges “Keep it short” but later replies in the same active conversation become long again. The current strategy only shortens for high urgency or a learned terse profile; an explicit temporary request has no session-scoped structural state.

**Approach:** Recognize a narrow explicit concise directive on the latest owned inbound message, persist only a boolean session decision in existing outbound `replyShape` metadata, and reapply `maxResponseLength='short'` until the existing five-hour session boundary expires. Do not change the learned style profile or add persistence.

## Boundaries & Constraints

**Always:** Keep crisis, sensitive, and confirmation behavior authoritative. Preserve the substantive request and existing follow-up-question policy; CAP-2 changes length only. Carry the temporary decision through the latest outbound metadata so it survives the twenty-message read window, and clear carryover after `SESSION_GAP_HOURS`. Match only direct EN/RU/UK concise imperatives, ignoring the exact trailing Slack connector attribution for matching. Persist no raw directive text.

**Ask First:** Any database/schema change, durable user preference, learned-profile mutation, new response-length tier, production payload, commit, push, or deploy.

**Never:** Infer a preference merely from terse wording, quoted/translated/evaluated text, descriptive mentions, or a negated instruction. Do not consume the user’s actual request as style-only content. Do not touch retired MAF or `agent-service`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Direct request | “Hey, busy day. Keep it short today.” with no terse profile | Current ordinary strategy is `short`; outbound metadata records session concise mode | Generation keeps its existing question allowance |
| Same session | Later substantive turns within five hours | Every outbound remains `short`, including after more than twenty messages | Latest outbound metadata carries the boolean forward |
| New session | Next inbound follows a gap greater than five hours | Temporary carryover is cleared; normal urgency/profile rules decide length | No profile rollback is needed |
| Existing terse profile | Learned terse profile already qualifies | Existing short length and alternating-question behavior remain unchanged | CAP-2 must not duplicate or weaken profile logic |
| Safety/confirmation | Concise directive accompanies sensitive, crisis, or confirmation handling | Existing safety/confirmation strategy wins | The session flag may carry to the next ordinary turn |
| Controls | Translation, quotation, chatbot evaluation, descriptive mention, or “don’t keep it short” | No new concise session decision is activated | Existing session state is otherwise unchanged |
| Mixed substance | A real question or disclosure also says “keep it short” | Answer the substance using the short tier | Do not replace the content intent |
| Slack transport | Direct request ends with exact `*Sent using* <@...>` attribution | Match as the same direct request | Strip only the trailing connector suffix for matching |

</frozen-after-approval>

## Code Map

- `packages/application/src/use-cases/conversation-orchestrator.ts` -- builds reply strategy, reads/writes `replyShape`, and owns current-session orchestration.
- `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- focused RED→GREEN coverage for strategy, metadata carryover, controls, and profile non-mutation.
- `packages/application/src/utils/session.ts` -- existing five-hour session boundary; reuse without changing its duration.
- `packages/ai-openai/src/openai-provider.ts` -- already enforces the short-tier hard length ceiling; no change expected.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- add failing D01-02 tests for immediate short selection, same-session carry, >20-turn carry, five-hour expiry, controls, safety precedence, and unchanged learned profile/question pacing.
- [x] `packages/application/src/use-cases/conversation-orchestrator.ts` -- add the narrow directive matcher, derive active session state from the latest outbound metadata plus the current inbound, apply only the short length override to ordinary modes, and persist the boolean in `replyShape`.
- [x] `_bmad-output/specs/spec-generic-conversation-bug-backlog/bug-catalog.md` -- update CAP-2 evidence only after local and production verification.

**Acceptance Criteria:**
- Given an ordinary low-urgency turn with a direct concise request, when the reply strategy is built, then `maxResponseLength` is `short` without changing the stored style profile or question allowance.
- Given a recorded concise decision and later turns in the same session, when replies are generated, then the short tier remains active even after the original inbound leaves the recent-message window.
- Given a gap greater than five hours, when the next turn is handled, then CAP-2 carryover is absent and existing urgency/profile behavior is restored.
- Given safety, confirmation, control text, or a mixed substantive request, when CAP-2 is evaluated, then precedence and content intent remain correct.

### Review Findings

- [x] [Review][Patch] Add complete-but-condensed deterministic privacy/reporting variants for explicit concise sessions [packages/application/src/utils/reporting-disclosure.ts:11]
- [x] [Review][Patch] Bind carried concise state to the receipt timestamp and ignore unrelated outbound metadata [packages/application/src/use-cases/conversation-orchestrator.ts:203]
- [x] [Review][Patch] Reject multiline translation and quotation payloads as concise directives [packages/application/src/use-cases/conversation-orchestrator.ts:1193]
- [x] [Review][Patch] Recognize direct English adverb forms such as `reply briefly` and `respond concisely` [packages/application/src/use-cases/conversation-orchestrator.ts:1196]
- [x] [Review][Defer] Serialize overlapping same-conversation jobs so a later job cannot race a not-yet-persisted concise receipt [packages/application/src/use-cases/conversation-orchestrator.ts:76] — deferred, pre-existing CAP-9 turn-admission concern

## Spec Change Log

- 2026-09-17: Review iteration 1 closed four CAP-2 patches; concurrent turn serialization remains deferred to CAP-9.

## Design Notes

Reuse `replyShape` because it is already the privacy-safe durable decision receipt read on the next turn. Rewriting the boolean on every outbound avoids a new table and makes the latest outbound sufficient; `isSessionStart` provides the expiry boundary. The explicit directive changes only `maxResponseLength`, unlike learned terse style, which also controls question alternation.

## Verification

**Commands:**
- `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts` -- exact CAP-2 RED→GREEN and full orchestrator regression pass.
- `pnpm --filter @entalent/application typecheck && pnpm --filter @entalent/application lint` -- affected package compiles and lints.
- `pnpm harness:check -- --base 994f179` -- passed with `runs/harness/receipt-1789642310583-6becbffd.json`.
- Pre-push harness `runs/harness/receipt-1789642438781-681e72e7.json` and connector preflight `runs/harness/receipt-1789642558801-3b8f8ac7.json` passed.
- Commit `d355935` was pushed to `origin/codex/grill-session-docs`; production worker deployment `76816045-4cf9-47a5-8219-e3d3083c9a0c` reached `SUCCESS`.
- Sequential Slack control/direct/follow-up in `D0BJDC2MPE2` produced exactly one reply per inbound at `1789642621.820509`, `1789642644.148429`, and `1789642689.333759`; the direct and follow-up replies were 14 and 27 words, and a delayed read found no duplicate.
- Production readback persisted `replyShape.conciseSession=false,true,true`, one outbound per inbound, and `success` conversation runs. All three conversation jobs and all three message-send jobs were retained as `completed` with one attempt.
- The independent style-analysis queue advanced `user_style_profiles.updated_at` after the smoke, so production timestamp comparison is not an immutability proof; the focused regression instead proves the CAP-2 orchestrator never calls `styleProfileRepo.upsert`.
- Documentation closeout harness passed with `runs/harness/receipt-1789643279454-e434a584.json`.
