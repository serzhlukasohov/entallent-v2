---
id: SPEC-pr5-persisted-reporting-cohort-lifecycle
companions:
  - brownfield.md
sources:
  - ../../../docs/collected-product-requirements.md
  - ../../implementation-artifacts/spec-pr5-tenant-team-cycle-cohort-reporting-boundary.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate.

# PR5 Persisted Reporting Cohort Lifecycle

## Why

REQ-024 requires the reporting denominator to be frozen when a cycle opens, but the current source of truth is an employee-owned window created lazily from mutable membership and consent state. A persisted, shared cycle cohort is required so later opt-out, deletion, transfer, or legacy windows cannot rewrite reporting eligibility.

## Capabilities

- **CAP-1**
  - **intent:** The system can open a reporting cycle and freeze one eligible roster for each direct team.
  - **success:** Repeated opening of the same tenant, survey definition, and period returns the same cohorts with unchanged sorted rosters.
- **CAP-2**
  - **intent:** An eligible employee's current survey window can reference the canonical team cohort for that cycle.
  - **success:** A stale active legacy window does not block creation of a current cohort-bound window, and no historical roster is reconstructed from mutable state.
- **CAP-3**
  - **intent:** Reporting can preserve the frozen denominator while excluding contributions from employees who later become ineligible.
  - **success:** Later opt-out, deletion, or transfer does not shrink the roster; fewer than five remaining eligible contributors fails closed before AI or manager delivery.

## Constraints

- TypeScript owns cycle opening, roster eligibility, persisted scope, anonymity thresholds, distinct-employee counting, and scope rejection; AI has no decision role.
- A roster member must be active, not deleted, survey-opted-in, and assigned as a member to exactly one active tenant team at opening.
- The canonical cohort key is tenant, team, survey definition, `periodStart`, and immutable `periodEnd`; its roster is sorted and immutable.
- Employee windows reference the cohort. An employee-owned window is not the cohort authority.
- Existing unscoped historical windows remain report-ineligible and must not be backfilled from current membership or consent.
- Migration history through `0014` is immutable; persistence changes use a new forward migration.
- The existing report job, repository ports, and aggregate manager payload remain the delivery spine.
- Cycle opening is invoked only by a guarded operational command with explicit UUID scope, offset-qualified instants, and a tenant-matching confirmation token.

## Non-goals

- No automatic scheduler or operational API for cycle opening.
- No final-report generation, report snapshot versioning, transfer cleanup, retention, dashboard isolation, numeric engagement, customer manager authorization, MAF, or `agent-service` changes.
- No historical cohort reconstruction or reduction of the frozen denominator after cycle opening.

## Success signal

A database-backed test opens a five-person cohort, changes one member's consent, and proves the roster still contains five while that member's contribution is excluded and the report remains fail-closed with only four eligible contributors. A stale legacy active window also cannot prevent a new cohort-bound current-cycle window, and the guarded command can invoke the same TypeScript use case without exposing roster identities.
