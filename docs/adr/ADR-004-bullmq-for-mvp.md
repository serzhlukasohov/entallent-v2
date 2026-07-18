# ADR-004: BullMQ for MVP Workflows

**Status:** Accepted  
**Date:** 2024-01-01

## Context

We need:
- Async processing of incoming messages (decouple webhook from LLM calls)
- Background extraction jobs (memory, survey, risk, follow-up)
- Delayed/scheduled jobs for proactive messaging
- Retry with exponential backoff and dead-letter queues
- Distributed locks to prevent duplicate processing

## Decision

Use BullMQ backed by Redis for the MVP:
- Proven, production-grade queue library for Node.js
- Supports delayed jobs (for scheduled follow-ups)
- Supports repeatable jobs (for future scheduled surveys)
- Built-in retry, backoff, dead-letter, concurrency controls
- Works with a single Redis instance (already in stack)

Domain logic lives in application services that receive job data as plain objects. BullMQ is only used at the adapter layer — processors are thin wrappers around application service calls.

## Migration path to Temporal

ADR-010 documents the migration path. The key constraint: domain logic must not import BullMQ. Processors are adapters, not domain services. When migrating to Temporal, only the adapter layer changes.

## Consequences

**Good:**
- Simple infrastructure (Redis only, no separate workflow service)
- NestJS integration via `@nestjs/bullmq`
- Delayed jobs cover proactive messaging needs at MVP scale

**Bad:**
- BullMQ lacks Temporal's durable execution guarantees
- Long-running workflows must be designed around job checkpoints
- At high scale, Redis becomes a bottleneck (mitigated by Temporal migration)
