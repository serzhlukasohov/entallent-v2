## Deferred from: code review of sec-1-p0-dev-surface-hardening (2026-08-05)

- Dashboard dev actions need an operator-auth story before intentionally enabling them in any shared non-production environment. The current P0 story makes production fail-closed, but shared staging/dev environments still need caller authorization if `DASHBOARD_DEV_CONTROLS_ENABLED=true` is ever used outside a private local setup.

## Deferred from: code review of 2-6-define-runtime-retry-budget-and-error-mapping (2026-08-05)

- `ProcessMessageRequest` still keeps `requestId`, `eventId`, and `runtimeAttempt` optional for compatibility with the current shim boundary. A future tightening story should introduce or require a strict runtime-boundary request type once all existing TypeScript runtime callers have been migrated.
  status: done
  completed_by: `_bmad-output/implementation-artifacts/spec-strict-runtime-boundary-request.md`

## Deferred from: production MAF regression workflow setup (2026-08-11)

- Enable the new production regression workflow after GitHub repo configuration is ready. Required GitHub secrets: `RAILWAY_TOKEN`, `RAILWAY_PROJECT_ID`, `SLACK_REGRESSION_USER_TOKEN`, and `SLACK_REGRESSION_CHANNEL_ID`. Required GitHub variable: `MAF_PROD_REGRESSION_ENABLED=1`. Until then, `.github/workflows/maf-production-regression.yml` remains safe-by-default: it can be run manually with `workflow_dispatch`, but it will not run automatically on `main` pushes.

## Deferred from: architecture hygiene split (2026-08-12)

- source_spec: none
  summary: Add a production dashboard verifier that checks health and admin dashboard display-name invariants after deploy.
  status: done
  completed_by: `_bmad-output/implementation-artifacts/spec-production-dashboard-verifier.md`
  evidence: Split from the architecture improvement bundle because it is independently shippable from shared queue constants and can be reviewed as an operational smoke-test script.
- source_spec: none
  summary: Move admin dashboard DTO schemas into a shared contracts package and make API/dashboard consume the same response types.
  status: done
  completed_by: `_bmad-output/implementation-artifacts/spec-admin-manager-team-contract.md`
  evidence: Split from the architecture improvement bundle because admin DTO contracts are independently shippable and do not depend on queue topology cleanup.
- source_spec: none
  summary: Formalize profile hydration as the single owner of user identity/profile facts.
  status: done
  completed_by: `_bmad-output/implementation-artifacts/spec-profile-facts-owner.md`
  evidence: Split from the architecture improvement bundle because profile ownership is a larger boundary refactor beyond queue-name drift.
- source_spec: none
  summary: Introduce an admin read model for manager dashboard summaries.
  status: done
  completed_by: `_bmad-output/implementation-artifacts/spec-admin-manager-dashboard-read-model.md`
  evidence: Split from the architecture improvement bundle because the read model is a larger data-shape and lifecycle decision that can ship independently.
- source_spec: none
  summary: Add profile hydration status, retry visibility, and alerts for missing Slack display names.
  status: done
  completed_by: `_bmad-output/implementation-artifacts/spec-profile-hydration-observability.md`
  evidence: Split from the architecture improvement bundle because observability/state tracking is independently shippable from shared queue constants.
- source_spec: none
  summary: Harden Slack display-name backfill tooling with dry-run, explicit tenant selection, audit logging, and safer output modes.
  status: done
  completed_by: `_bmad-output/implementation-artifacts/spec-slack-display-name-backfill-safety.md`
  evidence: Split from the architecture improvement bundle because backfill tooling can be reviewed and shipped separately from runtime architecture changes.
- source_spec: `_bmad-output/implementation-artifacts/spec-admin-manager-team-contract.md`
  summary: Add DB or write-time validation for `survey_evidence.polarity`.
  status: done
  completed_by: `_bmad-output/implementation-artifacts/spec-survey-evidence-polarity-validation.md`
  evidence: Review surfaced that polarity is stored as unrestricted text; preserving wire behavior is correct for this split, but producer-side validation should be handled as a separate data integrity story.
- source_spec: `_bmad-output/implementation-artifacts/spec-profile-hydration-observability.md`
  summary: Scope profile hydration jobs and repository writes to a specific channel account rather than only `userId + tenantId + channelType`.
  status: done
  completed_by: `_bmad-output/implementation-artifacts/spec-account-scoped-profile-hydration.md`
  evidence: Review surfaced that users with multiple Slack workspace accounts could have unrelated channel accounts marked with the same hydration outcome; completed by carrying external workspace scope through hydration payloads, Slack account lookup, profile writes, and outcome writes.
- source_spec: `_bmad-output/implementation-artifacts/spec-profile-hydration-observability.md`
  summary: Make profile hydration attempt-count increments atomic if the status remains JSONB-backed.
  status: done
  completed_by: `_bmad-output/implementation-artifacts/spec-profile-hydration-atomic-attempt-count.md`
  evidence: Review surfaced that concurrent hydration attempts can lose JSONB read-modify-write increments; this is acceptable for first-slice observability but should be addressed with the profile ownership refactor.

## Deferred from: dashboard production verification workflow (2026-08-12)

- source_spec: `_bmad-output/implementation-artifacts/spec-dashboard-production-verification-workflow.md`
  summary: Enable automatic dashboard production verification after GitHub repo secrets and variables are configured.
  status: todo
  evidence: The workflow is safe-by-default and can run manually now, but automatic push execution requires `DASHBOARD_PROD_VERIFY_ENABLED=1`, `DASHBOARD_ADMIN_API_KEY`, `DASHBOARD_PROD_TENANT_ID`, `RAILWAY_TOKEN`, and `RAILWAY_PROJECT_ID` to be configured in GitHub.

## Deferred from: LLM Safety Gateway implementation (2026-08-13)

- source_spec: `_bmad-output/implementation-artifacts/spec-llm-safety-gateway.md`
  summary: Complete live/staging validation for the LLM Safety Gateway after Azure credentials are available.
  status: todo
  evidence: Code, unit tests, and local contract behavior are complete, but real Azure OpenAI plus Azure AI Content Safety Prompt Shields smoke testing requires `AGENT_SERVICE_MODEL_PROVIDER`, `AGENT_SERVICE_MODEL_NAME`, `AGENT_SERVICE_AZURE_OPENAI_ENDPOINT`, `AGENT_SERVICE_AZURE_OPENAI_API_KEY`, `AGENT_SERVICE_AZURE_OPENAI_API_VERSION`, `AGENT_SERVICE_LLM_SAFETY_MODE`, `AGENT_SERVICE_LLM_SAFETY_PROVIDER`, `AGENT_SERVICE_AZURE_CONTENT_SAFETY_ENDPOINT`, and `AGENT_SERVICE_AZURE_CONTENT_SAFETY_KEY`.

- source_spec: `_bmad-output/implementation-artifacts/spec-direct-address-and-current-intent-fidelity.md`
  summary: Preserve the authoritative tail of employee messages that exceed the 2,000-character prompt bound.
  evidence: Review found that `sanitizeTurnContent` keeps only the first 2,000 characters, so a late consultation question or correction can be absent from both classification and rendering; this predates the current prompt-contract fix and needs a separate trust-boundary design.

- source_spec: `_bmad-output/implementation-artifacts/spec-engagement-window-numeric-index-focus.md`
  summary: Make survey assessment upsert atomic under concurrent evidence jobs.
  evidence: `survey_assessments` has no unique `(survey_window_id, survey_question_id)` constraint, so the current read-then-insert repository flow can create duplicate assessments; fixing it requires an explicitly approved migration.

- source_spec: `_bmad-output/implementation-artifacts/spec-engagement-window-numeric-index-focus.md`
  summary: Prevent an older numeric evidence job from overwriting a newer engagement correction.
  evidence: Assessment rows do not retain authoritative score-source time, so out-of-order workers cannot compare rating chronology without a persistence/workflow change.

- source_spec: `_bmad-output/implementation-artifacts/spec-engagement-window-numeric-index-focus.md`
  summary: Define how a numeric correction reopens or recomputes an already confirmed engagement report.
  evidence: The current confirmation state machine treats confirmed groups as terminal; changing score/report behavior after confirmation needs a separate product decision.

- source_spec: `_bmad-output/implementation-artifacts/spec-reconcile-pulse-backlog-assessment-coverage.md`
  summary: Reconcile the opposite drift where a pending qualitative backlog row already has a completed assessment.
  evidence: Review confirmed assessment persistence and backlog closure are separate awaits, so a pre-existing or interrupted write can leave `pending + covered`; this story repairs the observed `done + insufficient_evidence` state, while symmetric healing needs separate attribution and active-probe policy decisions.
