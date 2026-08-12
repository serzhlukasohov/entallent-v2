# Good-Spine Rubric Review

## Verdict

**Conditional pass with high-risk fixes required before handoff.** The spine has the right paradigm and several strong divergence-preventing ADs around runtime isolation, TypeScript side-effect ownership, shadow mode, and deterministic policy checks. It does not yet fully converge CAP-1 rollout/rollback behavior, it leaves a production-shadow state decision unsafe, and its stack verification contradicts both the brownfield lockfile and package indexes.

Mechanical lint: `python3 .agents/skills/bmad-architecture/scripts/lint_spine.py --workspace ...` returned `ok: true` with zero findings. The configured `uv run ...` form could not run because `uv` is unavailable in this environment.

## Scope Checked

- Target spine: `/Users/serzh/Documents/enTalentNew/_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md`
- Driving SPEC: `/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-runtime-migration/SPEC.md`
- SPEC companions checked: `runtime-contract.md`, `migration-plan.md`, `validation-baseline.md`, `architecture-spine-seed.md`
- Brownfield files sampled: `ARCHITECTURE.md`, `packages/application/src/ports/agent-runtime.port.ts`, `packages/application/src/use-cases/typescript-agent-runtime.ts`, `apps/worker/src/conversation/conversation.module.ts`, `apps/worker/src/conversation/conversation.processor.ts`, `packages/application/src/ports/feature-flag.port.ts`, `package.json`, `pnpm-lock.yaml`

## Findings

### HIGH - CAP-1 runtime selection and kill-switch semantics are not actually bound

The SPEC requires a feature flag or kill switch to switch a workspace/user between runtimes, and a disabled MAF path must fall back to TypeScript before side effects occur (`SPEC.md` lines 27-30, 60-62). The migration plan also requires runtime selection through feature flags plus a global MAF kill switch (`migration-plan.md` lines 26-29, 71). The spine maps CAP-1 to AD-1, AD-4, and AD-5 (`ARCHITECTURE-SPINE.md` lines 51-79, 208), but none of those ADs binds:

- the flag names or owner;
- precedence between global kill switch, workspace/user enablement, shadow mode, and canary mode;
- fail-closed behavior when flag evaluation fails;
- where runtime selection happens in the current Nest provider wiring.

Brownfield reality makes this a real divergence point: the current worker provider is hardwired to `new TypeScriptAgentRuntime(orchestrator)` (`apps/worker/src/conversation/conversation.module.ts` lines 80-83), and the existing feature flag list has no MAF runtime flag (`packages/application/src/ports/feature-flag.port.ts` lines 1-9). Two implementers could independently add incompatible flag keys, rollout dimensions, or fallback precedence while still claiming compliance with AD-1 and AD-5.

**Required fix:** add an AD that binds runtime-selection ownership and precedence. It should name the global kill switch, the workspace/user enablement flag or rollout selector, shadow/canary behavior, fail-closed defaults, and the rule that the selector must choose before invoking any runtime or executing proposals.

### HIGH - The MAF session-store deferral is unsafe for production shadow mode

AD-7 correctly says production session state, workflow checkpoints, and conversation history are separate storage concerns, and process-local storage is local-development only (`ARCHITECTURE-SPINE.md` lines 87-91). But Deferred postpones the MAF session store backend until "before user-facing canary" (`ARCHITECTURE-SPINE.md` line 219). That is too late if CAP-3 shadow mode runs against real inbound messages in a production environment: the SPEC says production MAF hosting must not rely on process-local sessions or in-memory conversation history (`SPEC.md` line 49), and shadow mode is explicitly before user-facing rollout (`SPEC.md` lines 35-37).

This lets two units diverge: one can implement production shadow against process-local state because canary has not started, while another assumes AD-7 already blocks that. The AD and Deferred table contradict each other at the point that matters.

**Required fix:** change the revisit condition to "before any non-local or production shadow execution" or split it into two decisions: minimum durable shadow storage now, final checkpoint/backend optimization before canary.

### HIGH - Stack verification is stale or false, so the spine does not ratify brownfield or current named tech

The Stack table pins TypeScript 5.6.3, BullMQ 5.12.12, Drizzle ORM 0.35.0, FastAPI 0.141.1, and Microsoft Agent Framework for Python 1.13.0 (`ARCHITECTURE-SPINE.md` lines 138-152), with verification notes claiming FastAPI 0.141.1 and MAF 1.13.0 were verified on PyPI (`ARCHITECTURE-SPINE.md` lines 230-234). That conflicts with both local and external reality:

- the root package allows `typescript: ^5.6.3`, but the lockfile resolves TypeScript 5.9.3 (`package.json` line 37; `pnpm-lock.yaml` lines 5481-5484);
- the lockfile resolves BullMQ 5.80.5 and Drizzle ORM 0.35.3, not the spine's 5.12.12 / 0.35.0 (`pnpm-lock.yaml` lines 3202-3204, 3514-3515, 8188-8192);
- PyPI search results on 2026-08-05 show FastAPI latest as 0.139.2, not 0.141.1: https://pypi.org/project/fastapi/;
- PyPI search results on 2026-08-05 show `agent-framework` latest as 1.12.0, not 1.13.0: https://pypi.org/project/agent-framework/.

This is not just polish. The good-spine rubric requires named technology to be verified-current and brownfield reality to be ratified. A builder following the spine could pin unavailable Python packages or downgrade/contradict the existing TypeScript dependency graph.

**Required fix:** update the stack from the lockfile for existing brownfield packages, and re-verify Python/FastAPI/MAF package versions before binding them. If the intent is "minimum acceptable" rather than "current lockfile", label that explicitly.

### MEDIUM - The runtime contract source of truth is deferred too late and too loosely

AD-3 requires JSON-compatible schemas and "generated or hand-maintained validators" (`ARCHITECTURE-SPINE.md` lines 63-67). Deferred postpones the OpenAPI/source-of-truth decision until before implementing `MafAgentRuntimeClient` (`ARCHITECTURE-SPINE.md` line 220). The SPEC contract, however, depends on a validated `ProcessMessageRequest` / `ProcessMessageResult` with reply text, risk assessment, memory candidates, proposed actions, trace ID, and runtime version (`SPEC.md` lines 31-33), and the runtime contract companion already declares the richer HTTP contract as the target service/client boundary.

"Generated or hand-maintained validators" is not enforceable enough to prevent TypeScript and Python schema drift. It also allows the Python service skeleton to implement Pydantic schemas before the client exists, then forces TypeScript to conform later.

**Recommended fix:** bind one canonical schema owner before either side of the HTTP boundary is implemented, or at least make the deferred condition "before implementing any runtime HTTP boundary code in TypeScript or Python." If hand-maintained validators remain allowed, require contract tests that round-trip canonical fixtures across both validators.

### MEDIUM - Operational envelope for the new `agent-service` is incomplete

The spine covers durable state, trace propagation, and error categories, but it does not bind the operational/environmental envelope for a new production service: service-to-service authentication, timeout/retry/circuit-breaker defaults, health/readiness endpoints, deployment environment names, secrets/config ownership, and whether the Python service is independently deployable or coupled to the worker deployment. This matters because CAP-1 fallback and CAP-3 shadow mode depend on failure classification and rollback behaving consistently under production load.

The omission is at the architecture spine altitude, not implementation detail: two implementers could pick incompatible timeout budgets, retry policies, or auth mechanisms while still satisfying the current AD text. That can produce duplicate work, unsafe partial results, or a MAF path that cannot be killed reliably.

**Recommended fix:** add a small operational AD or conventions table entry binding the production call envelope: mTLS/shared service token or internal network policy, timeout budget, retry count, circuit-breaker behavior, health endpoint, readiness dependency checks, and config source.

## Coverage Notes

- CAP-2 is mostly covered by AD-2, AD-3, AD-7, AD-8, AD-10, AD-11, and AD-12, with the caveat that the schema source-of-truth needs tightening before implementation.
- CAP-3 is covered in principle by AD-5, AD-6, and AD-7, but the session-store deferral makes production shadow unsafe.
- CAP-4 is covered by AD-6, AD-9, and AD-10; the validation baseline's manual-review rule is reflected by deterministic-policy emphasis, but manual-review sampling is not explicitly named in the AD rule.
- Brownfield reality is partially ratified: the current `AgentRuntimePort`, `AGENT_RUNTIME_PORT`, and `TypeScriptAgentRuntime` are real and correctly referenced. The stack table and missing MAF feature-flag/kill-switch wiring are the main brownfield failures.

