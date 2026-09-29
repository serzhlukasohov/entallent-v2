# V2 conversation replay boundary

Status: implementation design for REQ-009 and IA-015/036/037; no automatic replay of an effectful failed job is approved by this artifact.

## Observed failure boundary

The conversation worker invokes the TypeScript orchestrator, then writes a `conversation_job_receipts` row. The orchestrator may apply a Bundle or clarification verdict before it saves an outbound message. It then stages a confirmation or clarification prompt, enqueues delivery, and enqueues memory, style, and survey-evidence work. Each step can fail independently. A BullMQ retry currently repeats the orchestrator, which can see changed question state and create a new outbound message ID. A stable `message-send` job ID deduplicates repeated enqueue of *one saved message* only. The completed-job receipt retry is safe because it never repeats orchestration. Failed or evicted original jobs have no equivalent proof.

| Failure point | Durable state that may already exist | Safe current action |
| --- | --- | --- |
| Before any effectful application call | Inbound message and admission | Ordinary queue retry, after verifying the failure point |
| During Bundle or clarification verdict | Question state may be committed | Preserve private Bundle and reconcile the turn; do not blindly replay |
| After outbound save or prompt staging | Original outbound text and temporary prompt state | Reconcile the exact outbound row and stage before dispatch |
| After delivery enqueue but before remaining work | An outbound may already have been sent | Do not regenerate a response; inspect missing follow-on effects |
| After orchestration succeeds but receipt storage fails | Completed BullMQ job is retained | Existing identifier-only `receipt-retry` path |
| Original job missing or evicted | Effect phase is unknown | Manual reconciliation until a durable effect ledger exists |

## Required implementation sequence

1. Add a tenant/person/conversation/inbound-scoped durable turn-effect record. A retry must acquire its row lock and see whether the turn is uncommitted or committed. Keep private response text in the original outbound `messages` row, never in the ledger or BullMQ payload.
2. Build and validate the model's proposed V2 verdict and response before committing domain effects. Commit the verdict, one outbound identity, prompt staging, a conversation receipt, and identifier-only delivery/evidence dispatch intents atomically in PostgreSQL. Redis remains a delivery mechanism. The existing repository transactions need a shared transaction boundary for this step.
3. Dispatch the durable intents with stable job IDs. On retry or after Redis loss, read the committed turn and dispatch only missing intents; never rerun model interpretation or generate another outbound message for that inbound ID.
4. Reconcile failed or evicted original jobs only after step 3 proves that both uncommitted and committed states have deterministic recovery. Keep the cutoff barrier until every timely accepted inbound has a committed receipt or a reviewed terminal resolution.

## Acceptance checks

- Given a model failure before commit, when BullMQ retries, then one turn commits and one outbound is saved.
- Given a crash immediately after each PostgreSQL effect boundary, when the worker restarts, then one verdict, one outbound, and one receipt exist; no private analytical text remains after finalization.
- Given Redis failure before or after PostgreSQL commit, when dispatch resumes, then the same identifier-only jobs are queued once and no second employee response is sent.
- Given a failed or evicted original job, when the cutoff scanner reconciles it, then it acts from durable turn state without inferring success from missing BullMQ history.
- Given a timely clarification, when processing finishes after cutoff, then it is resolved before private temporary content is purged.
