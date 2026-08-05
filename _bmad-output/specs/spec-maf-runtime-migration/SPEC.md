---
id: SPEC-maf-runtime-migration
companions:
  - migration-plan.md
  - runtime-contract.md
  - validation-baseline.md
  - architecture-spine-seed.md
sources:
  - /Users/serzh/.codex/attachments/5825dc5d-19e1-4f1e-becd-518a16b870d2/pasted-text.txt
  - ../../../ARCHITECTURE.md
  - ../../../packages/application/src/use-cases/conversation-orchestrator.ts
  - ../../../packages/application/src/ports/ai-provider.port.ts
  - ../../../packages/contracts/src/ai.ts
  - ../../../packages/conversation-sim/README.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only.

# MAF Runtime Migration

## Why

enTalent's current TypeScript worker owns the whole Slack conversation pipeline, including LLM orchestration, safety, memory, follow-ups, persistence, and queue side effects. The migration opportunity is to move the agentic orchestration into Microsoft Agent Framework without destabilizing the production surfaces that already work: Slack ingestion, BullMQ, tenant isolation, Postgres ownership, admin APIs, and operational rollback.

## Capabilities

- **CAP-1**
  - **intent:** The worker can route a conversation turn to either the existing TypeScript runtime or a MAF-backed runtime without exposing framework-specific types to the application boundary.
  - **success:** A feature flag or kill switch can switch a workspace/user between runtimes, and a disabled MAF path falls back to the existing TypeScript behavior before side effects occur.

- **CAP-2**
  - **intent:** A Python agent service can process one inbound conversation turn through a MAF workflow and return a structured runtime result to TypeScript.
  - **success:** Given a valid `ProcessMessageRequest`, the service returns a validated `ProcessMessageResult` containing reply text, risk assessment, memory candidates, proposed actions, trace ID, and runtime version.

- **CAP-3**
  - **intent:** The migration can run in shadow mode before any user-facing rollout.
  - **success:** For the same inbound message, TypeScript can send the existing runtime's reply to Slack while recording the MAF candidate result for comparison across quality, safety, memory, actions, latency, and cost.

- **CAP-4**
  - **intent:** Regression evaluation can decide whether the MAF runtime is safe enough to enter canary rollout.
  - **success:** Existing `conversation-sim` gates and the expanded migration baseline pass at or above the current TypeScript thresholds, with no worse critical risk false-negative rate and no duplicate scheduled actions.

## Constraints

- The first migration slice must not rewrite Slack ingestion, BullMQ queues, tenant isolation, authorization, admin API, analytics, or the Postgres schema.
- TypeScript remains the side-effect owner until aggregate ownership is explicitly transferred; Python returns proposals or commands, not direct writes to existing domain aggregates.
- No aggregate may have concurrent TypeScript and Python writers.
- Fallback from MAF to TypeScript is allowed only before side effects; every request and proposed action needs an idempotency key.
- Production MAF hosting must not rely on process-local sessions or in-memory conversation history.
- MAF framework types must stay inside the Python agent runtime and must not leak into TypeScript domain contracts or shared domain modules.
- Sensitive scenarios require deterministic policy checks and manual review sampling; LLM-as-judge alone is insufficient.

## Non-goals

- Do not rewrite the whole TypeScript backend to Python in one PR.
- Do not move Slack adapter, BullMQ scheduling, manager analytics, tenant authorization, or existing persistence repositories in the first slice.
- Do not let agents directly mutate memory, goals, risk records, or scheduled actions until TypeScript policy validation is replaced by an explicit ownership transfer.
- Do not delete the TypeScript runtime until shadow and canary criteria are met.

## Success signal

MAF can process real or simulated conversation turns behind `AgentRuntimePort` while TypeScript remains the production transport and persistence owner. The existing TypeScript runtime can be selected instantly by kill switch, and the MAF path demonstrates equivalent or better safety, memory precision, action discipline, latency, and cost across baseline scenarios before canary rollout.

## Assumptions

- The first vertical slice is inbound user message processing: load context, classify intent, detect risk, extract memory proposals, generate response, propose follow-up actions, and return a structured result.
- The initial Python service uses FastAPI over a project-owned HTTP contract.
- The initial runtime result is JSON-only unless streaming becomes a confirmed requirement.

## Open Questions

- Should the first MAF service use prerelease `agent-framework-hosting` helpers, or plain FastAPI routes over core `agent-framework` only?
- Is SSE needed in the first runtime contract, or can streaming be deferred until after the JSON shadow-mode slice?
- Which rollout dimension should control canary first: workspace, user, tenant cohort, or internal-only account list?
