---
id: SPEC-pr5-first-immutable-report-snapshot-delivery
companions:
  - brownfield.md
sources:
  - ../../../docs/collected-product-requirements.md
  - ../../../docs/grill-session-handoff.md
  - ../../../docs/current-project-grill.md
  - ../../planning-artifacts/2026-09-03-pr5-product-conformance-audit-and-plan.md
  - ../spec-pr5-persisted-reporting-cohort-lifecycle/SPEC.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# PR5 First Immutable Report Snapshot Delivery

## Why

REQ-028 requires each manager-visible intermediate report to be an immutable snapshot with durable delivery idempotency. The current group-report path can generate a manager payload and call Slack without a persisted delivery state, so concurrent or retried jobs can resend and cannot distinguish cancelled, delivered, or unknown delivery outcomes.

## Capabilities

- **CAP-1**
  - **intent:** The system can persist the first immutable manager-visible snapshot for one tenant, reporting cohort, and Pulse Index.
  - **success:** Exactly one non-cancelled version-1 snapshot can exist for `(tenantId, reportingCohortId, pulseIndex)`; a cancelled attempt releases the slot.
- **CAP-2**
  - **intent:** The system can prove that a snapshot payload was generated only from eligible contributors and a valid frozen manager target.
  - **success:** Snapshot provenance records contributor user IDs, source group-state IDs, policy version, frozen workspace connection ID, and frozen manager Slack user ID after TypeScript revalidates scope and target.
- **CAP-3**
  - **intent:** The worker sends Slack only for the job that created the unique immutable snapshot.
  - **success:** A concurrent loser or later retry observes the existing non-cancelled snapshot and stops before calling Slack.
- **CAP-4**
  - **intent:** The system can record the final delivery outcome without guessing whether Slack received the message.
  - **success:** Pre-send TypeScript scope or target failure marks `cancelled`, a valid Slack external message ID marks `delivered`, and any exception after Slack send begins marks `delivery_unknown`.
- **CAP-5**
  - **intent:** Unknown delivery outcomes block unsafe automatic resends.
  - **success:** `delivery_unknown` is not retried automatically and blocks later snapshots for the same tenant, reporting cohort, and Pulse Index until explicit reconciliation.

## Constraints

- TypeScript owns contributor eligibility, anonymity floor, target validation, delivery state, idempotency, scope rejection, and provenance; AI only returns a complete manager payload candidate.
- The uniqueness rule for the first snapshot is `(tenantId, reportingCohortId, pulseIndex, snapshotVersion = 1)` for non-cancelled states. `cancelled` releases the slot; `delivered` and `delivery_unknown` occupy it.
- A snapshot freezes exact `workspaceConnectionId` and `managerSlackUserId`, revalidates that binding immediately before delivery, cancels on changed binding, and is never retargeted.
- The immutable payload and closed provenance are inserted only after AI returns and after TypeScript revalidates contributors and target.
- Only the database insertion winner may call Slack.
- Do not add a pre-AI `generating` state in this slice.
- Do not add Slack provider-specific error taxonomy in this slice.
- Keep the existing group-report job, `GroupReportUseCase`, repository ports, and Slack adapter as the delivery spine where possible.

## Non-goals

- No later intermediate report versions or five-distinct-changed-input rule.
- No final report generation, transfer lifecycle cleanup, dashboard isolation, retention enforcement, numeric engagement, customer manager authorization, MAF, or `agent-service` changes.
- No automatic reconciliation UI or workflow for `delivery_unknown`.

## Success signal

A focused worker test proves a duplicate/retried group-report job cannot send Slack twice and that persisted state distinguishes `cancelled`, `delivered`, and `delivery_unknown`. Focused application/worker checks, database integration for the uniqueness rule when schema changes, and `pnpm prepush` pass.
