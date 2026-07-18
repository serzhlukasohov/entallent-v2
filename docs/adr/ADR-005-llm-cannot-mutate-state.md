# ADR-005: LLMs Cannot Directly Mutate Domain State

**Status:** Accepted  
**Date:** 2024-01-01

## Context

AI-driven systems often give LLMs tool access to databases, APIs, and user state. This creates risks:
- Prompt injection can cause unauthorized mutations
- LLM outputs are non-deterministic and may be wrong
- Compliance and audit requirements demand explainability
- Users expect their data to be managed by controlled, reviewable logic

## Decision

LLMs are executors within a controlled system:
- LLM analyzes and generates structured output (Zod-validated)
- Backend validates the structured output schema
- Domain logic applies business rules and decides what to persist
- Database stores authoritative state
- Audit log explains every action

Specifically:
- Response Generator receives prepared context — it does NOT read the database or send messages
- Memory Extractor returns proposals — backend decides what to persist after dedup/conflict resolution
- Follow-up Planner returns candidates — backend applies policy and creates ScheduledActions
- Survey Evidence Evaluator returns evidence — Survey Engine decides scoring
- Risk Detector returns signals — Policy Engine decides escalation

No LLM call receives tools that can directly write to production state.

## Consequences

**Good:**
- Prompt injection cannot cause unauthorized data writes
- Every state change has explicit application-level ownership
- AI outputs are auditable: proposal vs. accepted result
- Models can be replaced without changing business rules

**Bad:**
- More code required (proposal → validation → persistence pipeline)
- LLM cannot "self-correct" by reading its own stored state during a call
  (mitigated by preparing full context before the call)
