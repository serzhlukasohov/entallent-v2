# Reviewer Gate Resolution

Verdict after fixes: pass with non-blocking open questions.

## Applied Fixes

- Added AD-13 for runtime router ownership, per-job selection, kill-switch precedence, and fail-closed behavior.
- Added AD-14 for a single canonical runtime schema source before any HTTP boundary implementation.
- Added AD-15 for persisted runtime-attempt and action ledgers as the observable side-effect barrier.
- Added AD-16 for scoped internal service auth and endpoint allowlisting.
- Added AD-17 for shared retry budgets across BullMQ, HTTP, Python workflow, model calls, tool calls, and action execution.
- Added AD-18 for TypeScript-owned canonical shadow diagnostics.
- Added AD-19 for `agent-service` deployable-unit requirements before non-local shadow mode.
- Tightened AD-7 so durable session/checkpoint storage is required before non-local or production shadow execution.
- Tightened AD-3 so shared runtime contracts must come from the AD-14 canonical schema source.
- Updated stack rows to reflect local Dockerfiles and `pnpm-lock.yaml` resolved versions.
- Recorded FastAPI PyPI Beta classifier, MAF core stability, MAF hosting prerelease status, and Python 3.13 rationale.

## Remaining Open Questions

- First canary dimension: internal users, a single workspace, or percentage rollout.
- Durable backend for MAF session/checkpoint state before non-local shadow mode.
- Canonical runtime schema source: TypeScript Zod, Python Pydantic, or neutral OpenAPI.

These are not blockers for creating epics and stories. They are blocking decisions before the specific implementation stories that touch canary, non-local shadow execution, or runtime HTTP boundary code.
