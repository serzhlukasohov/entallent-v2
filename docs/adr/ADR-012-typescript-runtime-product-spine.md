# ADR-012: TypeScript Runtime as the Active Product Spine

**Status:** Proposed
**Date:** 2026-08-21

## Context

The project previously explored a Python/MAF runtime path. Current product direction is to return to the TypeScript runtime and not touch MAF for the present design work.

The active TypeScript path is centered on `ConversationOrchestrator`, `TypeScriptAgentRuntime`, BullMQ processors, the OpenAI adapter, Postgres-backed repositories, and the manager dashboard. The code still contains MAF-era ports, flags, scripts, runbooks, and worker branches, so the operational surface is not yet aligned with the current product direction.

## Decision

Treat the TypeScript runtime as the only active product spine for current architecture and product grilling:

- Inbound Slack messages are interpreted, planned, rendered, persisted, and queued through the TypeScript application layer.
- Product policy should be made explicit in TypeScript contracts, tests, and docs before being encoded in prompt text.
- MAF-specific code, scripts, and docs are excluded from current product design unless a separate cleanup or retirement task is approved.
- New dialogue, pulse, memory, reminder, and manager analytics work should be judged against the TypeScript flow first.

## Consequences

**Good:**

- Product behavior has one primary place to reason about: TypeScript application orchestration plus prompt rendering.
- Verification can focus on application tests, prompt tests, worker tests, simulations, and dashboard/admin contract tests.
- The team can stop treating MAF parity as a design constraint for every TS conversation improvement.

**Bad:**

- The repository still exposes old MAF paths, which can mislead maintainers and smoke-test selection.
- Runtime contracts and scripts currently overstate a dual-runtime world.
- Until cleanup happens, feature flags may still route some paths through stale logic if production flags drift.

## Follow-up Questions

- What is the exact kill-switch/flag state that guarantees the TS path in production?
- Which MAF docs/scripts should be archived versus kept as historical reference?
- Should `AgentRuntimePort` remain the stable TypeScript abstraction, or should it be renamed once MAF is no longer a competing implementation?
