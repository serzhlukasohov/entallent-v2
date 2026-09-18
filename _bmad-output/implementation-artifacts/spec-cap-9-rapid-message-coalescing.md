---
title: 'CAP-9 Rapid Slack Message Coalescing'
type: 'bugfix'
created: '2026-09-18'
status: 'done'
review_loop_iteration: 1
baseline_commit: 'f9be93e26cff26fd9437da52f3aa60d57d31e612'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Two distinct Slack messages 1.7 seconds apart produce two near-identical replies because each persisted inbound independently generates an outbound.

**Approach:** Preserve and enqueue every inbound, delaying Slack jobs by 2,000 ms. Before generation, PostgreSQL detects a newer inbound in the same scoped rolling window: stale jobs no-op; only the trailing job invokes the unchanged orchestrator with ordered history.

## Boundaries & Constraints

**Always:** Keep one inbound row and delayed job per distinct event; scope by tenant/user/conversation; order by `occurredAt`, then Slack `externalMessageId` and a persisted fallback; no-op before orchestration and LLM accounting; test D05-04, rolling/boundary/tie/retry/isolation cases; keep HTTP and Socket Mode on `SlackIngestService`.

**Ask First:** Any window other than 2,000 ms; any database migration; any change to orchestrator, worker concurrency, queue retry policy, or production configuration; any commit, push, deployment, or live Slack payload.

**Never:** Drop/merge inbound rows; let BullMQ last-writer choose chronology; add text heuristics, a model call, dependency, global serialization, or MAF/`agent-service`; claim post-outbound exactly-once.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Single | One Slack message | One delayed job and reply | Existing retries |
| D05-04 | `нуі`, then `yes` after 1.657 s | Two rows/jobs; first no-ops; trailing job generates/sends once using both | No text rules |
| Rolling/boundary | Adjacent messages at `<2,000 ms`; control at `2,001 ms` | Chain collapses to its tail; control replies separately | Event-time window |
| Timestamp tie | Same normalized millisecond | Slack ID/fallback total-order selects one tail | Deterministic |
| Isolation/replay | Other scope; repeated `event_id` | Independent tail; replay adds nothing | Existing idempotency |
| Retry/active | Stale retry; later row not committed before check | Stale remains no-op; unseen event becomes a separate turn | No in-flight cancellation/exactly-once claim |

</frozen-after-approval>

## Code Map

- `apps/api/src/channel/slack-ingest.service.ts` / `.test.ts` and `apps/api/src/queue/queue.types.ts` -- persist, then enqueue a Slack-marked job with 2,000 ms delay; replay coverage.
- `apps/worker/src/conversation/repositories/conversation.repository.ts` / `.test.ts` -- scoped newer-inbound lookup and total-order coverage.
- `apps/worker/src/conversation/conversation.processor.ts` / `.test.ts` -- stale gate before orchestration/accounting; trailing/retry coverage.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/channel/slack-ingest.service.ts` / `.test.ts` -- RED→GREEN durable-save then 2,000 ms delay without replacement.
- [x] `apps/worker/src/conversation/repositories/conversation.repository.ts` / `.test.ts` -- RED→GREEN scoped total-order newer-inbound lookup.
- [x] `apps/worker/src/conversation/conversation.processor.ts` / `.test.ts` -- RED→GREEN Slack-marked stale no-op before orchestration/accounting with a fixed 2,000 ms window.
- [x] `docs/agent-task-log.md` -- append the required concise implementation/verification row without rewriting unrelated entries.

**Acceptance Criteria:**
- Given D05-04 rows are committed, when both jobs run, then the first has no orchestration/LLM receipt and the tail alone generates/sends.
- Given queue-add order differs from Slack order, when jobs check PostgreSQL, then Slack chronology selects the tail.
- Given ties, rolling bursts, outside-window messages, or other scopes, when jobs run, then total-order and the 2,000 ms boundary select correctly.

## Spec Change Log

- Review loop 1: Blind review found that BullMQ `replace` selects the last completed `Queue.add`, not the inbound with the greatest Slack occurrence time. No implementation amendment was made because guaranteeing the chronological latest anchor changes the approved intent boundary. Known-bad state avoided: a concurrently delayed older webhook can replace the newer payload and make orchestration exclude the newer durable inbound. KEEP: two-second trailing-edge window, one durable row per event, tenant+conversation isolation, native BullMQ admission where it remains sufficient, and no migration/MAF/model call.
- Human resolution after loop 1: replace queue last-writer selection with a PostgreSQL-backed stale-job gate; retain simple BullMQ delay only. Known-bad state avoided: out-of-order webhook completion cannot choose an older anchor. KEEP: existing orchestrator, all inbound rows, one model generation per committed burst, no migration/MAF/extra model call, and an explicit active-generation boundary for events not yet committed at stale-check time.

## Verification

**Commands:**
- `pnpm --filter @entalent/api test -- src/channel/slack-ingest.service.test.ts` -- focused tests pass.
- `pnpm --filter @entalent/worker test -- src/conversation/conversation.processor.test.ts src/conversation/repositories/conversation.repository.test.ts` -- worker tests pass.
- `pnpm --filter @entalent/api test`; `pnpm --filter @entalent/worker test` -- app suites pass.
- API and worker `typecheck`/`lint` -- pass.
- `pnpm harness:check -- --base f9be93e26cff26fd9437da52f3aa60d57d31e612` -- pass; receipt `runs/harness/receipt-1789731693929-b7016abf.json` contains no retired-runtime paths.

## Suggested Review Order

**Admission boundary**

- Persist every Slack inbound before admitting a delayed, explicitly marked job.
  [`slack-ingest.service.ts:68`](../../apps/api/src/channel/slack-ingest.service.ts#L68)

- Keep the channel-specific behavior explicit in the existing queue contract.
  [`queue.types.ts:1`](../../apps/api/src/queue/queue.types.ts#L1)

**Stale-job decision**

- Gate only marked Slack jobs before orchestration and LLM accounting.
  [`conversation.processor.ts:92`](../../apps/worker/src/conversation/conversation.processor.ts#L92)

- Let PostgreSQL scope candidates while application code resolves the exact tail.
  [`conversation.repository.ts:98`](../../apps/worker/src/conversation/repositories/conversation.repository.ts#L98)

- Preserve deterministic history order for same-millisecond Slack events.
  [`conversation.repository.ts:72`](../../apps/worker/src/conversation/repositories/conversation.repository.ts#L72)

- Enforce microsecond window precision, tie order, and late-arrival safety.
  [`conversation.repository.ts:292`](../../apps/worker/src/conversation/repositories/conversation.repository.ts#L292)

**Regression evidence**

- Prove save-before-enqueue, two durable jobs, event time, and replay behavior.
  [`slack-ingest.service.test.ts:7`](../../apps/api/src/channel/slack-ingest.service.test.ts#L7)

- Prove stale retries no-op while unmarked non-Slack jobs retain prior behavior.
  [`conversation.processor.test.ts:145`](../../apps/worker/src/conversation/conversation.processor.test.ts#L145)

- Cover scope, rolling windows, microseconds, total order, and visibility boundaries.
  [`conversation.repository.test.ts:28`](../../apps/worker/src/conversation/repositories/conversation.repository.test.ts#L28)
