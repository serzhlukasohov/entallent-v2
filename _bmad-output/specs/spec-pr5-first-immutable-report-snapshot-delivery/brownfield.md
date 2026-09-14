# Brownfield Contract

## Current flow

1. A group-report job carries `reportingCohortId`, `tenantId`, `teamId`, and `questionGroup`.
2. `GroupReportProcessor` calls `GroupReportUseCase`.
3. `GroupReportUseCase` revalidates cohort scope, distinct contributors, reportability proof, and the anonymity floor before asking AI for the manager payload.
4. `GroupReportProcessor` resolves the Slack workspace connection and calls `SlackAdapter.sendMessage` directly.

## Minimal persistence boundary

- Add one snapshot table for immutable manager report delivery state.
- Store tenant ID, reporting cohort ID, team ID, Pulse Index, snapshot version, status, manager payload, contributor provenance, frozen workspace connection ID, frozen manager Slack user ID, Slack external message ID, timestamps, and failure reason.
- Enforce one non-cancelled version-1 snapshot per tenant, reporting cohort, and Pulse Index.

## State flow

1. Use the existing report use case to generate a complete manager payload candidate.
2. Revalidate contributors and the frozen manager target after AI returns.
3. Atomically insert the completed immutable snapshot with status `pending_delivery`.
4. If insertion loses to an existing non-cancelled snapshot, stop before Slack.
5. Revalidate the frozen workspace and manager binding immediately before delivery.
6. Mark `cancelled` before Slack if TypeScript scope or target validation fails.
7. After Slack send begins, mark `delivered` only with a valid external message ID; otherwise mark `delivery_unknown`.

## Verification focus

- RED worker test: current retry/concurrency path can call Slack more than once and has no durable snapshot state.
- Repository/database test if schema changes: `cancelled` releases the slot while `delivered` and `delivery_unknown` occupy it.
- Focused application/worker tests, affected typecheck/lint/build, database integration, `pnpm prepush`, and `git diff --check`.
