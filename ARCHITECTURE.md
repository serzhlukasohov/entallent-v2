# Architecture

## System Context

enTalent is a multi-tenant SaaS platform providing an AI mentor accessible to employees via Slack. Each conversation turn is processed asynchronously: the Slack event is received, a job is enqueued, and the worker processes classification → safety → memory → response in a single pipeline. Managers see only privacy-safe aggregate analytics; raw conversations are never exposed outside the admin debug view.

```
┌─────────────┐          ┌─────────────┐          ┌──────────────┐
│   Employee  │  Slack   │   API App   │  BullMQ  │  Worker App  │
│   (end user)│◄────────►│  (NestJS +  │◄────────►│  (NestJS +   │
│             │  events  │  Fastify)   │  queues  │  processors) │
└─────────────┘          └──────┬──────┘          └──────┬───────┘
                                │                        │
                    ┌───────────┴───────────┐            │
                    │                       │            │
              ┌─────▼──────┐        ┌───────▼───┐  ┌────▼──────┐
              │ PostgreSQL │        │   Redis   │  │  OpenAI   │
              │  (Drizzle) │        │  (BullMQ) │  │    API    │
              └────────────┘        └───────────┘  └───────────┘
```

## Container Diagram

| Container | Technology | Responsibility |
|-----------|------------|----------------|
| `apps/api` | NestJS + Fastify | Slack webhook ingestion, user/admin REST endpoints, queue submission |
| `apps/worker` | NestJS + BullMQ | Async conversation processing, memory extraction, follow-up scheduling, survey evidence |
| PostgreSQL | pg 16 / Drizzle ORM | Persistent state for all entities |
| Redis | Redis 7 / BullMQ | Job queues with at-least-once delivery and DLQ |

## Component Diagram

```
apps/api
├── ChannelModule        ← Slack event receiver (HMAC verified)
├── UsersModule          ← User preferences, memory, GDPR endpoints
├── AdminModule          ← Admin-only: queues, LLM runs, audit, survey, feature flags
├── AuditModule          ← AuditLogRepository (shared)
├── QueueModule (Global) ← BullMQ + Redis
└── DatabaseModule       ← DatabaseService (shared)

apps/worker
├── ConversationModule   ← ConversationOrchestrator + ConversationProcessor
├── MemoryModule         ← MemoryExtractionUseCase + MemoryExtractionProcessor
├── FollowUpModule       ← FollowUpSchedulerUseCase + FollowUpExecutionUseCase
├── SurveyModule         ← SurveyEvidenceExtractionUseCase + SurveyEvidenceProcessor
├── SafetyModule         ← RiskSignalRepository + AuditLogRepository + EscalationStubService
├── FeatureFlagModule    ← FeatureFlagRepository
└── DatabaseModule       ← DatabaseService (shared)

packages/application     ← Domain use cases + port interfaces (zero infra imports)
packages/ai-openai       ← OpenAI adapter (OpenAiProvider, AiProviderWithFallback)
packages/contracts       ← Zod schemas for all AI outputs
packages/database        ← Drizzle schema + migrations + seed
packages/channel-slack   ← Slack event parsing and message sending
packages/config          ← Env schema (zod) + validation
packages/crypto-utils    ← AES-256-GCM field encryption
```

## Request Flows

### Inbound message (Slack → response)

```
1. Slack sends event to POST /channel/slack/events
2. ChannelModule verifies HMAC signature
3. MessageIngestionUseCase saves inbound message, creates/finds conversation
4. OutboxService enqueues ConversationJob → BullMQ conversation queue
5. ConversationProcessor picks up job:
   a. Load conversation + last 20 messages
   b. Load memory items (if memory_extraction flag enabled)
   c. classifySituation() → gpt-4o-mini
   d. detectRisk() if requiresSafetyCheck → gpt-4o-mini
   e. Persist risk signal if severity != none
   f. Trigger escalation if critical / immediate-response
   g. findSurveyProbe() if surveyEnabled + surveyAllowed
   h. generateResponse() → gpt-4o
   i. Save outbound message
   j. Enqueue MessageSendJob → message-send queue
   k. Enqueue MemoryExtractionJob (if memoryEnabled)
   l. Enqueue SurveyEvidenceJob (if surveyEnabled)
6. MessageSendProcessor sends message to Slack
7. MemoryExtractionProcessor runs extractMemory() → saves memory items
8. SurveyEvidenceProcessor runs evaluateSurveyEvidence() → updates assessments
```

### Proactive follow-up

```
1. FollowUpSchedulerProcessor (cron) runs every 15 minutes
2. Finds scheduled_actions where due_at <= now AND status = pending
3. FollowUpExecutionUseCase:
   a. Load follow-up context (memory, risk, recent messages)
   b. Check hasActiveHighRisk → cancel if true
   c. Check quiet hours + proactive messaging consent
   d. generateResponse() with followUpIntent hint
   e. Save outbound message + enqueue MessageSendJob
   f. Mark action as sent
```

## Async Flows

| Queue | Producer | Consumer | Retry |
|-------|----------|----------|-------|
| conversation | ChannelModule (API) | ConversationProcessor | 3× exponential |
| message-send | ConversationProcessor / FollowUpExecutionUseCase | MessageSendProcessor | 3× exponential |
| memory-extraction | ConversationOrchestrator | MemoryExtractionProcessor | 3× exponential |
| survey-evidence | ConversationOrchestrator | SurveyEvidenceProcessor | 3× exponential |
| followup-planning | FollowUpSchedulerProcessor | (self-scheduling via cron) | — |
| followup-execution | FollowUpSchedulerProcessor | FollowUpExecutionProcessor | 3× exponential |
| risk-analysis | (reserved) | — | — |

Failed jobs after max retries land in BullMQ's failed set (acts as DLQ). Admin can retry via `POST /admin/queues/dead-letter/:jobId/retry`.

## Scaling Strategy

**Horizontal worker scaling**: Add worker instances — BullMQ distributes jobs. No shared state between workers (all state in PostgreSQL).

**Queue partitioning**: Each queue has independent concurrency settings. CPU-intensive tasks (LLM calls) run in the conversation queue with concurrency=1 per worker; lightweight tasks (message-send) can run at concurrency=10.

**Database read replicas**: Drizzle client can point to a read replica for analytics queries. All write paths go to primary.

**Temporal migration path**: `OutboxPort` is the abstraction over queue operations. Replacing BullMQ with Temporal requires only a new `OutboxPort` implementation — zero changes to `ConversationOrchestrator` or any use case.

**Multi-provider AI**: `AiProviderWithFallback` wraps any two `AiProviderPort` implementations. Swap OpenAI for Anthropic by creating an `AnthropicProvider` implementing the same port.

## Trade-offs

| Decision | Trade-off |
|----------|-----------|
| BullMQ over Temporal | Simpler ops now; Temporal migration is a port swap when durable workflows become necessary |
| Single PostgreSQL | Simpler than separate event store; add read replica or CQRS later if needed |
| Hexagonal architecture | More files than simple layered arch; enables swapping infra without domain rewrites |
| gpt-4o-mini for analysis, gpt-4o for generation | ~10× cost difference; generation quality matters more than classification quality |
| AES-256-GCM local key | No external KMS dependency for MVP; `EncryptionPort` abstraction makes KMS swap non-breaking |
