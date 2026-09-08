# Version / Reality Reviewer Gate — MAF Runtime Migration

Target: `ARCHITECTURE-SPINE.md`

Review date: 2026-08-19

Lens: reality-check every committed architecture decision and named technology against the current repository, installed dependency graph, deployment documentation, and public package registries. The spine was not modified.

## Verdict

**Changes required; the spine is no longer safe as a current build substrate.** The high-level strangler boundary still fits the repository, and Python remains read-only with respect to TypeScript-owned aggregates. However, the canonical runtime schema is already divergent in the deployable Python package, the persisted fallback barrier is not synchronized with the side effects it claims to guard, and several “final” decisions are contradicted by the now-live `maf_primary` implementation. Lint is green, but semantic reality is not.

## Review Evidence

Repository evidence included:

- `apps/worker/src/conversation/conversation.processor.ts`
- `apps/worker/src/conversation/conversation.module.ts`
- `apps/worker/src/conversation/outbox.service.ts`
- `apps/worker/src/conversation/runtime-ledger.repository.ts`
- `apps/worker/src/conversation/runtime-fallback-barrier.service.ts`
- `apps/worker/src/conversation/shadow-diagnostics.repository.ts`
- `packages/application/src/use-cases/agent-runtime-router.ts`
- `packages/application/src/use-cases/agent-runtime-mode-resolver.ts`
- `packages/application/src/use-cases/maf-agent-runtime-client.ts`
- `packages/application/src/use-cases/maf-primary-agent-runtime.ts`
- `packages/application/src/use-cases/conversation-orchestrator.ts`
- `packages/application/src/use-cases/runtime-fallback-barrier.ts`
- `packages/contracts/runtime/openapi.json`
- `agent-service/src/agent_service/contracts/openapi.json`
- `agent-service/src/agent_service/api/runtime.py`
- `agent-service/src/agent_service/workflows/conversation_workflow.py`
- `agent-service/src/agent_service/tools/context_tool.py`
- `agent-service/src/agent_service/infrastructure/runtime_state.py`
- `agent-service/pyproject.toml`, `agent-service/Dockerfile`, root `package.json`, installed pnpm graph, and root `docker-compose.yml`
- `docs/superpowers/railway-deploy.md`, last verified 2026-08-15

Executed checks:

- BMad spine lint: passed with zero findings after redirecting `uv` cache to a writable temporary directory.
- `pnpm list -r --depth 0 typescript @nestjs/common bullmq drizzle-orm`: confirmed installed brownfield versions.
- Local Python metadata: Python 3.13.13, FastAPI 0.141.1, `agent-framework-core` 1.13.0, httpx 0.28.1, Pydantic 2.13.4, Uvicorn 0.35.0.
- Public registries on 2026-08-19: FastAPI 0.141.1; `agent-framework-core` 1.14.0; `agent-framework-hosting` 1.0.0a260730 (Alpha); TypeScript 7.0.2; BullMQ 6.1.2; Drizzle ORM 0.45.2; NestJS 11.2.1; pnpm 11.22.0.
- Schema parity: SHA-256 hashes differ; the packaged Python schema lacks `greeting_opens_conversation` from the canonical enum.
- `agent-service/.venv/bin/pytest agent-service/tests/unit/test_runtime_contract.py -q`: **failed** 1 of 4 tests at `test_python_service_packages_shared_runtime_openapi_schema`.

## Critical Findings

### [Critical] AD-14 is false in the artifact that is actually deployed

The spine requires one neutral OpenAPI source and parity before either boundary implementation exists (`ARCHITECTURE-SPINE.md:129-133`). The repository carries two checked-in schema files. They are not equal:

- canonical: `packages/contracts/runtime/openapi.json`
- packaged/deployable: `agent-service/src/agent_service/contracts/openapi.json`
- difference: the packaged schema omits `greeting_opens_conversation` at the reply-plan reason enum around line 509.

Local Python tests prefer the repository copy because `runtime_contract.py:35-51` searches the monorepo path first. The `agent-service` Docker build copies only the service directory, so production falls back to the stale packaged copy. This is precisely the divergence AD-14 says cannot happen, and the dedicated parity test currently fails.

Required correction: make the deploy artifact consume or generate the canonical file during build, and make schema parity a required pre-push/CI check. Do not keep two manually synchronized authoritative copies.

### [Critical] AD-5/AD-15 ledger phases do not represent the real side-effect boundary

`MafPrimaryAgentRuntime.processMessage` persists the outbound message and enqueues message delivery at `maf-primary-agent-runtime.ts:71-92`; it then performs more side effects and only afterwards calls `onPostCandidateResult` at lines 94-110. The worker callback advances `candidate_received`, `actions_validated`, writes action envelopes, and marks `actions_committed` at `conversation.module.ts:170-177`.

Consequences:

- A process or database failure after message persistence/queueing but before ledger advancement leaves the attempt at `started`, which the fallback classifier treats as open.
- The queued BullMQ job has three whole-job attempts, while `OutboxService.enqueueMessageSend` supplies no deterministic BullMQ `jobId`; retry can create and send another outbound message.
- `runtime_actions` rows preserve Python's `executionStatus`, usually `not_started`, but the attempt is still marked `actions_committed` unconditionally.
- A ledger callback failure happens after the user-facing side effects and can fail the whole conversation job, even though the router comments say observability must not mask runtime success.

The barrier is durable, but not causally or transactionally aligned with the effects it guards. The smallest safe architecture correction is one TypeScript commit unit with an idempotency key anchored to the inbound message/runtime attempt, followed by ledger state derived from committed records. A true PostgreSQL outbox is warranted if enqueue-after-commit delivery guarantees are required; the current `OutboxService` is a direct BullMQ adapter, not a transactional outbox.

### [Critical] The runtime endpoint has configured-but-unused authentication

The worker resolves `INTERNAL_SERVICE_AUTH_SECRET` and passes it as `serviceAuthSecret` (`conversation.module.ts:105-110,400-433`), and `MafAgentRuntimeClient.optionsSnapshot` reports whether it is configured. The request itself sends only `content-type` and `x-trace-id` (`maf-agent-runtime-client.ts:289-297`). The FastAPI application mounts `/runtime/process-message` without an auth dependency or middleware (`agent-service/main.py:7-18`, `api/runtime.py:39-94`).

AD-16 correctly protects Python-to-TypeScript context reads with scoped read tokens, endpoint allowlists, tenant/workspace claims, and audit rows. It does not cover the reverse TypeScript-to-Python runtime call, leaving a production service boundary unauthenticated despite a secret setting that implies otherwise. Add one explicit runtime-call auth invariant or remove the misleading unused option only if network isolation is documented and verified as the accepted control.

## High Findings

### [High] AD-2/AD-10 preserve write ownership, but not policy ownership

Python does not write messages, memories, goals, follow-ups, surveys, risk signals, runtime attempts, or queues. Its only TypeScript tool is `ReadOnlyContextTool`, using scoped `read` permission. The write-ownership half of AD-2 passes.

The stronger claim that existing TypeScript policies validate every side effect does not. `MafPrimaryAgentRuntime` maps and persists Python risk severity/confidence directly, uses Python's survey-block flag, and applies proposals primarily by shape/status/deduplication checks. Quiet hours, consent, follow-up cooldown, safety thresholds, and memory policy are not re-evaluated in one shared TypeScript policy path. Meanwhile the legacy `ConversationOrchestrator` contains a separate policy-and-commit implementation.

Required correction: separate candidate generation from one shared TypeScript `validate-and-commit-turn` use case. Both the legacy generator and MAF candidate provider should feed that same policy/side-effect owner. This removes drift instead of adding another policy layer.

### [High] Python proposals are not executable, yet the ledger calls them committed

The default Python workflow emits memory, goal, and follow-up actions with `validationResult.status: pending` and `executionStatus: not_started` (`conversation_workflow.py:554-582,639-704`). The only policy transition changes blocked follow-ups to `invalid/blocked`; it never changes allowed actions to `valid` (`conversation_workflow.py:585-593,716-737`). TypeScript applies only `valid + not_started` actions (`maf-primary-agent-runtime.ts:191-196,260-265,314-319`). Therefore default MAF memory/follow-up/goal proposals are not applied, while the runtime attempt is still marked `actions_committed`.

Choose one owner for validation status. The lean choice is: Python returns proposals as `pending`; TypeScript validates them, persists the resulting status/commit marker, then advances the attempt. Until that exists, remove the unused proposal application branches or do not claim committed action evidence.

### [High] AD-7's durable runtime state exists only as readiness scaffolding

`runtime_state.py` implements memory and SQLite session/checkpoint stores, and readiness performs a single missing-session read. No production workflow calls `create_session_key`, reads/writes sessions, or reads/writes checkpoints. Conversation state instead arrives in each request from TypeScript.

At the same time the spine says non-local/production execution requires durable session/checkpoint storage, while Railway documentation says `agent-service` is deployed and verifies a SQLite volume. The service is effectively stateless; the durable store is unused ceremony.

Required correction: decide based on actual need. If requests are intentionally self-contained, remove AD-7's storage mandate and delete unused runtime-state/volume machinery. If workflow recovery really requires checkpoints, wire the store into the workflow before calling the invariant satisfied.

### [High] AD-13 and the runtime-mode conventions predate the live primary mode

The spine defines precedence as kill switch → denylist → shadow → canary → TypeScript and lists modes without `maf_primary` (`ARCHITECTURE-SPINE.md:123-127,175`). Current code is kill switch → denylist → shadow → **primary** → canary → TypeScript (`agent-runtime-mode-resolver.ts:18-59`), and `maf_primary` is in the router, ledger schema, feature flags, tests, production runbook, and production acceptance evidence.

The “final” spine therefore omits the production mode that now dominates the migration. Update AD-13, mode conventions, diagrams, rollout/gate rules, and fallback semantics together; do not merely add one enum value.

### [High] The spine's W3C trace-context convention is not implemented

No `traceparent`, `tracestate`, or `baggage` references exist in app/package/agent-service source. Slack ingest creates a random UUID `traceId`; the MAF HTTP client sends `x-trace-id`; the Python context tool forwards `x-trace-id`. This is correlation-ID propagation, not W3C trace context (`ARCHITECTURE-SPINE.md:180`).

Either implement actual W3C headers with the existing observability stack or rename the convention to correlation-ID propagation. Keeping a stronger false claim makes operational debugging worse.

### [High] The spine contains decisions simultaneously marked adopted, deferred, and open

AD-14 commits neutral OpenAPI at a fixed path, but Deferred says “OpenAPI source of truth” is undecided and Open Questions asks Zod vs Pydantic vs neutral OpenAPI (`ARCHITECTURE-SPINE.md:129-133,268,276`). AD-7 requires a durable backend before non-local execution, while Deferred/Open Questions still ask which backend after SQLite support and a Railway volume were added (`lines 87-97,267,275`). The first-canary question is historical now that `maf_primary` is in production documentation (`line 274`).

Resolve or delete these stale entries. A final spine cannot ask builders to re-decide its adopted invariants.

## Decision-by-Decision Reality Matrix

| Decision | Verdict | Current reality |
| --- | --- | --- |
| AD-1 Runtime boundary | Pass | Inbound conversation jobs call injected `AGENT_RUNTIME_PORT`; the processor does not import Python/MAF types. |
| AD-2 TS side-effect ownership | Partial | Python proposes and reads context only; TypeScript writes. Shared TypeScript policy validation is incomplete and duplicated. |
| AD-3 MAF confinement | Pass | `agent_framework` imports are confined to `agent-service`; TS contracts are framework-neutral. |
| AD-4 JSON HTTP | Pass | Single JSON `POST /runtime/process-message`; no SSE/streaming dependency. |
| AD-5 fallback barrier | Fail | Ledger phase lags real DB/queue side effects and is not transactional/idempotent with them. |
| AD-6 shadow first-class | Partial | Canonical records exist, but comparisons are stored as `not_compared` and estimated cost is always `0`. |
| AD-7 durable split state | Fail | Store/readiness scaffolding exists; workflow never uses sessions or checkpoints. |
| AD-8 scoped session keys | Partial | Worker constructs workspace/user/conversation/thread-or-DM key; no runtime state consumer uses it. |
| AD-9 rollout gates | Unverified/stale | Gate scripts and runbooks exist, but the spine has no current evidence link showing the declared gate preceded live primary rollout. |
| AD-10 deterministic policy | Fail/partial | Some TS shape, dedupe, and risk persistence checks exist; material policy decisions are accepted from Python and legacy/MAF paths diverge. |
| AD-11 FastAPI/no hosting helpers | Pass | FastAPI-owned routes; no hosting helper dependency. Hosting remains Alpha upstream. |
| AD-12 Python line | Partial | `>=3.13,<3.14` and `python:3.13-slim` enforce the minor line, but exact 3.13.14 is not pinned; local runtime is 3.13.13. |
| AD-13 router owns selection | Fail/stale | Router owns selection, but actual precedence includes `maf_primary`, absent from the decision and conventions. |
| AD-14 one schema source | Fail | Canonical and packaged schemas differ; the parity test fails. |
| AD-15 attempt/action ledger | Fail | Tables and keys exist, but `actions_committed` is advanced without committed action rows and after external effects. |
| AD-16 scoped tool auth | Pass | Read token contains tenant/workspace/permission/allowlist claims; TS guard validates and audits. Runtime-call auth remains an uncovered seam. |
| AD-17 layered retries | Partial | BullMQ attempt propagates; model retry diagnostics exist. HTTP error bodies/budgets are not consumed, and the 269-line runtime error classifier has no production caller. |
| AD-18 canonical diagnostics | Partial | TypeScript/Postgres store and redaction exist; comparison/cost content is placeholder-level. |
| AD-19 deployable service | Pass | Dockerfile, start command, health/readiness, env, Railway service, GitHub auto-deploy, and readiness script are documented. |

## Technology / Version Reality

| Spine entry | Repository/deploy reality | 2026-08-19 upstream reality | Verdict |
| --- | --- | --- | --- |
| Node.js 22.x | API/worker/dashboard use floating `node:22-alpine`; root engine still permits EOL-prone `>=20` | Not required to change this feature spine | Accurate deploy major; patch and root floor are not pinned/aligned. |
| pnpm 9.12.0 | Exact root `packageManager` pin | 11.22.0 latest | Accurate intentional brownfield pin, not current upstream. |
| TypeScript 5.9.3 | Installed/locked 5.9.3; manifests declare `^5.6.3` | 7.0.2 latest | Accurate lock reality; major upgrade is separate work. |
| NestJS 10.4.22 | Installed/locked 10.4.22 | 11.2.1 latest | Accurate brownfield version; not current upstream. |
| BullMQ 5.80.5 | Installed/locked 5.80.5 | 6.1.2 latest | Accurate brownfield version; retry/idempotency semantics must be verified before major upgrade. |
| Drizzle 0.35.3 | Installed/locked 0.35.3 | 0.45.2 latest | Accurate brownfield version; not current upstream. |
| PostgreSQL 16 | Local image is `pgvector/pgvector:pg16`, not plain PostgreSQL | Major-family tag floats | Fit is correct; name the pgvector image family and pin digest/tag for reproducible deploys if local parity matters. |
| Redis 7 | Local image is floating `redis:7-alpine` | Major-family tag floats | Fit is correct; exact patch is not a lock. |
| Python 3.13.14 | Pyproject pins minor range; Docker uses floating `3.13-slim`; local venv is 3.13.13 | 3.14 support is advertised by FastAPI and MAF core | Exact spine patch is not repository reality. State “3.13.x compatibility pin” or pin the image patch. |
| FastAPI 0.141.1 | Allowed range `<0.142`; local 0.141.1 | 0.141.1 latest, PyPI Beta classifier | Current and fitting for the small owned JSON service. |
| Agent Framework core 1.13.0 | Allowed range `>=1.13,<1.14`; local 1.13.0 | 1.14.0 latest, Production/Stable, Python 3.14 supported | Accurate compatibility pin, stale as “current”; record why `<1.14` remains. |
| `agent-framework-hosting` deferred | Not installed | 1.0.0a260730, Alpha | AD-11 remains valid. |

The stack table should distinguish **deployed image**, **manifest compatibility range**, **lock/installed version**, and **upstream current**. Exact-looking rows currently mix all four meanings.

## Structural Seed and Fit

The structural seed is historical rather than current. The implemented service uses `api/runtime.py`, `contracts/runtime_contract.py`, `workflows/conversation_workflow.py`, `workflows/model_provider.py`, `tools/context_tool.py`, and infrastructure modules. It does not contain the proposed `application/`, `agents/`, or `domain/` trees or the named `memory_tools.py`, `goal_tools.py`, and `followup_tools.py` files.

Because code owns structural shape after bootstrap, the lean correction is to delete the obsolete tree from the final spine rather than continually mirror the repository. Keep only non-obvious boundary rules and the workflow diagram if it still constrains independently built work.

## Over-Engineering / Ponytail Findings

`packages/application/src/use-cases/runtime-error-classifier.ts:L1-269: delete: production has no caller; Python retryable/fallbackAllowed bodies are discarded by the MAF HTTP client. Remove until the router actually consumes structured runtime errors.`

`apps/worker/src/conversation/conversation.module.ts:L325-390: delete: exported createMafPrimaryRuntimePort duplicates production factory wiring and has no non-test production caller. Tests can construct MafPrimaryAgentRuntime directly.`

`packages/application/src/use-cases/typescript-agent-runtime.ts:L1-14: yagni: one-method wrapper only renames ConversationOrchestrator.orchestrate. Let the orchestrator satisfy the runtime port or use a one-line adapter at DI.`

`packages/application/src/use-cases/maf-agent-runtime-client.ts:L115-128: yagni: client claims AgentRuntimePort but processMessage always throws. Implement only MafAgentRuntimeCandidateProvider.`

`agent-service/src/agent_service/infrastructure/runtime_state.py:L27-192: delete: 228-line state abstraction plus SQLite implementation is not used by workflow execution. Remove if requests remain self-contained; wire it only when checkpoint recovery has a real consumer.`

`packages/contracts/src/runtime-contract-validation.ts + agent-service/contracts/runtime_contract.py: native: about 1,050 lines of duplicated hand-written OpenAPI-subset validation. Prefer standard schema validators or FastAPI/Pydantic plus generated/shared contract artifacts once AD-14 is repaired.`

`packages/application/src/use-cases/maf-primary-agent-runtime.ts + conversation-orchestrator.ts: shrink: two durable side-effect pipelines duplicate profile hydration, risk, reminder, outbound, memory/style/survey work. One TypeScript validate-and-commit use case with pluggable candidate generation removes the divergence.`

`apps/worker/src/conversation/conversation.module.ts:L112-141: shrink: process-local Map correlates ledger callbacks that already carry a durable compound key. Pass one attempt context through the call instead of remember/consume/clear bookkeeping.`

Conservative net after replacements: **approximately -1,100 production lines possible**, excluding tests and generated artifacts. The largest safe reduction comes from one shared TypeScript commit path and deleting currently unused runtime-state/error-classifier scaffolding.

## Required Spine Update Order

1. Repair AD-14 deploy parity and make the failing contract test green.
2. Redefine AD-5/AD-15 around the actual idempotent commit boundary; do not call action rows committed while they remain `not_started`.
3. Add authenticated TypeScript-to-Python runtime-call semantics or explicitly document verified private-network isolation.
4. Add `maf_primary` to AD-13, conventions, diagrams, gates, and fallback semantics; remove historical open questions.
5. Decide whether the service is intentionally stateless. Delete AD-7/storage scaffolding if yes; wire checkpoint recovery if no.
6. Consolidate TypeScript policy and durable side effects behind one commit use case used by both candidate generators.
7. Replace placeholder shadow comparisons/cost or weaken AD-6/AD-18 to what is actually recorded.
8. Refresh stack semantics and remove the obsolete structural tree.

## Gate Conclusion

The architecture direction remains recoverable without a rewrite: keep JSON HTTP, keep MAF confined to Python, keep Postgres/TypeScript as the durable policy boundary, and keep the router rollback controls. The next step is not another layer. It is to make one canonical contract, one authenticated runtime seam, and one idempotent TypeScript commit path tell the same truth as the ledger.
