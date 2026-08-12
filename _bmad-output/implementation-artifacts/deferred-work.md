## Deferred from: code review of sec-1-p0-dev-surface-hardening (2026-08-05)

- Dashboard dev actions need an operator-auth story before intentionally enabling them in any shared non-production environment. The current P0 story makes production fail-closed, but shared staging/dev environments still need caller authorization if `DASHBOARD_DEV_CONTROLS_ENABLED=true` is ever used outside a private local setup.

## Deferred from: code review of 2-6-define-runtime-retry-budget-and-error-mapping (2026-08-05)

- `ProcessMessageRequest` still keeps `requestId`, `eventId`, and `runtimeAttempt` optional for compatibility with the current shim boundary. A future tightening story should introduce or require a strict runtime-boundary request type once all existing TypeScript runtime callers have been migrated.

## Deferred from: production MAF regression workflow setup (2026-08-11)

- Enable the new production regression workflow after GitHub repo configuration is ready. Required GitHub secrets: `RAILWAY_TOKEN`, `RAILWAY_PROJECT_ID`, `SLACK_REGRESSION_USER_TOKEN`, and `SLACK_REGRESSION_CHANNEL_ID`. Required GitHub variable: `MAF_PROD_REGRESSION_ENABLED=1`. Until then, `.github/workflows/maf-production-regression.yml` remains safe-by-default: it can be run manually with `workflow_dispatch`, but it will not run automatically on `main` pushes.

## Deferred from: architecture hygiene split (2026-08-12)

- source_spec: none
  summary: Add a production dashboard verifier that checks health and admin dashboard display-name invariants after deploy.
  evidence: Split from the architecture improvement bundle because it is independently shippable from shared queue constants and can be reviewed as an operational smoke-test script.
- source_spec: none
  summary: Move admin dashboard DTO schemas into a shared contracts package and make API/dashboard consume the same response types.
  evidence: Split from the architecture improvement bundle because admin DTO contracts are independently shippable and do not depend on queue topology cleanup.
- source_spec: none
  summary: Formalize profile hydration as the single owner of user identity/profile facts.
  evidence: Split from the architecture improvement bundle because profile ownership is a larger boundary refactor beyond queue-name drift.
- source_spec: none
  summary: Introduce an admin read model for manager dashboard summaries.
  evidence: Split from the architecture improvement bundle because the read model is a larger data-shape and lifecycle decision that can ship independently.
- source_spec: none
  summary: Add profile hydration status, retry visibility, and alerts for missing Slack display names.
  evidence: Split from the architecture improvement bundle because observability/state tracking is independently shippable from shared queue constants.
- source_spec: none
  summary: Harden Slack display-name backfill tooling with dry-run, explicit tenant selection, audit logging, and safer output modes.
  evidence: Split from the architecture improvement bundle because backfill tooling can be reviewed and shipped separately from runtime architecture changes.
- source_spec: `_bmad-output/implementation-artifacts/spec-admin-manager-team-contract.md`
  summary: Add DB or write-time validation for `survey_evidence.polarity`.
  evidence: Review surfaced that polarity is stored as unrestricted text; preserving wire behavior is correct for this split, but producer-side validation should be handled as a separate data integrity story.
