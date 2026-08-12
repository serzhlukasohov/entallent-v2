# Adversarial Divergence Review - Architecture Spine

Target: `/Users/serzh/Documents/enTalentNew/_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md`

Verdict: FAIL. The spine is directionally coherent, but it is not yet a safe build substrate. It states ownership and isolation invariants, then defers or omits the executable contracts that make independently built TypeScript and Python units compose. Multiple teams can obey every AD and still ship incompatible request/result shapes, side-effect handoffs, runtime routing, authorization, retries, telemetry, and deployment.

## Findings

1. [P0] Shared runtime contract can split into two incompatible truths.

   Pair: `packages/application/src/ports/agent-runtime.port.ts` and `agent-service/src/agent_service/api/schemas.py`.

   Both units can obey AD-1, AD-3, and AD-4: TypeScript calls `AgentRuntimePort.processMessage`, Python exposes JSON HTTP, and no MAF types leak. They can still build incompatible shapes because the spine only says "JSON-compatible request/result schemas" and explicitly defers the OpenAPI source of truth until before `MafAgentRuntimeClient` implementation. The current TypeScript port accepts only flat IDs and returns `outboundMessageId`, `responseText`, `classification`, and `risk`; the companion target contract expects `requestId`, `eventId`, `runtimeAttempt`, nested tenant/user/conversation/message/context, `memoryCandidates`, `proposedActions`, and `diagnostics`. The spine does not name which contract the first Python route must implement.

   Failure mode: worker/client team serializes the current shim while Python implements the richer target contract, or Python returns `reply.text` while TypeScript validates `responseText`. Both are AD-compliant until integration. Shadow mode then records validation failures instead of candidate results, and canary work stalls on contract reconciliation.

   Required spine correction: make one runtime contract canonical for the first build slice, name its source of truth, and state whether `MafAgentRuntimeClient` adapts current shim input into the richer HTTP request or whether the port itself must be expanded first.

2. [P0] Side-effect ownership is declared, but the action execution handshake is underspecified.

   Pair: `agent-service` proposal producers (`memory_tools.py`, `goal_tools.py`, `followup_tools.py`) and TypeScript proposal executors/repositories in `apps/worker` and `packages/application`.

   Both units can obey AD-2, AD-5, and AD-10: Python only returns proposals, TypeScript validates and writes, and fallback stops after executed actions. They can still build incompatibly because the spine does not define proposal lifecycle states, atomic execution boundaries, failure acknowledgements, or the exact command taxonomy TypeScript must accept. "Proposals or commands" is too broad for an ownership boundary.

   Failure mode: Python emits a `schedule_follow_up` proposal with `executeAt`, `intent`, and a deduplication key, while TypeScript validators expect the existing scheduled-action repository fields such as `conversationId`, `reason`, `timezone`, `cancellationConditions`, and source message IDs. Or Python treats a proposal as applied once returned, while TypeScript treats it as speculative until DB commit. Both interpretations fit "Python proposes; TypeScript writes" but break fallback, retries, and user-facing confirmation text.

   Required spine correction: define a canonical action envelope with `actionId`, aggregate type, proposed payload, validation result, execution status, commit marker, and idempotency/dedup semantics. Specify whether reply generation may mention actions before TypeScript commits them.

3. [P0] Fallback safety depends on a "first side effect" boundary that no unit can reliably observe.

   Pair: `MafAgentRuntimeClient` fallback/retry logic and TypeScript side-effect executors/outbox queues.

   Both units can obey AD-5: the client can fall back only before side effects, and executors can require idempotency keys. They can still diverge because the spine does not define who owns the side-effect barrier, how it is persisted, or what counts as execution. Existing TypeScript orchestration writes the outbound message, queues Slack send, queues memory extraction, queues style analysis, and queues survey evidence after LLM generation. The future MAF path returns proposals, so the "first side effect" may be a Python tool call to a TypeScript read/write API, a TypeScript validation write, a queued Slack send, a diagnostics write, or a shadow record depending on the implementer.

   Failure mode: the HTTP client times out after Python generated proposals but before TypeScript records them; the worker falls back to `TypeScriptAgentRuntime`; Python later retries or the client retries and the proposal executor applies the same reminder with a different dedup key. Every unit can claim idempotency exists, but no shared persisted attempt ledger proves whether fallback is still legal.

   Required spine correction: introduce a runtime-attempt ledger keyed by request/event/message, with phases such as `started`, `candidate_received`, `actions_validated`, `actions_committed`, `reply_committed`, and `fallback_forbidden_after`. Make fallback decisions read that ledger, not process-local knowledge.

4. [P1] Runtime selection can produce split-brain behavior across worker, feature flags, and shadow recorder.

   Pair: `apps/worker/src/conversation/conversation.module.ts` runtime provider selection and the future shadow/canary routing component.

   Both units can obey AD-1 and AD-6: the worker depends only on the port, and shadow mode records both current and candidate results. They can still build incompatibly because the spine never defines runtime mode values, precedence, evaluation order, or stickiness. A module-level provider can bind one runtime at process startup, while a router can expect per-tenant or per-user runtime decisions inside `processMessage`. Both comply with "runtime boundary is the only switch point."

   Failure mode: the worker binds `AGENT_RUNTIME_PORT` to a single selected implementation from environment at boot, while feature-flag work assumes per-workspace canary and shadow decisions. Shadow mode then requires both runtimes but the DI graph exposes only one. Kill switch semantics also become ambiguous: disable MAF globally, disable canary only, disable shadow only, or force TypeScript for a specific tenant.

   Required spine correction: specify the runtime router as the port implementation, the exact modes (`typescript`, `maf_shadow`, `maf_canary`, `maf_disabled` or equivalent), routing precedence, flag inputs, kill switch behavior, and whether routing is evaluated per job.

5. [P1] Tool authorization is outside the spine, so Python tools and TypeScript APIs can disagree on trust boundaries.

   Pair: `agent-service/src/agent_service/infrastructure/ts_api_client.py` and TypeScript API/read-model endpoints or internal application services.

   Both units can obey AD-2, AD-3, and AD-10: Python calls TypeScript domain APIs/read models, TypeScript owns policies, and MAF stays isolated. They can still build incompatibly because the spine does not specify the internal auth mechanism, service identity, tenant scoping, allowed tool set, or whether Python may call public admin endpoints. The repo already has a shared `ADMIN_API_KEY` pattern for admin APIs; nothing in the spine prevents the Python client from reusing it, while the TypeScript team may expect a separate internal service credential with scoped claims.

   Failure mode: Python sends tenant IDs in JSON with a shared key; TypeScript endpoints trust the key and caller-provided tenant IDs; a later hardening pass requires mTLS/JWT/service claims and breaks Python tools. Or Python implements read-only tools while TypeScript expects proposal validation endpoints that also reserve idempotency keys. Both are compatible with the AD language, not with each other.

   Required spine correction: define the internal service auth contract: credential type, header names, tenant/workspace claims, endpoint allowlist, read versus command capabilities, audit fields, and local-development behavior.

6. [P1] Retry ownership is ambiguous across BullMQ, HTTP client, Python workflow, model calls, and tool calls.

   Pair: BullMQ `ConversationProcessor` retry/failure behavior and `agent-service` workflow/tool retry behavior.

   Both units can obey AD-4 and AD-5: JSON HTTP is used, failures are classified, and actions carry idempotency keys. They can still build incompatibly because the spine lists error classes but not retry policy, timeout budget, retryable/non-retryable mapping, or backoff ownership. BullMQ already retries the whole job; a Python workflow may also retry model calls and tool calls; the HTTP client may retry on timeout. Without a single budget, a single inbound turn can multiply model cost, hold the worker too long, and produce inconsistent candidates.

   Failure mode: Python retries tool calls internally after a timeout while the worker marks `timeout` as safe to fall back; BullMQ retries the entire job; shadow instrumentation sees three candidate runtimes for one message with different runtime attempts. The ADs require idempotency keys but do not ensure all retry layers use the same key or attempt number.

   Required spine correction: define retry budgets and ownership per layer: BullMQ job retry, HTTP request retry, Python workflow retry, model/tool retry, and action execution retry. Tie all attempts to `requestId`, `eventId`, `runtimeAttempt`, and `actionId`.

7. [P1] Observability fields are named, but the telemetry schema and sink ownership are not.

   Pair: `apps/worker/src/conversation/llm-run.repository.ts` / runtime diagnostics storage and `agent-service/src/agent_service/infrastructure/telemetry.py`.

   Both units can obey AD-6 and the trace propagation convention: TypeScript records current and candidate results, Python emits trace IDs and counts. They can still build incompatibly because the spine does not define the diagnostics record schema, metric units, cost currency, token accounting source, validation status enum, or trace/span propagation mechanics. The current worker records a single `llm_runs` row with hard-coded model `gpt-4o`, latency, status, tenant, user, and trace ID; the spine requires model-call count, tool-call count, cost, risk, memory candidates, and proposed actions for both runtimes.

   Failure mode: Python emits OpenTelemetry spans and Prometheus metrics while TypeScript shadow mode expects rows in Postgres; Python reports per-model-call latency while TypeScript records end-to-end runtime latency; cost is counted in USD by one side and raw tokens by the other. Both satisfy "records diagnostics" but cannot power rollout gates without a reconciliation job.

   Required spine correction: define the shadow/diagnostics storage owner, table/event shape, enums, units, sampling policy, trace header requirements, and redaction rules for candidate outputs.

8. [P1] Deployment topology for `agent-service` is missing, so the service can be implemented but not deployable with the current fleet.

   Pair: `agent-service` packaging/deploy assets and existing Railway/GitHub auto-deploy services (`api`, `worker`, `dashboard`).

   Both units can obey AD-11 and AD-12: the Python service uses FastAPI routes over core MAF and Python 3.13.x. They can still build incompatibly because the spine names a folder and stack versions but not a Dockerfile, build tool, lockfile policy, health endpoints, Railway service, environment variables, network address, readiness dependencies, or secret ownership. The existing Railway memory documents only `api`, `worker`, and `dashboard` auto-deploy services. A Python team can add `agent-service/pyproject.toml`; an ops team can keep auto-deploy configured for three Node services. Both obey the spine; no production MAF service exists.

   Failure mode: `MafAgentRuntimeClient` is merged expecting `AGENT_SERVICE_URL`, but Railway never deploys `agent-service`, or deploys it without `/health/ready`, Python 3.13.14, model credentials, Redis/Postgres session backend, and internal auth secrets. Canary cannot start even though all code-level ADs are satisfied.

   Required spine correction: define deployable unit metadata: service name, Docker/build strategy, start command, health/readiness endpoints, env vars, secret sources, network URL consumed by worker, and rollout order.

9. [P2] Session/checkpoint storage is split conceptually but not by owner, schema, or recovery behavior.

   Pair: Python MAF session/checkpoint persistence and TypeScript conversation history/context loading.

   Both units can obey AD-7 and AD-8: Python avoids process-local production state and includes Slack conversation scope in session keys; TypeScript keeps canonical conversation history. They can still build incompatibly because the spine defers the session store backend and does not state what lives in "session state" versus "workflow checkpoints" versus "conversation history." It also does not define TTL, encryption, deletion, replay recovery, or whether TypeScript can invalidate Python state after memory corrections or privacy deletion.

   Failure mode: Python stores summarized conversation state in Redis keyed by workspace/user/conversation/thread, while TypeScript loads last 20 messages and applies memory corrections independently. After a user corrects memory or invokes deletion, Python's session cache keeps stale context. Both units obey split responsibility but produce different replies and risk classifications.

   Required spine correction: define state categories, persistence backend for first canary, schema ownership, TTL/retention, privacy deletion propagation, replay behavior, and checkpoint recovery tests.

10. [P2] Generated versus hand-maintained validators allow silent schema drift.

    Pair: TypeScript validator/package owner and Python Pydantic schema owner.

    Both units can obey AD-3 because the spine explicitly allows "generated or hand-maintained validators." They can still build incompatibly because "or" is the drift path. If TypeScript updates `SituationClassificationSchema` or `RiskDetectionSchema` while Python hand-maintains equivalent Pydantic models, the boundary can keep passing basic JSON validation while semantically diverging on enum values, optional/nullish defaults, date coercion, or required diagnostics.

    Failure mode: TypeScript accepts `confirmation` as a conversation mode and Zod defaults missing `dialogueAct` to `new_substance`; Python rejects the mode or treats missing `dialogueAct` as null. Shadow comparisons classify this as model divergence instead of contract divergence.

    Required spine correction: select one schema-generation direction for first slice and require contract tests that instantiate both validators against the same fixtures.

11. [P2] Error taxonomy is client-only and does not define HTTP semantics.

    Pair: FastAPI route exception handling and `MafAgentRuntimeClient` error classification.

    Both units can obey the error convention by using labels such as `unavailable`, `validation_error`, `timeout`, and `unsafe_partial_result`. They can still build incompatibly because the spine does not map HTTP status codes, response bodies, retryability, fallback eligibility, or redaction requirements to those labels.

    Failure mode: Python returns `422` for invalid runtime payloads, `409` for duplicate request IDs, and `503` for dependency failures. TypeScript maps every non-2xx to `unavailable` and falls back, including validation and duplicate request cases where fallback is unsafe or misleading. The AD text is satisfied but failure behavior is wrong.

    Required spine correction: define an error response schema and a mapping table: HTTP status, error code, retryable, fallback allowed, side-effect barrier status, and diagnostic fields.

12. [P2] Capability map assigns areas but not acceptance ownership, so baseline gates can be satisfied by the wrong surface.

    Pair: `packages/conversation-sim` migration gate work and shadow-mode diagnostics/runtime router work.

    Both units can obey AD-6 and AD-9: one extends simulations, the other records shadow results. They can still build incompatibly because the spine does not define how simulation scenarios invoke both runtimes, how candidate outputs are captured, or whether gates evaluate the current TypeScript port result, the HTTP MAF result, or post-TypeScript policy-applied actions.

    Failure mode: simulation work tests Python locally against fixture JSON while worker shadow mode records candidates from production jobs using a different adapter and validator. Baselines pass, but canary data fails because the gate never exercised the same runtime path.

    Required spine correction: require migration gates to execute through the same runtime router/client contract used by the worker, and require fixtures for request/result/action envelopes plus shadow diagnostics.

## Cross-Cutting Required Decisions Before Implementation

- Canonical request/result schema and schema source of truth.
- Runtime router mode model, flag precedence, and kill switch semantics.
- Proposal/action envelope, execution lifecycle, and persisted side-effect barrier.
- Internal service authorization contract for Python-to-TypeScript calls.
- Retry and timeout budget across BullMQ, HTTP, Python workflow, model calls, and tool calls.
- Shadow diagnostics schema, trace propagation, units, and storage owner.
- `agent-service` deployment service definition, health endpoints, env vars, and rollout order.

## Top Risks

- P0: the current TypeScript port and richer target HTTP contract are mutually incompatible unless an adapter or port expansion is mandated.
- P0: side-effect and fallback safety cannot be proven without a persisted action/attempt ledger.
- P1: runtime selection and shadow mode require a router, not a single concrete provider binding.
- P1: service-to-service authorization and deployment topology are absent from the spine.
