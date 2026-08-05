# Migration Plan

## Target State For The First Phase

```text
Slack
  -> TypeScript API and worker
     -> AgentRuntimePort
        -> TypeScriptAgentRuntime
        -> MafAgentRuntimeClient
           -> Python FastAPI service
              -> Microsoft Agent Framework workflow
              -> existing TypeScript domain APIs and read models as tools
```

The first phase keeps TypeScript as the transport, queue, policy, and persistence owner. Python/MAF owns only the agent workflow and returns structured output for TypeScript to validate and apply.

## Phase 0: Baseline

- Snapshot current `conversation-sim` results for `burnout`, `memory-recall`, and `terse-user`.
- Add sensitive baseline cases for crisis, harassment, privacy, manager escalation, unwanted proactivity, false memory, goal creation, goal update, assessment preparation, and casual conversation.
- Record latency, model-call count, cost, risk false negatives, memory false positives, duplicate follow-ups, tool success, and manual-review notes.

## Phase 1: Runtime Boundary

- Add a framework-neutral `AgentRuntimePort` in TypeScript.
- Wrap the current `ConversationOrchestrator` path as `TypeScriptAgentRuntime`.
- Add a `MafAgentRuntimeClient` that speaks the runtime HTTP contract but can initially be disabled.
- Resolve runtime selection through feature flags and a global MAF kill switch.

## Phase 2: Python Service Skeleton

- Add an `agent-service/` workspace with Python 3.12, FastAPI, Pydantic, pytest, ruff, pyright or mypy, and OpenTelemetry.
- Expose `POST /runtime/process-message`.
- Validate request/response schemas at the API boundary.
- Pass W3C trace context from TypeScript into Python.

## Phase 3: First MAF Workflow

Initial workflow:

```text
Load Context
  -> Classify Intent
  -> Risk Detection
  -> Memory Extraction
  -> Apply Deterministic Policies
  -> Generate Care Response
  -> Plan Follow-up
  -> Validate Proposed Actions
  -> Return Result
```

Use MAF workflow/executor structure for topology. Keep deterministic policy checks outside agent discretion.

## Phase 4: Shadow Mode

- TypeScript runtime remains user-facing.
- MAF runtime runs asynchronously for comparison only.
- Store candidate outputs with trace IDs and runtime versions.
- Compare reply quality, risk level, risk evidence, memory candidates, proposed actions, latency, cost, and failure mode.

## Phase 5: Canary

Suggested rollout:

```text
internal users -> one workspace -> 5% -> 25% -> 50% -> 100%
```

Roll forward only when shadow and canary metrics meet the baseline. Roll back by feature flag or kill switch.

## Phase 6: Ownership Transfer

Transfer domain ownership only module by module:

1. Prompt definitions and agents
2. Conversation orchestration
3. Context assembly
4. Memory extraction
5. Memory query service
6. Follow-up planner
7. Survey assessment
8. Risk classification
9. Persistence repositories
10. Slack adapter and scheduler only if the hybrid model stops being useful

One migration step changes one ownership boundary.
