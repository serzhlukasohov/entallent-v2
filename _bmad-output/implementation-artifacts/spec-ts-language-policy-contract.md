---
title: 'TypeScript Language Policy Contract'
type: 'bugfix'
created: '2026-08-18'
status: 'done'
review_loop_iteration: 0
baseline_commit: '5291cea86f9b5897cf7dae56dd35bfe764fd47b1'
context:
  - '{project-root}/docs/architecture/conversation-dialogue.md'
  - '{project-root}/docs/adr/ADR-011-mentor-companion-dialogue.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On a clean Slack user, `users.locale` defaults to `en`, and the response prompt hardcodes `Write in English`, so Russian inbound messages receive English replies even while MAF is disabled. This breaks the mentor-companion conversation feel and makes the TS runtime ignore the employee's current language.

**Approach:** Add a small TypeScript-owned `LanguagePolicy` to the response context and make the prompt follow that policy instead of hardcoded English. Resolve language from the current user turn first, then recent user turns, then tenant/profile default; keep the detector minimal and replaceable, but make the contract explicit.

## Boundaries & Constraints

**Always:** TypeScript owns the language decision; the model only follows `responseLanguage`. Current inbound turn outranks stored profile locale. Existing `ReplyPlan` and dialogue policy remain the semantic conversation contract. The change must work with MAF disabled and must not route language policy through Python.

**Ask First:** Persisting locale back to the `users` table, adding a model-based language classifier, adding new language coverage beyond simple Latin/Cyrillic detection, or changing Slack profile hydration behavior.

**Never:** Do not re-enable MAF. Do not implement prompt-only "guess the user's language" behavior. Do not add keyword/phrase-based conversation gates. Do not add a new service or dependency for this bug.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Russian clean start | Latest inbound text is `Привет`; stored locale/default is `en` | `ResponseContext.languagePolicy.responseLanguage` is `ru`; response prompt tells the model to write in Russian | N/A |
| Russian substantive turn after English default | Latest inbound text is Russian Atlas-9 concern; stored locale is `en` | Language policy remains `ru`; prompt does not include hardcoded `Write in English` | N/A |
| Ambiguous short turn | Latest inbound is `ok` or punctuation; recent user turns are Russian | Recent user turns choose `ru`; otherwise fall back to `en` | N/A |
| No user text | Proactive/follow-up generation has no current inbound turn | Fall back to recent user turns, then default `en` | N/A |

</frozen-after-approval>

## Code Map

- `packages/application/src/ports/ai-provider.port.ts` -- Owns `ResponseContext`; add the typed `LanguagePolicy`.
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- Builds turns and response context; resolve `languagePolicy` before `generateResponse`.
- `packages/ai-openai/src/prompts/respond.ts` -- Replace hardcoded English instruction with `context.languagePolicy.responseLanguage`.
- `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- Covers TS policy selection from current/recent user turns.
- `packages/ai-openai/src/prompts/respond.test.ts` -- Covers prompt output for selected language and absence of hardcoded English.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/ports/ai-provider.port.ts` -- Add `LanguagePolicy` and `ResponseContext.languagePolicy` -- Makes the contract explicit at the AI boundary.
- [x] `packages/application/src/use-cases/conversation-orchestrator.ts` -- Add minimal resolver and pass its result to `generateResponse` -- Keeps the decision in TS where turns are already available.
- [x] `packages/ai-openai/src/prompts/respond.ts` -- Use the policy in the length/language instruction -- Removes the root hardcoded English behavior.
- [x] `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- Assert Russian current turn beats English default and ambiguous current turn uses recent Russian context -- Prevents regression in the TS policy.
- [x] `packages/ai-openai/src/prompts/respond.test.ts` -- Assert prompt says Russian when policy is `ru` and does not include `Write in English` for that case -- Prevents prompt regression.

**Acceptance Criteria:**
- Given a clean user whose stored locale/default is English, when the latest inbound message contains Russian Cyrillic text, then the response context sent to the AI provider contains `languagePolicy.responseLanguage = 'ru'`.
- Given an ambiguous latest user message and recent Russian user turns, when the orchestrator builds the response context, then the language policy uses recent turns instead of falling back to English.
- Given `ResponseContext.languagePolicy.responseLanguage = 'ru'`, when `buildRespondSystemPrompt` renders, then the prompt instructs the model to write in Russian and does not contain the old hardcoded `Write in English`.
- Given MAF feature flags remain disabled, when this bugfix runs, then no Python runtime path is required or enabled.

## Spec Change Log

## Design Notes

The detector can stay intentionally small: Cyrillic letters imply `ru`; Latin letters imply `en`; text without letters is ambiguous. The important architecture is the typed policy location and precedence, not exhaustive language identification.

## Verification

**Commands:**
- `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts` -- expected: language policy and existing orchestrator tests pass.
- `pnpm --filter @entalent/ai-openai test -- respond.test.ts` -- expected: prompt tests pass.
- `pnpm --filter @entalent/application typecheck` -- expected: no TS errors.
- `pnpm --filter @entalent/ai-openai typecheck` -- expected: no TS errors.

## Suggested Review Order

**Policy Contract**

- Start with the TS-owned language decision and precedence.
  [`language-policy.ts:5`](../../packages/application/src/utils/language-policy.ts#L5)

- Review locale validation and ambiguity rules.
  [`language-policy.ts:49`](../../packages/application/src/utils/language-policy.ts#L49)

- Confirm the AI boundary requires the policy.
  [`ai-provider.port.ts:84`](../../packages/application/src/ports/ai-provider.port.ts#L84)

**Runtime Wiring**

- Check inbound Slack replies receive the policy before rendering.
  [`conversation-orchestrator.ts:279`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L279)

- Check proactive reminders preserve profile locale context.
  [`follow-up-context.repository.ts:102`](../../apps/worker/src/followup/repositories/follow-up-context.repository.ts#L102)

- Check follow-up conversation lookup is tenant/user scoped.
  [`follow-up-context.repository.ts:42`](../../apps/worker/src/followup/repositories/follow-up-context.repository.ts#L42)

**Prompt Rendering**

- Confirm the prompt consumes the typed language.
  [`respond.ts:10`](../../packages/ai-openai/src/prompts/respond.ts#L10)

- Confirm hardcoded English was removed.
  [`respond.ts:113`](../../packages/ai-openai/src/prompts/respond.ts#L113)

**Regression Coverage**

- Russian clean-start and ambiguous-turn regressions.
  [`conversation-orchestrator.test.ts:154`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L154)

- Product-token, Ukrainian, and unknown-locale regressions.
  [`conversation-orchestrator.test.ts:197`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L197)

- Prompt-level Russian rendering guard.
  [`respond.test.ts:93`](../../packages/ai-openai/src/prompts/respond.test.ts#L93)
