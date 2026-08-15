---
id: SPEC-maf-first-feature-regression-framework
companions:
  - feature-regression-matrix.md
  - regression-gates.md
sources:
  - ../../../docs/testing/feature-regression-matrix.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only.

# MAF-First Feature Regression Framework

## Why

enTalent needs a product regression layer before adding more features so every user-facing capability is proven through the MAF primary runtime path, not only through legacy TypeScript orchestration or isolated unit tests.

## Capabilities

- **CAP-1**
  - **intent:** Each product feature can declare the MAF-primary scenarios, deterministic checks, simulation or judge checks, and gate required for implementation readiness.
  - **success:** An implementation story can point to one feature row in `feature-regression-matrix.md` and identify the exact MAF path, checks, and command gate it must satisfy.

- **CAP-2**
  - **intent:** Product-level regressions exercise the full primary runtime path from inbound event through side effects and evidence.
  - **success:** Covered scenarios traverse `Slack/API event -> queue -> worker -> MAF runtime -> TypeScript validation/persistence -> outbound/send/audit/runtime_attempts`.

- **CAP-3**
  - **intent:** Regression coverage uses the existing project test layers instead of creating a new framework.
  - **success:** Contract tests, adapter tests, integration tests, `conversation-sim`, live smoke scripts, and evals cover feature regressions without new harness infrastructure until repeated setup appears in at least two features.

- **CAP-4**
  - **intent:** Feature gates distinguish always-on PR checks, feature-specific checks, production-sensitive checks, and release checks.
  - **success:** A PR touching Slack, runtime, safety, survey, proactive behavior, privacy, dashboard data, or rollout can select the smallest matching gate from `regression-gates.md`.

- **CAP-5**
  - **intent:** Legacy runtime tests remain available only to prove fallback and rollback behavior.
  - **success:** New feature confidence comes from MAF primary tests, simulations, and judged conversations; `ConversationOrchestrator` coverage is not used as the primary proof for new product behavior.

## Constraints

- All product-level regression scenarios must go through MAF primary runtime.
- Do not create a new test framework while Vitest, pytest, `conversation-sim`, live smoke scripts, and evals are sufficient.
- Deterministic coverage for a feature must exist before adding judged live evals for that same feature.
- Sensitive scenarios require deterministic policy checks and manual review sampling; LLM-as-judge alone is insufficient.
- TypeScript remains the owner of validation, persistence, outbound side effects, audit records, and `runtime_attempts` evidence.
- Regression coverage must preserve tenant scoping, privacy boundaries, cohort safety, and rollback evidence for production-critical flows.

## Non-goals

- Do not replace Vitest, pytest, `conversation-sim`, live smoke scripts, or evals.
- Do not expand legacy `ConversationOrchestrator` tests for new feature confidence except where fallback or rollback is the feature under test.
- Do not require every feature to run every release command on every PR.
- Do not introduce broad reusable helpers before a second feature needs the same setup.

## Success Signal

Before a new product feature is implemented, its story can name the matching feature row, MAF-primary path, deterministic assertions, simulation or judge expectations, and command gate. Slack AI mentor is the first vertical regression because other product features depend on the inbound-to-MAF-to-outbound path.

## Assumptions

- Implementation stories will consume this SPEC plus both companions.
- Existing test homes can host the first coverage slice without new framework code.

## Open Questions

- What exact coverage naming or tag convention should be used across Vitest, pytest, `conversation-sim`, and evals?
