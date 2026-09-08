# Adversarial Divergence Review — Runtime Data Ownership

Target: `ARCHITECTURE-SPINE.md`

Date: 2026-08-19

Verdict: **FAIL as a build substrate for shared runtime data and mutation.** The ADs establish the right high-level owner — TypeScript owns durable product state — but two teams can follow every AD and still build incompatible context snapshots, mutation timing, ledger semantics, and recovery behavior. The current implementation already contains both interpretations and exposes the divergence.

## Independently Built Unit A — Prefetched Snapshot / Worker Committer

This team interprets the spine as follows:

- `ConversationProcessor` reads PostgreSQL and builds the complete immutable context for one runtime attempt.
- `MafAgentRuntimeClient` sends that context in `RuntimeProcessMessageRequest`.
- `agent-service` is a pure candidate generator and returns uncommitted proposals.
- `MafPrimaryAgentRuntime` validates proposals and writes messages, risk signals, memories, goals, and scheduled actions through TypeScript repositories.
- The worker owns `runtime_attempts`, `runtime_actions`, and the fallback barrier.
- Python session/checkpoint state is workflow-only and never overrides the request snapshot.

This unit complies with AD-1, AD-2, AD-3, AD-4, AD-5, AD-10, AD-13, AD-15, and AD-18.

## Independently Built Unit B — Tool-Loaded Context / TypeScript Command Endpoints

This team interprets the same spine as follows:

- `ConversationProcessor` sends identity, message, and an initial context seed.
- `agent-service` loads authoritative context on demand through scoped TypeScript read tools.
- Python owns durable workflow session/checkpoint state and may refresh context between workflow steps.
- Python invokes TypeScript command endpoints for an accepted memory, goal, or follow-up; TypeScript validates and writes each command.
- Python returns action envelopes containing the commit markers received from TypeScript.
- The worker records the returned attempt/action state and uses it for fallback.

This unit also complies with AD-1, AD-2, AD-3, AD-4, AD-5, AD-7, AD-8, AD-10, AD-15, AD-16, and the explicit AD-2 allowance for "proposals or commands." Python never writes product tables directly; TypeScript still validates and performs every write.

## Collision

The two units cannot compose safely:

| Concern | Unit A | Unit B | Result |
| --- | --- | --- | --- |
| Attempt context | Immutable worker snapshot | Tool-time API snapshot | Policy and reply can see different state |
| Context authority | Runtime request | Internal context read model | No deterministic replay input |
| Mutation timing | After candidate returns | During Python workflow | Worker cannot reliably know fallback barrier |
| Action lifecycle | Worker validates and commits | Python reports TypeScript command commits | Two ledger writers/interpretations |
| Session state | Workflow-only cache | Context-bearing durable state | Privacy correction and replay semantics diverge |
| Failure recovery | BullMQ retries whole attempt | Python/tool retries may have committed commands | Duplicate or missing effects |

## Findings

- The spine never selects one context authority for a runtime attempt. The current worker constructs `RuntimeContext` from `messages`, `memory_items`, and style state in `ConversationProcessor.loadMafCandidateContext`, while `agent-service` independently calls `POST /internal/maf/context/read`. Both are TypeScript-owned reads, so both satisfy the ADs, but they are taken at different times and expose different fields.

- The current workflow demonstrates a split-brain inside one request. `_load_context_from_tool` stores the tool response in `state["context"]`; deterministic policy and goal-action generation read `_context_from_state(state)`. The model prompt's `candidate_reference_context`, reply plan, style adaptation, and recent-turn grounding continue to read `request["context"]`. A single candidate can therefore apply policy against one snapshot and generate prose against another.

- The two context shapes are not substitutable. The runtime contract requires recent turns with `role`, `content`, and `timestamp`; `InternalMafContextService.formatRecentTurn` returns only `id`, `direction`, `senderType`, `messageType`, and `occurredAt`. The Python response validator permits this because it only bounds object arrays and treats `textPreview` as optional. Tool-loaded history cannot provide the conversational grounding already present in the worker request.

- AD-2 still permits two incompatible mutation protocols by saying Python may return "proposals or commands." A proposal-only runtime commits after the HTTP response; a command-driven runtime can cross the side-effect barrier before the response. AD-5 and AD-15 cannot define fallback from the same observable point until one protocol is selected for the first slice.

- The runtime HTTP schema permits Python to return an action with `executionStatus: "committed"` and a non-null `commitMarker`, even though the current first-slice implementation is proposal-only. Nothing in the contract proves that the marker came from a TypeScript command endpoint or ties it to the canonical `runtime_actions` row. A contract-valid result can claim a commit that the worker cannot verify.

- The implemented ledger records the barrier after product side effects. `MafPrimaryAgentRuntime.processMessage` persists risk, the outbound message, the message-send job, follow-ups, memory/goal proposals, and extraction jobs before invoking `onPostCandidateResult`. Only that callback records `candidate_received`, `actions_validated`, action envelopes, and `actions_committed`. A crash or queue error before the callback leaves durable effects behind an attempt still recorded as `started` or `failed`, so the ledger cannot safely answer whether fallback is legal.

- Attempt phase and action rows can contradict each other. `recordActionEnvelopes` stores the Python envelope's `executionStatus` and `commitMarker`, which are normally `not_started` and `null`; the next line unconditionally transitions the attempt to `actions_committed`. The canonical store can therefore state that all actions are committed while every child action states that execution has not started.

- Best-effort mutation failures are erased from the barrier. Follow-up, memory, and goal application catch and suppress repository errors, but the post-candidate callback still marks the attempt `actions_committed`. AD-15 requires execution status and commit markers precisely to distinguish these outcomes; the implementation currently records the candidate lifecycle, not the TypeScript execution lifecycle.

- The spine does not define whether the outbound message row, BullMQ message-send job, or external Slack send is the reply commit point. The implementation writes the message and queues send before action-ledger recording, then marks `reply_committed` after `MafPrimaryAgentRuntime` returns. Without a durable database outbox or an explicit weaker definition, PostgreSQL and Redis can disagree while the attempt reports a terminal phase.

- `sessionKey` is validated and forwarded to the internal context endpoint but is not used to scope the database query or verified against workspace/user/conversation/thread. The service verifies the component IDs independently, which is useful, but AD-8's canonical session identity is not enforced by the read boundary. Two different session-key encodings can address the same data and fork Python checkpoints.

- AD-7 requires durable session/checkpoint storage before non-local shadow execution, but the current `RuntimeStateStore` is only instantiated by readiness checks and is not wired into `ConversationWorkflow`. The non-local guard accepts SQLite, while the spine never defines a mounted durable volume, multi-replica locking, retention, or checkpoint recovery. A team can pass readiness without any workflow state being recoverable.

- Conversation history deletion and memory correction do not have an invalidation contract for Python session/checkpoint state. Unit A naturally re-reads PostgreSQL on the next attempt; Unit B may retain derived context in its durable session. Both comply with AD-7's separation of history and session state, but they produce different replies after deletion, supersession, or consent change.

- AD-14 declares `packages/contracts/runtime/openapi.json` canonical, while the same spine still lists the OpenAPI source as Deferred and asks whether Zod, Pydantic, or OpenAPI should be canonical. The implementation also packages a second physical copy at `agent-service/src/agent_service/contracts/openapi.json` and relies on a parity test. A team following the AD edits the canonical file; a team following the Open Question can legitimately replace the source direction.

- The internal auth design proves that claims match the JSON body, but the current shared-secret client mints tenant/workspace claims from the runtime request itself. The spine does not state whether the agent service receives a tenant-scoped credential from the worker or holds a fleet-wide signing secret. Those choices have different blast radii and neither violates the wording of AD-16.

- Survey-derived state has no single mutation/read invariant for future MAF actions. `survey_evidence` is raw evidence, `survey_assessments` is a derived per-question state, and `survey_group_states` is another materialization. The dashboard already compensates for assessment/evidence drift in presentation code. A future Python survey proposal or TypeScript command can update one layer and still satisfy AD-2 unless the aggregate commit set is defined.

- The spine's canonical-ledger requirement does not define a transaction boundary spanning the attempt row, action rows, product aggregate rows, and queued effects. Unit A can mark actions after repository writes; Unit B can mark each command endpoint independently. Both use the same tables and idempotency keys, but partial failure produces different terminal states and retry behavior.

## Minimal Closure

Choose Unit A for the first production slice. It matches the existing request contract and requires fewer distributed states:

1. Declare the runtime request context the immutable context authority for one attempt; remove the internal context tool from the first reply/policy/action path. Reintroduce refresh only with an explicit snapshot version and merge rule.
2. Restrict first-slice results to uncommitted proposals. Forbid `executionStatus: "committed"` from `agent-service`; defer command tools to a new ownership-transfer/command AD.
3. Record `candidate_received` before any product side effect. Persist validated action envelopes before applying them, update each action row with the actual TypeScript execution result, and derive the attempt phase from those rows.
4. Define reply commit as one durable local event. Prefer a PostgreSQL outbox row written with the outbound message; let BullMQ/Slack delivery be downstream delivery state.
5. Either wire a selected durable runtime-state backend into workflow execution with recovery tests or remove the unused non-local readiness claim until that backend exists.
6. Remove the stale Deferred/Open Question entries that contradict AD-14; keep the packaged Python OpenAPI copy generated or parity-gated as an artifact, never as an editable source.
7. Define survey evidence/assessment/group-state updates as one TypeScript aggregate operation before adding survey mutations to the runtime action vocabulary.

Until these decisions are explicit, the spine protects language/framework boundaries but not the actual shared-data and mutation boundary that controls fallback safety.
