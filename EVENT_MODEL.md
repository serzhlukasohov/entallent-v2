# Event Model

## Overview

enTalent uses BullMQ as its internal event bus. All cross-service communication flows through named queues. Events are persisted in Redis with configurable retention.

## Queue definitions

| Queue | Producer | Consumer | Purpose |
|-------|----------|----------|---------|
| `conversation` | Slack webhook handler | `ConversationProcessor` | Trigger full conversation orchestration for a new inbound message |
| `memory-extraction` | `ConversationOrchestrator` | `MemoryExtractionProcessor` | Extract memory items from a completed conversation turn |
| `survey-evidence` | `ConversationOrchestrator` | `SurveyEvidenceProcessor` | Evaluate conversation for survey signal evidence |
| `risk-analysis` | `ConversationOrchestrator` | `RiskAnalysisProcessor` | Dedicated async risk analysis (high-urgency pre-check is synchronous) |
| `followup-planning` | `ConversationOrchestrator` | `FollowUpPlanningProcessor` | Plan and schedule proactive follow-up actions |
| `followup-execution` | `FollowUpSchedulerUseCase` | `FollowUpExecutionProcessor` | Execute a scheduled follow-up action |
| `message-send` | `FollowUpExecutionUseCase`, `ConversationOrchestrator` | `MessageSendProcessor` | Send an outbound message via the appropriate channel adapter |

## Job schemas

### `conversation` job
```typescript
{
  messageId: string;          // saved inbound message ID
  conversationId: string;
  userId: string;
  tenantId: string;
  externalWorkspaceId: string;
  externalConversationId: string;
  traceId: string;            // UUID, propagated through all downstream jobs
}
```

### `memory-extraction` job
```typescript
{
  conversationId: string;
  userId: string;
  tenantId: string;
  traceId: string;
}
```

### `survey-evidence` job
```typescript
{
  conversationId: string;
  userId: string;
  tenantId: string;
  surveyWindowId: string;
  traceId: string;
}
```

### `risk-analysis` job
```typescript
{
  conversationId: string;
  userId: string;
  tenantId: string;
  traceId: string;
}
```

### `followup-planning` job
```typescript
{
  conversationId: string;
  userId: string;
  tenantId: string;
  channelType: string;
  externalConversationId: string;
  inboundMessageId: string;
  traceId: string;
}
```

### `followup-execution` job
```typescript
{
  scheduledActionId: string;
  tenantId: string;
  userId: string;
  traceId: string;
}
```

### `message-send` job
```typescript
{
  outboundMessageId: string;
  conversationId: string;
  tenantId: string;
  userId: string;
  text: string;
  channelType: string;
  externalWorkspaceId: string;
  externalConversationId: string;
  traceId: string;
}
```

## Flow diagrams

### Inbound message → response

```
Slack webhook
  │
  ├── signature verification
  ├── idempotency check (Redis SET NX, TTL 24h)
  ├── user/conversation bootstrap (find-or-create)
  ├── message persistence (inbound)
  └── enqueue → conversation
              │
              ├── classify situation (sync, AI)
              ├── detect risk (sync, AI)
              │   └── if critical → escalation (sync)
              ├── load memory context (if MEMORY_EXTRACTION flag enabled)
              ├── select survey probe (if CONVERSATIONAL_SURVEY flag enabled)
              ├── generate response (sync, AI)
              ├── persist outbound message
              ├── enqueue → message-send
              ├── enqueue → memory-extraction
              ├── enqueue → survey-evidence
              ├── enqueue → risk-analysis
              └── enqueue → followup-planning
```

### Proactive follow-up execution

```
Scheduled action becomes due
  │
  └── enqueue → followup-execution
              │
              ├── load action (status check)
              ├── load context (proactive enabled? quiet hours? risk?)
              ├── policy decision: send / postpone / cancel / skip
              │   ├── postpone → reschedule + re-enqueue
              │   └── cancel → mark cancelled
              └── send:
                  ├── generate response (AI)
                  ├── persist outbound message
                  ├── enqueue → message-send
                  └── mark sent
```

## Delivery guarantees

- **At-least-once** delivery: BullMQ retries failed jobs up to `attempts` times with exponential backoff.
- **Idempotency**: Slack event deduplication via Redis (`slack:event:{event_id}`, TTL 24h). Job processing is idempotent by design — each processor checks current state before acting.
- **Dead-letter queue**: Jobs exhausting all retries move to the failed set. Admin API exposes DLQ inspection and manual retry (`POST /admin/queues/dead-letter/:jobId/retry`).
- **Graceful shutdown**: Worker processors implement `OnApplicationShutdown` and call `worker.close()` to drain active jobs before terminating.

## Retention

| Queue | `removeOnComplete` | `removeOnFail` |
|-------|-------------------|----------------|
| All queues | 1,000 most recent | 5,000 most recent |

Tune via `defaultJobOptions` in `QueueModule`.

## Observability

- All job starts and completions are logged with `traceId`.
- LLM runs are recorded to the `llm_runs` table (see `LlmRunRepository`) for cost and latency tracking.
- Admin panel exposes queue stats: `GET /admin/queues`.
