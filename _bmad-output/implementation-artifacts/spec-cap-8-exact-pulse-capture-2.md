---
title: 'CAP-8: Resolve exact message pulse capture'
type: 'bugfix'
created: '2026-09-19'
status: 'in-review'
review_loop_iteration: 2
baseline_commit: '64e5f55'
context:
  - '_bmad-output/implementation-artifacts/spec-cap-8-exact-pulse-capture.md'
  - '_bmad-output/specs/spec-generic-conversation-bug-backlog/bug-catalog.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CAP-8 can identify a pulse-capture question but cannot preserve which earlier employee message the question names. The repository therefore returns conversation-wide evidence, and a follow-up can fall back to generation and contradict the persisted source-of-truth status.

**Approach:** Extend the existing typed classification with an exact prior-employee-message reference, resolve it only against owned recent inbound turns, and pass the resolved source message ID through the existing provenance lookup. Persist only the selected message ID as a reply receipt so an explicitly scoped follow-up can re-read current database truth without reusing a cached status.

## Boundaries & Constraints

**Always:** Keep safety precedence; tenant/user/conversation ownership; read-only CAP-8 behavior; exact source-message provenance; and deterministic localized rendering. An exact-message request must return only evidence containing that source ID. Unresolved or ambiguous references fail closed and never widen to all conversation evidence. Re-read lifecycle status from PostgreSQL on every turn.

**Ask First:** Any schema migration; change to retention, confirmation/reporting semantics, or manager visibility; commit, push, production deploy, user reset, or Slack payload.

**Never:** Add a phrase-specific onboarding regex, another model call, free-form status generation, fuzzy cross-user lookup, cached lifecycle status, or changes to retired MAF/`agent-service`. Do not change CAP-9 without a genuine sub-two-second reproduction.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Named captured message | Several earlier messages have evidence; the request identifies the onboarding message | Return only onboarding evidence and its current status; save selected source ID | No unrelated summaries |
| Named absent message | Target resolves, but only other messages have evidence | State that this exact message has no current persisted pulse evidence | Do not widen to conversation scope |
| Multi-source row | Evidence cites A and B; final prompt provenance cites only B; user asks for A | Return A-linked evidence as temporary, not confirmed | Final status requires target-specific provenance |
| Scoped follow-up | Prior CAP-8 reply saved target A; next typed CAP-8 correction/reference still means A | Resolve A and re-read the same DB-backed status | No generative fallback or stale status |
| Unresolved or ambiguous | Typed reference matches zero or multiple owned prior inbound messages | Ask the employee to identify/quote the message | No evidence disclosure |
| Conversation-wide request | No specific prior message is named | Preserve existing conversation-wide CAP-8 response | Existing behavior remains compatible |
| Safety plus CAP-8 | Same turn contains a safety signal | Safety response wins | No provenance lookup or survey mutation |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/ai.ts` -- discriminated CAP-8 scope in `SituationClassification`: conversation, indexed message, previous exact receipt, or unresolved.
- `packages/ai-openai/src/prompts/classify.ts`, `packages/ai-openai/src/openai-provider.ts` -- label transcript turns, emit typed scope, and force deterministic conversation scope for the existing explicit conversation-wide matcher.
- `packages/application/src/ports/survey.repository.port.ts` -- optional exact source-message scope for the existing read contract.
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- owned target resolution, receipt carry-over, deterministic routing, and outbound target metadata.
- `apps/worker/src/survey/repositories/survey.repository.ts` -- target-scoped evidence and target-specific final provenance.
- `apps/worker/src/conversation/repositories/conversation.repository.ts` -- exclude soft-deleted messages before classification and target resolution.
- `packages/application/src/utils/reporting-disclosure.ts` -- distinct exact-absent and unresolved copy.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/ai.ts`, `packages/contracts/src/ai.test.ts` -- define and validate an explicit discriminated CAP-8 scope; missing or malformed CAP-8 scope must not mean conversation-wide.
- [x] `packages/ai-openai/src/prompts/classify.ts`, `packages/ai-openai/src/openai-provider.ts`, `packages/ai-openai/src/openai-provider.test.ts` -- label source turns, classify named/current/previous/unresolved scope, and keep explicit conversation-wide normalization authoritative.
- [x] `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- add RED coverage for named-message selection, exact absence, unresolved scope, missing/stale/intervening receipt, request-style follow-up, conversation-wide correction, and safety metadata suppression.
- [x] `packages/application/src/ports/survey.repository.port.ts`, `packages/application/src/use-cases/conversation-orchestrator.ts`, `packages/application/src/utils/reporting-disclosure.ts` -- resolve only indexed owned prior inbound targets, carry only explicitly requested prior-exact scope, persist no CAP-8 receipt on safety, and never widen unresolved scope.
- [x] `apps/worker/src/survey/repositories/survey.repository.ts`, `apps/worker/src/survey/repositories/survey.repository.test.ts` -- constrain exact lookups and final provenance by a non-empty target ID while preserving conversation-wide behavior.
- [x] `apps/worker/src/conversation/repositories/conversation.repository.ts`, `apps/worker/src/conversation/repositories/conversation.repository.test.ts` -- keep soft-deleted rows out of recent conversation context and exact-target resolution.

**Acceptance Criteria:**
- Given the reproduced production shape with unrelated evidence plus one onboarding evidence row, when the employee asks for that exact message's status and follows up, then both replies contain only the onboarding result, agree with PostgreSQL truth, call no response generator, and create no survey/report mutation.
- Given an exact target with no linked evidence, when CAP-8 is requested, then the reply reports exact-message absence without listing other conversation evidence.
- Given a specific target that cannot be resolved uniquely, when CAP-8 is requested, then the response asks for identification and discloses no evidence.

**Production Acceptance:**
- [ ] After separately approved commit/push/deploy, run preflight and one sequential real Slack exact-message request plus previous-exact follow-up, then verify PostgreSQL and both queues.

## Spec Change Log

- Iteration 1 — Blind/edge review found that nullable copied text conflated conversation-wide and unresolved named requests, broke on sanitized/duplicate text, allowed missing receipts to widen scope, and exposed soft-deleted history to target resolution. Replaced the non-frozen implementation plan with a discriminated scope and stable labeled turn index; required explicit previous-receipt scope, fail-closed missing/stale receipts, safety receipt suppression, and deleted-message filtering. This avoids unrelated evidence disclosure and stale-target carry-over. KEEP: target-specific PostgreSQL status re-read, exact-absent/unresolved localized copy, safety precedence, no phrase-specific regex, no extra model call, no schema migration, and unchanged conversation-wide CAP-8 behavior.
- Iteration 2 — Fresh blind/edge review tightened mixed CAP-8 reminders: preserve only a model reminder backed by explicit EN/RU/UK reminder language, keep typed quoted-message scope, demote non-reminder mixed actions, acknowledge newly created and sequentially deduplicated reminders without generation, and reject a previous-exact receipt delivered before its source. The broader scheduled-action insert/queue atomicity boundary is recorded separately in `deferred-work.md`.

## Design Notes

The classifier receives JSON-serialized turns with one shared 15-turn limit and emits one explicit scope: `conversation`, `message` with a prior turn index, `previous_exact`, or `unresolved`. Application code maps a message index only to a UUID-valued owned, non-deleted, prior inbound row. A surviving CAP-8 intent always stays on the deterministic database-backed path; a typed reminder backed by explicit reminder language remains available to reminder scheduling instead of forcing free-form pulse status generation.

`previous_exact` requires the immediately preceding owned outbound reply to have been delivered before the current inbound, remain in the same delivery-time session, and reference a UUID-valued owned inbound row still present in recent non-deleted history. Missing, stale, corrupt, undelivered, intervening, or foreign receipts remain unresolved. The stored receipt is an ID, not evidence or status, so PostgreSQL remains authoritative for lifecycle state.

Exact SQL uses `<= beforeOccurredAt` only after application code has resolved a concrete prior source ID; conversation-wide reads retain `< beforeOccurredAt`. Final exact status intentionally requires singleton final provenance `[target]`: mixed provenance stays temporary rather than letting a confirmation involving another source upgrade this target.

## Verification

**Commands:**
- `pnpm --filter @entalent/contracts exec vitest run src/ai.test.ts` -- 45/45 passed after observed RED.
- `pnpm --filter @entalent/ai-openai exec vitest run src/prompts/classify.test.ts src/openai-provider.test.ts` -- 109/109 passed after observed RED.
- `pnpm --filter @entalent/application exec vitest run src/use-cases/conversation-orchestrator.test.ts` -- 208/208 passed after observed RED.
- `pnpm --filter @entalent/worker exec vitest run src/survey/repositories/survey.repository.test.ts src/conversation/repositories/conversation.repository.test.ts` -- 30/30 passed after observed RED.
- Full package suites: contracts 99/99, AI provider 173/173, application 577/577, worker 185/185.
- Package-scoped typecheck and lint for `@entalent/contracts`, `@entalent/application`, `@entalent/ai-openai`, and `@entalent/worker` -- passed.
- Harness: `pnpm harness:check -- --base 64e5f55` -- passed; receipt `runs/harness/receipt-1789854730527-25d2cc9b.json`.
- After separately approved commit/push/deploy: `pnpm harness:preflight`, then sequential real Slack exact-message and follow-up smoke with DB/queue read-back.
