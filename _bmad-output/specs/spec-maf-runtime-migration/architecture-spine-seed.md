# Architecture Spine Seed

This file is a seed for a later `bmad-architecture` run. It is not the final architecture spine.

## Paradigm

Brownfield hexagonal migration with a strangler boundary around agent orchestration.

## Invariants

- `packages/application` remains the TypeScript application boundary until ownership is explicitly transferred.
- `AgentRuntimePort` is the only TypeScript dependency on the agent runtime.
- MAF is isolated inside the Python `agent-service` runtime module.
- Existing TypeScript repositories remain the write path for memory, goals, risk signals, scheduled actions, messages, and survey evidence in the first slice.
- Python tools call existing TypeScript APIs or read-model endpoints rather than writing directly to current domain tables.
- Durable production session state and history are separated; process-local state is local development only.
- Trace context must connect Slack event, TypeScript job, MAF workflow, model calls, tools, and applied actions.

## First Slice Containers

```text
apps/api
  Slack webhook, signature verification, event idempotency, queue enqueue

apps/worker
  BullMQ processors, AgentRuntimePort selection, TypeScript side-effect execution

agent-service
  FastAPI runtime endpoint, MAF workflow, agents, tools, context providers, telemetry

packages/contracts
  Shared schema source for generated and validated structured outputs

PostgreSQL
  Existing domain persistence

Redis
  BullMQ queues and optional durable MAF session/checkpoint storage if selected
```

## Deferred Architecture Decisions

- Whether the first transport is JSON-only HTTP or HTTP plus SSE.
- Whether to use prerelease MAF hosting helpers in the first spike.
- Whether MAF session/checkpoint state should start in Redis or Postgres JSONB.
- How Python dependencies are managed in the monorepo once `uv` is available locally.
- Whether OpenAPI is generated from TypeScript, Python, or a neutral schema source.

## External References Verified On 2026-08-05

- Microsoft Agent Framework self-hosting docs: https://learn.microsoft.com/en-us/agent-framework/hosting/self-hosting/
- Microsoft Agent Framework Python `WorkflowBuilder` docs: https://learn.microsoft.com/en-us/python/api/agent-framework-core/agent_framework.workflowbuilder?view=agent-framework-python-latest
- Microsoft Agent Framework memory and persistence docs: https://learn.microsoft.com/en-us/agent-framework/get-started/memory
