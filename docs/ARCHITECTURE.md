# Architecture

## System context

enTalent is a multi-tenant SaaS platform that connects employees with an AI-powered mentor through messaging channels. Slack is the first integration; Teams, Telegram, and WhatsApp follow using the same adapter contract.

## Guiding principle

> AI helps understand and articulate, but does not own product state and does not make uncontrolled business decisions.

LLM role: analyze, propose, generate structured output.
Backend role: validate, decide, persist, audit.

## Container diagram

```
Employee ──► Slack API ──► Channel Adapter ──► API (NestJS/Fastify)
                                                       │
                                              Redis Queue (BullMQ)
                                                       │
                                              Worker (NestJS)
                                             ┌──────────────────┐
                                             │ Conversation      │
                                             │ Orchestrator      │
                                             │  ├─ Safety Engine │
                                             │  ├─ Survey Engine │
                                             │  └─ Memory Layer  │
                                             └──────────────────┘
                                                       │
                                              LLM Gateway ──► OpenAI API
                                                       │
                                              PostgreSQL + pgvector
                                                       │
                                              Channel Adapter ──► Slack API
```

## Package boundaries

| Package | Responsibility | May import |
|---------|---------------|------------|
| `domain` | Entities, value objects, domain policies | Nothing |
| `contracts` | Shared Zod schemas and TypeScript types | `zod` only |
| `application` | Use cases, orchestrator, ports | `domain`, `contracts` |
| `channel-core` | ChannelAdapter port interface | `contracts` |
| `channel-slack` | Slack adapter implementation | `channel-core`, Slack SDK |
| `ai-core` | LLM Gateway port, prompt versioning | `contracts` |
| `ai-openai` | OpenAI adapter | `ai-core`, OpenAI SDK |
| `database` | Drizzle schema, repositories | `drizzle-orm`, `postgres` |
| `memory` | Memory extraction, retrieval, conflict resolution | `application`, `database` |
| `survey` | Survey engine components | `application`, `database` |
| `safety` | Risk detector, policy engine | `application`, `database` |
| `scheduling` | ScheduledAction service, proactive planner | `application`, `database` |
| `observability` | Logger, OpenTelemetry | `pino`, OTel SDK |
| `config` | Env validation | `zod` |

## Request flow: inbound message

```
1. Slack sends event to POST /api/v1/channel/slack/events
2. API verifies Slack signature + timestamp
3. Idempotency check (event_id in Redis / DB)
4. Raw event persisted to DB
5. Job enqueued: conversation queue
6. API responds 200 OK < 3s

7. Worker dequeues job
8. Loads user, tenant, conversation history, relevant memory
9. Runs Situation Classifier (LLM, structured output)
10. Runs Safety Analyzer if needed (LLM, structured output)
11. Determines conversation mode and reply strategy
12. Checks survey opportunity (Survey Engine)
13. Generates response (LLM, structured output, with context)
14. Validates response schema
15. Persists outgoing message
16. Enqueues message-send job

17. In parallel (fire-and-forget jobs):
    - memory.extraction.requested
    - survey.evidence.extraction.requested
    - risk.analysis.requested
    - followup.planning.requested

18. Message-send worker dequeues, sends via ChannelAdapter
19. Updates message with external_message_id
20. Writes audit log
```

## Async background flows

After each conversation turn, four independent jobs run in parallel:

- **Memory Extraction**: LLM proposes MemoryItems and GoalProposals → backend validates, deduplicates, and persists approved items
- **Survey Evidence**: Survey Engine evaluates if the message contains evidence for any active survey dimensions
- **Risk Analysis**: Risk Detector checks for safety signals → policy engine decides suppression or escalation
- **Follow-up Planning**: LLM proposes follow-up intents → backend applies policy and creates ScheduledAction records

## Proactive messaging

A BullMQ delayed job fires for each ScheduledAction at its `dueAt`. The worker acquires a distributed lock, runs a multi-step relevance + policy check, generates a personalized message or cancels/postpones, and records the outcome.

## Hexagonal architecture enforcement

- `apps/api` and `apps/worker` may import application packages
- `packages/domain` imports nothing from infrastructure
- `packages/channel-slack` never appears in domain or application use cases
- `packages/ai-openai` never appears in domain or application use cases
- All infrastructure crosses the boundary through ports (interfaces)

## Scaling path

Current (MVP): Modular monolith in two processes (API + Worker)
Future: Extract packages into microservices as load warrants
Workflow: Replace BullMQ jobs with Temporal workflows using the same domain logic (ADR-010)
Vectors: Replace pgvector with Qdrant by swapping the retrieval adapter (ADR-003)
