# Good-Spine Reviewer Gate — 2026-08-19

Target: `../ARCHITECTURE-SPINE.md`

Intent: validate the existing spine without modifying it.

## Verdict

**FAIL as a current build substrate; the design direction remains sound, but the spine is stale at the exact runtime seams that now carry production behavior.** Mechanical structure passes. Semantic convergence does not: the document contradicts itself on the canonical contract, no longer matches the implemented runtime modes, and still permits independently built TypeScript units to commit the same class of side effects through different paths.

## Gate Execution

- Deterministic lint: `uv run .agents/skills/bmad-architecture/scripts/lint_spine.py --workspace _bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05`
- Result: `ok: true`, zero findings.
- Rubric walker: all good-spine checklist items below.
- Configured reviewer lens 1: named-technology and brownfield reality check.
- Configured reviewer lens 2: adversarial two-unit divergence check.
- Reviewer execution was sequential because all available agent slots were occupied; the Reviewer Gate explicitly permits this fallback.

## Good-Spine Checklist

| Checklist item | Result | Evidence |
| --- | --- | --- |
| Fixes the real divergence points for the level below and misses none | **Fail** | Runtime selection is covered, but runtime-context authority and the single TypeScript reply/action commit seam are not. Current code already implements competing paths. |
| Every AD Rule is enforceable and prevents its stated divergence | **Fail** | AD-2 allows multiple TypeScript committers; AD-5/AD-15 do not bind commit ordering; AD-7 names durable state that is not used by workflow execution; AD-13 omits the implemented primary mode. |
| Nothing under Deferred can let two units diverge | **Fail** | The canonical OpenAPI source is both fixed by AD-14 and left Deferred/Open. The session backend remains deferred even though the service is deployed and runtime state code exists. |
| Named technology is verified-current | **Partial** | Node/Nest/BullMQ/Drizzle/TypeScript match the installed brownfield graph. FastAPI 0.141.1 and Agent Framework Core 1.13.0 match the local venv and the 2026-08-05 verification notes, but Python deployment is not locked to those exact versions. |
| Ratifies rather than contradicts the brownfield codebase | **Fail** | The implemented mode set includes `maf_primary`; actual precedence is shadow → primary → canary, while the spine omits primary from Conventions and AD-13. Runtime state is not wired into the workflow. |
| Covers the driving spec's capabilities | **Pass** | CAP-1 through CAP-4 are mapped and their main intent is represented by AD-1 through AD-19. The problem is current implementation convergence, not missing capability headings. |
| Does not weaken an inherited parent spine | **N/A** | No inherited parent spine is declared. |
| Every feature-altitude dimension is decided, deferred, or open | **Fail** | Cross-service contract evolution/deployment order and the authoritative commit transaction are silent. The operational envelope exists only as a seed, not as a version-skew or recovery invariant. |

## Critical Findings

### C1 — AD-14 is simultaneously adopted, deferred, and open

AD-14 fixes `packages/contracts/runtime/openapi.json` as the canonical OpenAPI 3.1 source. The Deferred table still says “OpenAPI source of truth” must be chosen, and Open Questions still asks whether Zod, Pydantic, or OpenAPI is canonical. Two teams can follow different parts of the same final document and both claim compliance.

**Disposition:** autofix in a spine update. Remove the stale Deferred row and Open Question; retain OpenAPI as the sole editable source and describe the Python copy as a generated/parity-checked artifact.

### C2 — TypeScript ownership does not identify one TypeScript committer

AD-2 prevents Python writes but does not prevent two TypeScript runtime implementations from independently saving the outbound message and enqueueing delivery. That is the current code:

- `ConversationOrchestrator.orchestrate` saves and enqueues at `packages/application/src/use-cases/conversation-orchestrator.ts:298` and `:330`.
- `MafPrimaryAgentRuntime.processMessage` repeats the commit at `packages/application/src/use-cases/maf-primary-agent-runtime.ts:71` and `:83`.

The paths have already drifted: MAF propagates `conversationThreadId` to `replyToExternalThreadId` (`maf-primary-agent-runtime.ts:91`), while the TypeScript path omits it. Both obey AD-2.

**Disposition:** discuss, then tighten AD-2/AD-15. One application-level committer must be the sole owner of outbound persistence, action application, ledger transitions, and queue publication. Runtime implementations should return one normalized candidate/result to that seam.

### C3 — The ledger rule does not bind ordering around real side effects

`MafPrimaryAgentRuntime` applies product side effects and queues work before invoking `onPostCandidateResult` (`maf-primary-agent-runtime.ts:55-105`). The callback then records candidate/actions phases in `apps/worker/src/conversation/conversation.module.ts:163-178`. A crash before the callback can leave product effects behind an attempt that still appears merely started or failed. AD-15 names phases but does not require candidate/action records to precede product mutation or require attempt state to derive from actual child-action commits.

**Disposition:** discuss. Amend AD-15 with one ordering invariant: persist candidate + validated action envelopes first; commit product effects idempotently; update each action from the real TypeScript result; derive attempt phase from those rows; define the outbound-message/outbox write as the reply commit point.

## High Findings

### H1 — AD-13 and Runtime Conventions are stale against the implemented router

The spine's Runtime modes omit `maf_primary`, and AD-13 precedence says kill switch → denylist → shadow → canary → TypeScript. Current `AgentRuntimeModeResolver.resolveDecision` implements kill switch → denylist → shadow → primary → canary → TypeScript (`packages/application/src/use-cases/agent-runtime-mode-resolver.ts:18-59`). This is a direct brownfield contradiction at the main switch point.

**Disposition:** autofix. Add `maf_primary`, bind the actual precedence, and state whether primary intentionally outranks canary when both flags are enabled.

### H2 — No authoritative context snapshot for one runtime attempt

The worker constructs message, memory, style, locale, reply-plan, and thread context in `ConversationProcessor.loadMafCandidateContext` (`apps/worker/src/conversation/conversation.processor.ts:318-430`). The Python runtime can also load context through `ReadOnlyContextTool`. The spine does not say whether the request snapshot or tool-time read is authoritative, how they merge, or which snapshot is replayed.

The ambiguity already costs work in TypeScript mode: `processInbound` hydrates MAF context before the router decides a mode (`conversation.processor.ts:278-292`); this includes a classifier call in `buildInboundReplyContext` (`:565-604`). `ConversationOrchestrator` then loads messages/memory and classifies again (`conversation-orchestrator.ts:55-113`).

**Disposition:** discuss. The smallest convergent first slice is an immutable worker-built request snapshot; tool refresh should be deferred until it has a snapshot version and merge rule. At minimum, hydrate MAF-only context only after the router selects a MAF mode.

### H3 — AD-7's durable runtime state is not part of runtime execution

`create_runtime_state_store` supports memory or SQLite and rejects memory for non-local shadow (`agent-service/src/agent_service/infrastructure/runtime_state.py:67-81`), but CodeGraph shows production consumers only in health/readiness; `build_runtime_workflow` does not inject or use the store (`agent-service/src/agent_service/api/runtime.py:97-150`). The current service is effectively request-stateless despite AD-7 and the Deferred backend decision.

**Disposition:** discuss. Either wire a selected durable store into workflow checkpoint recovery and document its deployment/locking/retention envelope, or explicitly update AD-7 to say the first production slice is stateless because canonical context arrives per request. Do not keep a readiness-only durability claim.

### H4 — Cross-service version skew and deploy ordering are unbound

AD-14 validates one schema and AD-19 makes `agent-service` deployable, but neither defines compatible contract evolution, worker/service rollout order, or the rollback rule when GitHub auto-deploy updates services independently. Two valid builds against adjacent OpenAPI revisions can reject each other during rollout.

**Disposition:** add an AD or Deferred item before the next contract change. Bind additive-first evolution, a contract version/capability handshake or explicitly synchronized rollout, and a rollback order that preserves the TypeScript path.

## Medium Findings

### M1 — Exact Python stack rows are not reproducible deployment pins

Local reality confirms FastAPI 0.141.1 and `agent-framework-core` 1.13.0, but `agent-service/pyproject.toml` declares ranges (`fastapi>=0.139,<0.142`, `agent-framework-core>=1.13,<1.14`) and no Python lockfile exists. `python:3.13-slim` also floats while the spine names Python 3.13.14; the current local venv is Python 3.13.13.

**Disposition:** defer or fix. Either add a deployment lock/pin, or label the Stack rows as tested versions within supported ranges instead of implying reproducible exact versions.

### M2 — Retry ownership is named but not numerically enforceable

AD-17 says budgets are layered and shared but fixes no total deadline, per-layer attempts, or source of remaining budget. BullMQ already defaults to three attempts, while the HTTP client uses a timeout signal and the Python layer reports its own retry counters. Two units can comply while multiplying work differently.

**Disposition:** defer with a revisit condition tied to the first production retry/timeout tuning, or bind one total deadline plus per-layer maxima now.

### M3 — Runtime retirement is not decided or explicitly deferred

The spine prevents early deletion of TypeScript through the driving spec, but the final spine has no exit condition for the strangler: when the old runtime and shadow-only compatibility machinery can be removed, and what evidence must remain.

**Disposition:** add to Deferred. Revisit after a sustained primary acceptance window and rollback drill; do not design the removal now.

## Configured Reviewer Lens — Version / Reality

- **Passed:** installed TypeScript 5.9.3, NestJS 10.4.22, BullMQ 5.80.5, Drizzle 0.35.3, FastAPI 0.141.1, and Agent Framework Core 1.13.0 match the Stack table; Node 22, PostgreSQL 16, Redis 7, pnpm 9.12.0, and Python 3.13 are present in manifests/images.
- **Caveat:** the external version verification is dated 2026-08-05. Local installation and active code prove the named Python technologies exist and fit this repository as of 2026-08-19, but not that every version is latest upstream.
- **Failure:** exact Python versions in the spine are not locked by the build.

## Configured Reviewer Lens — Adversarial Divergence

Two independently built units can obey every AD and still be incompatible:

1. **Snapshot unit:** worker supplies an immutable context; Python returns uncommitted proposals; one TypeScript committer applies them after the response.
2. **Tool-refresh unit:** Python refreshes context during the workflow and invokes TypeScript command endpoints; returned envelopes may already carry commit markers.

Both preserve TypeScript as the database writer, but they disagree on context authority, mutation timing, fallback observability, and ledger ownership. The current implementation contains elements of both. The full data-ownership evidence is in `review-adversarial-divergence-2026-08-19.md`.

## Required Spine Update Order

1. Remove the AD-14 contradictions and update the runtime mode set/precedence.
2. Choose one context authority and one TypeScript commit seam for the first production slice.
3. Tighten AD-15 ordering and reply-commit semantics around persisted action rows and outbound delivery.
4. Resolve AD-7 as either real durable workflow state or explicitly stateless request execution.
5. Bind cross-service contract evolution/deploy order; label or lock Python versions.

After those changes, rerun the same lint + rubric + configured reviewer lenses. No change to the current spine was made by this validation.
