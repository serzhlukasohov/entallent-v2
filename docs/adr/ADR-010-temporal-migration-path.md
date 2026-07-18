# ADR-010: Future Migration Path to Temporal

**Status:** Accepted  
**Date:** 2024-01-01

## Context

BullMQ is the right choice for MVP scale. At enterprise scale, we may need:
- Durable workflow execution (survives worker restarts mid-workflow)
- Long-running conversations that span hours/days
- Complex saga patterns (e.g., goal lifecycle across multiple follow-ups)
- Better observability of workflow state

## Decision

Design the system so that BullMQ → Temporal is a substitution, not a rewrite.

**Constraints during MVP development:**
1. Domain logic must not import BullMQ, Redis, or any queue client
2. All BullMQ processors must be thin adapters: deserialize job data → call application service → return result
3. Application services accept plain objects, not BullMQ Job instances
4. ScheduledAction is a domain entity, not a BullMQ concept
5. Queue names and job types are defined in a shared constants file, not scattered

**Migration approach:**
1. Implement `TemporalWorkflowAdapter` that accepts the same application service interface
2. Feature-flag conversation orchestration to run via Temporal vs BullMQ per tenant
3. Run both systems in parallel during migration window
4. Remove BullMQ once Temporal handles all traffic

## Consequences

**Good:**
- The migration can happen incrementally, per feature, per tenant
- Domain logic is not rewritten
- Tests remain valid across the migration

**Bad:**
- Slight overhead in keeping processors thin during MVP
- Temporal has a steeper operational complexity (mitigated by Temporal Cloud)
