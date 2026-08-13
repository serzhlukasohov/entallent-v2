---
title: 'Remove Remaining Behavioral Text Heuristics'
type: 'refactor'
created: '2026-08-13'
status: 'done'
baseline_commit: 'a2630424536f2b07134bdc535e8d4950007d13e7'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-remove-runtime-reply-text-heuristics.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Some reply-planning behavior still derives typed state from reply prose, most visibly detecting whether the previous assistant reply asked a question by scanning for `?`. That keeps migrated MAF behavior partly tied to surface text instead of durable reply metadata.

**Approach:** Persist typed reply-shape metadata when an outbound reply is created, and read that metadata for future reply planning. Keep safety/security/validation text guards, but do not use generated prose as the source of behavioral reply policy when typed metadata is available or can be produced.

## Boundaries & Constraints

**Always:** Preserve safety checks, secret redaction, Slack connector cleanup, event id validation, and schema validation. Preserve current typed `replyPlan` policy behavior and deterministic renderers. Keep legacy messages without metadata conservative instead of inferring from text.

**Ask First:** Removing classifier/risk logic, changing database schema, deleting survey evidence extraction, or weakening proactive probe-sent accounting.

**Never:** Do not add new phrase or punctuation gates for tone. Do not parse outgoing prose to decide future `replyPlan` behavior. Do not rely on old TS fallback behavior for MAF primary correctness.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New outbound reply | Orchestrator saves a reply with typed `replyPlan.questionPolicy.maxQuestions=1` | Message metadata records that the reply was allowed to ask a question | No extra failure mode; metadata remains best-effort with save |
| Next inbound reply planning | Previous outbound metadata says `replyShape.askedQuestion=true` | `buildReplyPlan` receives `lastReplyAskedQuestion=true` without reading punctuation from text | Malformed metadata is treated as unknown/false |
| Legacy outbound reply | Previous outbound has text ending in `?` but no reply-shape metadata | Reply planning does not infer a question from prose | Existing reply generation continues; only text-derived pacing is removed |

</frozen-after-approval>

## Code Map

- `packages/application/src/ports/ai-provider.port.ts` -- typed reply plan contract used to derive reply-shape metadata.
- `packages/application/src/types/records.ts` -- persisted message metadata shape exposed to application code.
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- TS runtime reply planning and outbound message persistence.
- `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- coverage for metadata-owned previous-question detection.
- `apps/worker/src/conversation/conversation.processor.ts` -- MAF worker context builder and `lastReplyAskedQuestion` source.
- `apps/worker/src/conversation/conversation.processor.test.ts` -- coverage for worker MAF context metadata use.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/types/records.ts` -- Add typed message reply-shape metadata fields so callers do not use raw `Record` access for behavioral state.
- [x] `packages/application/src/use-cases/conversation-orchestrator.ts` -- Save reply-shape metadata from `replyPlan` and read previous-question state only from metadata.
- [x] `apps/worker/src/conversation/conversation.processor.ts` -- Select message metadata for recent turns and compute previous-question state from metadata only.
- [x] `packages/application/src/use-cases/maf-primary-agent-runtime.ts` -- Persist reply-shape metadata from MAF `replyPlan` or `replyPolicy`.
- [x] `packages/application/src/use-cases/proactive-check-in.use-case.ts` -- Persist reply-shape metadata from legacy proactive typed strategy.
- [x] `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- Assert metadata is persisted and legacy text punctuation is ignored without metadata.
- [x] `apps/worker/src/conversation/conversation.processor.test.ts` -- Assert worker passes `asked_recently` only from outbound metadata.

**Acceptance Criteria:**
- Given an outbound reply created with a typed reply plan, when it is saved, then metadata includes typed reply-shape data derived from the plan.
- Given the previous assistant message has `replyShape.askedQuestion=true`, when a new reply plan is built, then `questionPolicy.reason` can become `asked_recently`.
- Given the previous assistant message only has a `?` in text and no reply-shape metadata, when a new reply plan is built, then punctuation does not drive `asked_recently`.

## Verification

**Commands:**
- `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts reply-plan.test.ts` -- passed.
- `pnpm --filter @entalent/worker test -- conversation.processor.test.ts` -- passed.
- `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts reply-plan.test.ts maf-primary-agent-runtime.test.ts proactive-check-in.use-case.test.ts` -- passed.
- `pnpm --filter @entalent/application typecheck` -- passed.
- `pnpm --filter @entalent/worker typecheck` -- passed.
- `pnpm --filter @entalent/application lint` -- passed.
- `pnpm --filter @entalent/worker lint` -- passed.

## Spec Change Log

- Review finding: worker recent rows are loaded newest-first, but an early helper reversed before selecting the outbound message.
  Amendment: kept the metadata-only approach and changed worker selection to use the first outbound row in DB order, with a two-outbound regression test.
  Avoids: applying stale older `replyShape` to the current inbound planning turn.
  KEEP: no fallback to parsing `?` from assistant prose.
- Review finding: proactive MAF and legacy proactive replies could save no `replyShape`, hiding agent-initiated questions from the next inbound planner.
  Amendment: MAF primary now persists `replyShape` from `replyPolicy` when no `replyPlan` exists; legacy proactive persists it from typed `ReplyStrategy`.
  Avoids: duplicate follow-up question pacing after proactive check-ins.
  KEEP: metadata is derived from typed policy/strategy, not generated text.

## Review Triage

- `patch`: Blind Hunter found worker outbound ordering could read stale metadata. Fixed by using newest-first row order directly and covering older outbound rows in `conversation.processor.test.ts`.
- `patch`: Edge Case Hunter found proactive MAF replies without `replyPlan` lacked `replyShape`. Fixed by deriving `replyShape` from typed `replyPolicy`.
- `patch`: Edge Case Hunter found legacy TS proactive replies lacked `replyShape`. Fixed by deriving `replyShape` from typed `ReplyStrategy`.

## Suggested Review Order

**Reply Pacing Source**

- Previous-question pacing now reads typed metadata, not reply punctuation.
  [`conversation-orchestrator.ts:265`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L265)

- Worker MAF context preserves newest-first outbound metadata ordering.
  [`conversation.processor.ts:703`](../../apps/worker/src/conversation/conversation.processor.ts#L703)

**Metadata Producers**

- TS orchestrator persists reply-shape metadata with outbound replies.
  [`conversation-orchestrator.ts:296`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L296)

- MAF primary persists reply-shape from replyPlan or replyPolicy.
  [`maf-primary-agent-runtime.ts:481`](../../packages/application/src/use-cases/maf-primary-agent-runtime.ts#L481)

- Legacy proactive persists reply-shape from typed strategy.
  [`proactive-check-in.use-case.ts:121`](../../packages/application/src/use-cases/proactive-check-in.use-case.ts#L121)

**Contract And Tests**

- Message metadata now has a typed reply-shape envelope.
  [`records.ts:14`](../../packages/application/src/types/records.ts#L14)

- TS orchestrator tests prove metadata ownership and legacy punctuation ignore.
  [`conversation-orchestrator.test.ts:233`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L233)

- Worker test catches stale outbound ordering regression.
  [`conversation.processor.test.ts:413`](../../apps/worker/src/conversation/conversation.processor.test.ts#L413)
