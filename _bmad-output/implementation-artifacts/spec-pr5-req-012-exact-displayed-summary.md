---
status: done
baseline_commit: 0f8401d9aca6fd42e2cca17cd60156982721b486
---

# PR 5 REQ-012 — Exact Displayed Confirmation Summary

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Phase A shows an LLM-generated confirmation reply, while Phase B and reporting use an earlier mutable `aiSummary`. The employee can therefore confirm text they never saw, and an undelivered prompt can already become confirmable.

**Approach:** Make response generation return a typed reportable `confirmationSummary` that appears verbatim in the outbound reply. Use the existing outbound message as the immutable display and delivery receipt, bind the group state to that message, activate confirmation only after channel delivery, and persist/report the bound summary only after a later inbound agreement.

## Boundaries & Constraints

**Always:** Keep durable decisions in TypeScript and PostgreSQL; preserve tenant, user, conversation, window, group, direction, deletion, delivery, and timestamp provenance; use an outbound message ID as the candidate-version identity; apply RED-GREEN TDD; fail closed when summary or receipt proof is missing or inconsistent.

**Ask First:** Adding a new table or dependency; changing production data outside a forward migration; invoking a live model, Slack, deployment, commit, or push.

**Never:** Treat the whole conversational reply as reportable text; set `awaiting_confirmation` before delivery; fall back to legacy `aiSummary`; add a parallel runtime or hardcoded language-specific confirmation; fold correction rewriting, exclusion, cohort scope, or report outbox delivery into this slice.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Exact display | Confirmation response contains a non-empty typed summary | Summary is present byte-for-byte in persisted outbound text and linked to its message ID | Missing or non-verbatim summary rejects generation and leaves state non-confirmable |
| Delivery | Linked outbound succeeds or fails at the channel | Success moves matching pending state to awaiting; failure does not | Wrong, deleted, cross-scope, or stale message cannot activate state |
| Agreement | Delivered outbound predates the exact inbound agreement | Interpreter and confirmed state use the linked displayed summary | Undelivered or equal/later delivery time fails closed |
| Retry/order | Old delivery or duplicate confirmation arrives after state changed | CAS leaves the current state unchanged and emits at most one report job | No fallback to an older candidate |
| Reporting | Confirmed state has complete display and agreement proof | Reporting receives only the confirmed displayed summary | Legacy unproven rows are excluded |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/ai.ts` and `packages/application/src/ports/ai-provider.port.ts` — typed generated summary and confirmation context.
- `packages/ai-openai/src/prompts/respond.ts` and `packages/ai-openai/src/openai-provider.ts` — JSON instruction plus one bounded retry for the verbatim invariant.
- `packages/application/src/use-cases/conversation-orchestrator.ts` — Phase A staging and Phase B interpretation/confirmation.
- `packages/application/src/use-cases/survey-evidence.use-case.ts` — stop creating a second unseen summary.
- `packages/application/src/ports/survey.repository.port.ts` and `packages/application/src/types/records.ts` — narrow stage, receipt, and confirm contracts.
- `packages/database/src/schema/survey-group-states.ts` and a forward migration — outbound receipt pointer and database invariants.
- `apps/worker/src/conversation/repositories/conversation.repository.ts` and `apps/worker/src/survey/repositories/group-state.repository.ts` — delivery activation and confirmation CAS.
- `packages/application/src/use-cases/group-report.use-case.ts` — consume a confirmed reportable projection.
- Existing package, worker, database, prompt, and simulation tests/fakes — regression coverage.

## Tasks & Acceptance

**Execution:**

- [x] Add the optional wire field and enforce it only for confirmation mode, including one corrective provider generation.
- [x] Persist the typed summary in outbound metadata, stage its message pointer while remaining pending, and remove the unseen group-summary model call.
- [x] Activate only a matching delivered receipt; load awaiting candidates through that receipt; atomically confirm the exact summary after a later scoped inbound message.
- [x] Make reporting consume a proof-backed `reportableSummary`, excluding legacy rows without the outbound receipt.
- [x] Add a forward migration and deterministic RED tests for missing/non-verbatim summary, failed/stale delivery, mutable legacy summary, timestamp ordering, retry, and report projection.

**Acceptance Criteria:**

- Given a generated candidate differs from the old `aiSummary`, when its outbound is delivered and the employee later agrees, then the exact typed/displayed candidate is confirmed and supplied to reporting.
- Given no successful matching delivery, when an inbound looks like agreement, then no state is confirmed and no report job is queued.
- Given retries, stale delivery, mutation, deletion, scope mismatch, or equal timestamps, when CAS operations run, then they cannot authorize or replace the current candidate.

## Design Notes

`messages.id` is already a unique immutable version identity, `messages.text` carries display evidence, and `messages.sent_at` carries delivery evidence. The new group-state FK is only the current pointer. The reportable substring lives in outbound metadata until confirmation and is copied into the existing physical `ai_summary` column only by the confirmation CAS; no duplicate summary column, hash, event bus, or version counter is needed.

## Verification

**Commands:**

- `pnpm --filter @entalent/contracts test`
- `pnpm --filter @entalent/ai-openai test`
- `pnpm --filter @entalent/application test`
- `pnpm --filter @entalent/worker test`
- `pnpm test:integration`
- `pnpm typecheck`
- `pnpm lint`
- `git diff --check`

## Suggested Review Order

**Generated candidate contract**

- Typed substring separates reportable content from conversational framing.
  [`ai.ts:234`](../../packages/contracts/src/ai.ts#L234)

- One bounded retry enforces exact substring and confirmation-question shape.
  [`openai-provider.ts:84`](../../packages/ai-openai/src/openai-provider.ts#L84)

- Orchestrator stages only a validated persisted outbound candidate.
  [`conversation-orchestrator.ts:393`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L393)

**Delivery and confirmation proof**

- Sender validates persisted route and text before recording delivery.
  [`message-send.processor.ts:37`](../../apps/worker/src/message-send/message-send.processor.ts#L37)

- Stage, delivery, transition, and confirmation use message-bound CAS checks.
  [`group-state.repository.ts:130`](../../apps/worker/src/survey/repositories/group-state.repository.ts#L130)

- Migration adds the outbound pointer and one-active-candidate invariant.
  [`0011_whole_hex.sql:1`](../../packages/database/migrations/0011_whole_hex.sql#L1)

**Reporting boundary and tests**

- Confirmed reads expose only proof-backed reportable summaries.
  [`group-state.repository.ts:300`](../../apps/worker/src/survey/repositories/group-state.repository.ts#L300)

- Application regression covers exact staged and confirmed summary behavior.
  [`conversation-orchestrator.test.ts:423`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L423)

- PostgreSQL regression covers disclosure and displayed-summary constraints.
  [`reporting-disclosure.integration.test.ts:1`](../../packages/database/src/__tests__/reporting-disclosure.integration.test.ts#L1)
