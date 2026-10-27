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

## Deferred from: PR 5 REQ-015 reporting disclosure (2026-09-03)

- source_spec: `_bmad-output/implementation-artifacts/spec-pr5-req-015-reporting-disclosure.md`
  summary: Bind `awaiting_confirmation` to the exact outbound summary and create it only after that message is delivered.
  status: done
  completed_by: `_bmad-output/implementation-artifacts/spec-pr5-req-012-exact-displayed-summary.md`
  evidence: Review found Phase A writes awaiting state before enqueue/channel delivery; this is the next Phase 2 gap because it needs a versioned displayed-summary receipt rather than another disclosure guard.
- source_spec: `_bmad-output/implementation-artifacts/spec-pr5-req-015-reporting-disclosure.md`
  summary: Persist group-report dispatch intent atomically with confirmation through a PostgreSQL transactional outbox.
  status: todo
  evidence: Confirmation currently commits before BullMQ enqueue; a Redis failure can leave a confirmed row without a report job.
- source_spec: `_bmad-output/implementation-artifacts/spec-pr5-req-015-reporting-disclosure.md`
  summary: Scope report inputs by tenant, team, cycle, and distinct employee before applying the anonymity threshold.
  status: done
  completed_by: `_bmad-output/implementation-artifacts/spec-pr5-tenant-team-cycle-cohort-reporting-boundary.md`
  evidence: The TypeScript report boundary now carries tenant/team/anchor scope, projects typed definition/period/roster scope, counts distinct employees once, and fails closed before AI.
- source_spec: `_bmad-output/implementation-artifacts/spec-pr5-req-015-reporting-disclosure.md`
  summary: Couple probe backlog state and external-message idempotency to confirmed channel delivery.
  status: todo
  evidence: Queue success is not channel delivery, and a provider success followed by local receipt-write failure can retry the external send.

## Deferred from: PR 5 REQ-012 exact displayed summary (2026-09-03)

- source_spec: `_bmad-output/implementation-artifacts/spec-pr5-req-012-exact-displayed-summary.md`
  summary: Persist confirmation-prompt dispatch atomically with candidate staging and recover staged or invalid receipts after terminal delivery failure or retention deletion.
  status: todo
  evidence: A crash between PostgreSQL staging and BullMQ enqueue can leave a pending pointer without a queued send; a later deleted or corrupted receipt can block future confirmations. This requires the transactional outbound lifecycle excluded from the exact-binding slice.
- source_spec: `_bmad-output/implementation-artifacts/spec-pr5-req-012-exact-displayed-summary.md`
  summary: Serialize competing confirmation responses by event time across concurrent workers.
  status: todo
  evidence: Message-bound CAS prevents stale candidate replacement, but simultaneous agree and correct replies are still resolved by worker completion order rather than inbound `occurredAt`.
- source_spec: `_bmad-output/implementation-artifacts/spec-pr5-req-012-exact-displayed-summary.md`
  summary: Add the typed de-identification acceptance gate and place confirmation evidence in an explicitly untrusted prompt block.
  status: todo
  evidence: Exact display binding is complete, but REQ-013 and REQ-016 still require TypeScript policy acceptance and prompt-injection-safe evidence handling before the candidate becomes reportable.
- source_spec: `_bmad-output/implementation-artifacts/spec-pr5-req-012-exact-displayed-summary.md`
  summary: Persist the external workspace binding on conversations or outbound delivery intents.
  status: todo
  evidence: Delivery now validates tenant, channel type, and external conversation ID, but the current conversation schema cannot prove which same-tenant external workspace the job must use.
- source_spec: `_bmad-output/implementation-artifacts/spec-admin-user-reset-button.md`
  summary: Add a user-reset generation fence or BullMQ cancellation for jobs queued before an admin reset.
  status: todo
  evidence: Review found that conversation/message-send jobs can hold stale messageId/conversationId outside Postgres; current DB reset prevents deleted outbound delivery but does not proactively remove queued jobs.
- source_spec: `_bmad-output/implementation-artifacts/spec-confirmation-language-and-acknowledgement.md`
  summary: Revalidate the reply-length ceiling after corrective non-confirmation generation.
  status: todo
  evidence: The existing single corrective generation rechecks confirmation and question-count contracts but can still return an overlong corrected draft.
- source_spec: `_bmad-output/implementation-artifacts/spec-confirmation-language-and-acknowledgement.md`
  summary: Make successful confirmation state and its acknowledgement delivery recover atomically.
  status: todo
  evidence: Confirmation and report enqueue occur before response generation, so any provider failure can close the topic without delivering the acknowledgement.

## Deferred from: code review of spec-pr5-tenant-team-cycle-cohort-reporting-boundary (2026-09-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-pr5-tenant-team-cycle-cohort-reporting-boundary.md`
  summary: Materialize one immutable tenant/team/cycle roster at actual cycle open and roll over legacy active windows that have no persisted reporting scope.
  status: done
  completed_by: `_bmad-output/specs/spec-pr5-persisted-reporting-cohort-lifecycle/SPEC.md`
  evidence: A guarded TypeScript cycle-opening operation now persists immutable tenant/team/definition/period cohorts, employee windows reference the canonical cohort, and stale legacy windows roll over without historical roster reconstruction.
- source_spec: `_bmad-output/implementation-artifacts/spec-pr5-tenant-team-cycle-cohort-reporting-boundary.md`
  summary: Revalidate the exact contributor cohort immediately before manager Slack delivery.
  status: todo
  evidence: Eligibility is checked before AI generation; withdrawal, deletion, opt-out, or scope changes racing the model call need snapshot/delivery lifecycle handling.
- source_spec: `_bmad-output/implementation-artifacts/spec-pr5-tenant-team-cycle-cohort-reporting-boundary.md`
  summary: Make manager Slack report delivery idempotent with an immutable report snapshot and durable delivery key.
  status: todo
  evidence: A BullMQ retry after Slack acceptance can currently send the same logical report twice.
- source_spec: `_bmad-output/implementation-artifacts/spec-pr5-tenant-team-cycle-cohort-reporting-boundary.md`
  summary: Bind manager identity and Slack workspace as one tenant-scoped delivery target.
  status: todo
  evidence: Selecting the first tenant Slack workspace is insufficient once a tenant has multiple workspace connections.
- source_spec: `_bmad-output/implementation-artifacts/spec-pr5-tenant-team-cycle-cohort-reporting-boundary.md`
  summary: Define whether null employee scores can satisfy numeric Pulse Index report eligibility.
  status: todo
  evidence: Current report eligibility counts proof-backed summaries while score aggregation excludes null values; numeric engagement policy is a separate explicit slice.
- source_spec: `_bmad-output/implementation-artifacts/spec-pr5-tenant-team-cycle-cohort-reporting-boundary.md`
  summary: Add a PostgreSQL-backed repository acceptance test for five sibling windows plus duplicate, foreign-tenant, and divergent-roster rejection.
  status: todo
  evidence: Migration integration passes, while current repository verification compiles SQL predicates and the application test exercises adapter projections in memory.
- source_spec: `_bmad-output/specs/spec-pr5-persisted-reporting-cohort-lifecycle/SPEC.md`
  summary: Enforce one active survey window per tenant and employee under concurrent first-window creation.
  status: todo
  evidence: Cohort opening and legacy rollover are transactional, but the existing schema has no audited partial unique constraint for active employee windows; add it with duplicate-data remediation during active-window lifecycle cleanup.

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

- source_spec: `_bmad-output/implementation-artifacts/spec-cap-7-relevant-pulse-disclosure.md`
  summary: Make legacy awaiting-confirmation recovery durable across generation or outbound-delivery failures and pause turns.
  evidence: Recovery currently transitions awaiting groups to pending before a disclosure is successfully persisted and delivered; cadence previously masked some retries, but the state transition itself predates CAP-7 and needs a delivery-aware state-machine fix.
- source_spec: `_bmad-output/implementation-artifacts/spec-cap-7-relevant-pulse-disclosure.md`
  summary: Block Pulse state mutation when crisis or sensitive strategy conflicts with permissive survey classifier flags.
  evidence: Phase B can run before the final crisis/sensitive strategy gate when surveyAllowed and risk flags are inconsistent; this pre-existing safety-state boundary is separate from CAP-7 disclosure relevance.

## Deferred from: code review of spec-cap-2-session-concise-style (2026-09-17)

- source_spec: `_bmad-output/implementation-artifacts/spec-cap-2-session-concise-style.md`
  summary: Serialize overlapping same-conversation jobs so a later job cannot race a not-yet-persisted concise receipt.
  status: todo
  evidence: CAP-2 can carry a persisted receipt, but concurrent jobs that read before the first reply is saved require the separate CAP-9 turn-admission/coalescing boundary.

- source_spec: `_bmad-output/implementation-artifacts/spec-cap-9-rapid-message-coalescing.md`
  summary: Make Slack event idempotency, inbound persistence, and conversation-job admission atomic or durably recoverable.
  evidence: The pre-existing flow records the event before message persistence and BullMQ admission; a queue failure can orphan a durable inbound, and CAP-9 stale admission can then suppress an older queued turn behind that orphan.

## Deferred from: code review of spec-cap-11-dashboard-conversation-activity (2026-09-18)

- source_spec: `_bmad-output/implementation-artifacts/spec-cap-11-dashboard-conversation-activity.md`
  summary: Align manager-team activity semantics for synthetic `__init__` inbound rows.
  evidence: `lastActiveAt` currently includes every non-deleted inbound while the trends query excludes `text = '__init__'`; changing the read-model query is a pre-existing API semantic decision outside this UI-only story.

## Deferred from: code review of spec-cap-8-exact-pulse-capture-2 (2026-09-19)

- source_spec: `_bmad-output/implementation-artifacts/spec-cap-8-exact-pulse-capture-2.md`
  summary: Add PostgreSQL-backed repository acceptance coverage for exact CAP-8 source filtering and soft-deleted message exclusion.
  status: done
  evidence: `survey.repository.integration.test.ts` executes the production SQL builder and repository mapper on local PostgreSQL with typed UUIDs, JSONB confirmation metadata, equal timestamps, tenant/user/conversation ownership, and deleted sources. It uses temporary tables because the available PostgreSQL 14 install lacks the pgvector extension required by full migrations; migrated-schema coverage remains separate.

- source_spec: `_bmad-output/implementation-artifacts/spec-cap-8-exact-pulse-capture-2.md`
  summary: Make scheduled-action deduplication and follow-up queue admission atomic or durably recoverable.
  status: todo
  evidence: The shared reminder path still performs `existsByDeduplicationKey` before insert and queues execution afterward; concurrent requests or a crash between insert and queue admission can leave a unique-key retry or an unqueued pending action. CAP-8 now acknowledges sequential dedup hits without creating a duplicate, but the cross-runtime atomicity boundary needs a dedicated scheduler slice.

- source_spec: none
  summary: Show current-cycle working insights next to confirmed, de-identified Team Signals (no names, direction/severity/score, cohort threshold ignored in the QA view).
  evidence: Split from the 2026-10-14 dashboard cleanup intent as an independently shippable goal; it needs a new API projection and is planned as spec 2 of 3 in the same session.
- source_spec: none
  summary: Show the team hierarchy (unit manager -> teams with leads -> employees) from the new org model, falling back to legacy teams/team_memberships when the tenant has no active org units.
  evidence: Split from the 2026-10-14 dashboard cleanup intent as an independently shippable goal; it needs a new admin read endpoint and is planned as spec 3 of 3 in the same session.
- source_spec: `_bmad-output/implementation-artifacts/spec-dashboard-cleanup-cycles.md`
  summary: Replace the production dashboard verifier's legacy `/admin/manager/trends` data gate with a `/admin/v2-pilot` check now that no dashboard page reads trends.
  evidence: `scripts/verify-production-dashboard.ts` still fails verification when a tenant has empty trend series, for a feature the dashboard no longer shows; spec 1 kept it deliberately.
- source_spec: `_bmad-output/implementation-artifacts/spec-dashboard-cleanup-cycles.md`
  summary: Add render-level tests for dashboard pages (cycle detail 404 vs API-unavailable branching, nav tabs, cohort-scoped roster).
  evidence: The dashboard has no component/page test harness; only pure helpers in `v2-pilot-progress.ts` are covered, so page-branch regressions are caught only by manual checks.
- source_spec: `_bmad-output/implementation-artifacts/spec-dashboard-current-cycle-team-signals.md`
  summary: Enforce the QA private-view boundary in the API for `/admin/v2-pilot/people` and `/admin/v2-pilot/team-signals` (server-side flag or cohort-size floor), not only in the dashboard.
  evidence: Both endpoints are protected only by `ADMIN_API_KEY` + `INTERNAL_DASHBOARD_ENABLED`; any key holder can read un-thresholded per-cohort data even when the dashboard's `QA_PRIVATE_VIEW_ENABLED` is off.
- source_spec: `_bmad-output/implementation-artifacts/spec-dashboard-team-hierarchy.md`
  summary: Audit-log identifiable admin reads (`/admin/team-hierarchy`, `/admin/v2-pilot/people`) and restrict them server-side to approved tenants.
  evidence: AGENTS.md requires auditability for identifiable manager/admin surfaces; these endpoints return names for any tenant UUID to any `ADMIN_API_KEY` holder with no `audit_logs` row, and the pilot-tenant gate exists only in the dashboard.
- source_spec: `_bmad-output/implementation-artifacts/spec-gc-s3-answer-then-bundle.md`
  summary: `AiProviderWithFallback.withFallback` swallows the primary provider's typed failures (including `BundleReplyInvalidError` and confirmation fail-closed errors), so a fallback provider reruns the same contract and the orchestrator may see the fallback's unrelated error instead; the router is exported but not wired in apps today.
  evidence: Blind Hunter review of S3 (2026-10-15); `packages/ai-openai/src/ai-provider-router.ts` rethrows only the last error.
- source_spec: `_bmad-output/implementation-artifacts/spec-gc-s3-answer-then-bundle.md`
  summary: Add a live sim scenario for tester item T4 (substantive message with a question while a bundle is ready) so `pnpm sim:gate` exercises the answer-then-bundle prompt contract with the real model; the scripted fake now honours `trailingBundle` but no scenario asserts the reply part.
  status: done
  completed_by: `packages/conversation-sim/src/scenarios/answer-then-bundle.sim.test.ts` (gate id `answer-then-bundle`, 2026-10-15)
  evidence: Blind Hunter review of S3 (2026-10-15); the fix-plan verification matrix lists only the V2 queue suite and the next live cycle for S3.
- source_spec: `_bmad-output/implementation-artifacts/spec-gc3-s4-confirmation-completion.md`
  summary: Working rows confirmed by the pre-S4 `clarified` path (receipt `verdictKind='clarified'`, no `bundleId`, confirmed text never shown) are now refused by finalization forever and re-listed by `listPendingConfirmedQuestions` on every run without being purged; before deploying S4, check production for `survey_question_working_insights` rows in `confirmed` status with `purged_at is null` and either backfill them to `collecting` + ready so they are shown back, or purge them, with user approval.
  evidence: Blind Hunter and Edge Case Hunter reviews of S4 (2026-10-15); as of 2026-10-15 no V2 cycle is active and the closed cycle's rows are finalized and purged, so the current risk is nil, but the check is required at deploy time.
- source_spec: `_bmad-output/implementation-artifacts/spec-gc3-s4-confirmation-completion.md`
  summary: A `reject` verdict on a one-statement corrected bundle ("no, that's still wrong") keeps the ordinary semantics (reset: the correction is wiped and the question re-collected from scratch) because the bundle interpreter cannot tell a corrected bundle from an ordinary one-statement bundle; the product owner must decide whether such a reply should instead reopen the clarification question, which needs a bundle kind marker.
  evidence: Blind Hunter review of S4 (2026-10-15); the spec listed this as an Ask First item and the orchestrator maps the verdict unchanged.
- source_spec: `_bmad-output/implementation-artifacts/spec-gc3-s4-confirmation-completion.md`
  summary: The V2 queue suite's bundle interpreter stub answers `agree` for every one-statement bundle, so "disputed again" on a corrected statement, `reject` on a corrected statement, a clarified statement while a second statement of the group is still disputed, and a retry after the corrected turn committed are covered only by orchestrator unit tests, not end to end.
  evidence: Blind Hunter review of S4 (2026-10-15); `apps/worker/src/conversation/v2-conversation-flow.integration.test.ts` interpretQuestionBundleResponse mock.
- source_spec: `_bmad-output/implementation-artifacts/spec-gc-s7-offers-delivered-format-honored.md`
  summary: Build a reply plan on V2 bundle and clarification turns so an accepted offer or an explicit format request on those turns still reaches the two-part reply contract.
  evidence: Both S7 reviewers (2026-10-15): `conversation-orchestrator.ts` sets `replyPlan` to undefined whenever a confirmation, bundle, or clarification is pending, so `acceptsPriorOffer` and `formatRequest` are dropped there; S3 already deferred reply-plan integration for bundle turns.
- source_spec: `_bmad-output/implementation-artifacts/spec-gc-s7-offers-delivered-format-honored.md`
  summary: Exclude outbound messages whose delivery failed from the transcript the classifier reads as the latest mentor turn.
  evidence: Blind Hunter review of S7 (2026-10-15): `apps/worker/src/conversation/repositories/conversation.repository.ts` `findRecentMessages` filters only `deletedAt`, so an undelivered offer can make the next "yes" an `acceptsPriorOffer`; pre-existing for every transcript-derived signal.
- source_spec: `_bmad-output/implementation-artifacts/spec-gc3-s4b-corrected-statement-reclarify.md`
  summary: Resolves the S4 entry on `reject` semantics for a one-statement corrected bundle; per the 2026-10-17 product decision a reject or dispute asks one more clarification (at most two per question), then the question closes as declined and not collected.
  evidence: S4b implementation and review loop, 2026-10-17.
- source_spec: `_bmad-output/implementation-artifacts/spec-gc3-s4b-corrected-statement-reclarify.md`
  summary: Migration 0051 has no backfill. Before deploying it, confirm that production has no active V2 window. Otherwise corrected bundles still awaiting a verdict get `kind='confirmation'` and in-flight rows get `clarification_attempts=0`. Then either backfill the attempts from the clarified receipts and the open clarification prompts, or accept the gap with user approval.
  evidence: Blind Hunter and Edge Case Hunter reviews of S4b (2026-10-17). The read-only production check of 2026-10-17 found 0 active V2 windows, so the current risk is nil.
- source_spec: `_bmad-output/implementation-artifacts/spec-gc3-s4b-corrected-statement-reclarify.md`
  summary: The retry flag `questionNotCollected` is derived from the working row's current status instead of being stored on the verdict receipt. If the row is reopened between the commit and a retry of the same job, the replayed reply loses the not-collected sentence.
  evidence: Blind Hunter and Edge Case Hunter reviews of S4b (2026-10-17). The window is narrow because a reopen needs a newer employee message.
- source_spec: `_bmad-output/implementation-artifacts/spec-gc3-s4b-corrected-statement-reclarify.md`
  summary: The clarification interpreter prompt still says a clarified answer "authorizes the corrected meaning; no second bundle confirmation is needed". That has been stale since S4 shows the correction back for a verdict. Updating it changes the interpreter contract, which is an Ask First item.
  evidence: Read while implementing S4b, in `packages/ai-openai/src/prompts/question-clarification.ts`.

- source_spec: `_bmad-output/implementation-artifacts/spec-gc3-s5-topic-steering-cause.md`
  summary: A V2 question completed across two messages is closed in the backlog by the coverage reconcile (`markDone(..., 0)`), so its group is not re-prioritized and `evidenceCapturedCount` stays 0.
  evidence: S5 review (both reviewers); `markQuestionCovered` fires only when one message alone makes the question ready.
- source_spec: `_bmad-output/implementation-artifacts/spec-gc3-s5-topic-steering-cause.md`
  summary: Topic selection issues one idempotent `markDone` update per settled V2 question on every lookup; batch it or read backlog statuses first.
  evidence: S5 Blind Hunter finding 10; correct but adds writes on the conversation path (lookups now run only when the cadence and cap allow).

- source_spec: `_bmad-output/implementation-artifacts/spec-12-1-case-schema-loader-and-rule-registry-contract.md`
  summary: The wrapped `repeated-question` rule cannot fail in an atomic test, because `CaseRun` carries no seed history and the single reply is only compared with itself; a coach re-asking a seeded coach question is never flagged.
  evidence: Blind Hunter and Edge Case Hunter (Story 12.1 review, 2026-10-24); confirmed in `rules/repeated-question.ts` and `CaseRunSchema`. Decide in 12.2/12.3 whether `evaluate` passes the test's seed to rules (as the judge transcript already does for atomic tests) or `CaseRun` records it. Severity medium.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-1-case-schema-loader-and-rule-registry-contract.md`
  summary: `RuleCheck.params` is free-form and never validated against the rule; give `RuleEntry` an optional params schema when the first parameterized rule (`effect-count`, `state-equals`) lands in 12.3, so a mistyped param fails at load instead of being ignored.
  evidence: Blind Hunter and Edge Case Hunter (Story 12.1 review); no 12.1 rule takes params and no case data exists before 12.4, so there is no live harm yet.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-3-suite-rule-implementations.md`
  summary: Story 12.3 split; the proactive-window rules, `clock-leak` and the state/event rules (`effect-count`, `state-equals`, `state-not-greater-than`) moved to Story 12.3b (`spec-12-3b-proactive-state-and-clock-rules.md`, draft).
  evidence: The full 12.3 spec was about 2,300 tokens; the user approved the split on 2026-10-25.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-2-evaluation-scoring-and-report-core.md`
  summary: `score` only sees results it is given; a suite criterion with no results (or an empty run) leaves `complete: true`, and an empty run reads as `n/a (journeys only)`.
  evidence: Blind Hunter and Edge Case Hunter (Story 12.2 review). Unverified, medium if the 12.8 runner can drop a test's results; settle in 12.8 by checking every suite key is present before scoring.
  resolution: Resolved in 12.8 (2026-10-25) — `score` marks a run with no in-scope test result INCOMPLETE and provisional (`incomplete: no in-scope test criteria`) with the verdict from `decideVerdict`, and `runSuite` asserts n results per `<testId>/<criterionId>` before scoring.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-2-evaluation-scoring-and-report-core.md`
  summary: The synthesized `effect-count` carries `step` = the criterion's evaluated step, so a `change` criterion at `after` in a multi-step journey counts only last-step events.
  evidence: Blind Hunter and Edge Case Hunter (Story 12.2 review). Unverified, medium if real journeys stage effects before the last step; settle in 12.3b (draft) by deciding whether `effect-count` counts on the step or over steps 1..step.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-3-suite-rule-implementations.md`
  summary: The loader validates `RuleCheck.params` with the rule schema but discards the parsed value, so `evaluate` passes raw params to `run`; schema defaults, coercion and transforms never reach a rule, and synthesized `effect-count` params are never validated.
  evidence: Blind Hunter and Edge Case Hunter (Story 12.3a review). Unverified, medium if a 12.3b rule schema uses defaults or transforms; settle in 12.3b by parsing params in `runCheck` or storing parsed params on the loaded check.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-5-clockport-in-the-application-layer.md`
  summary: `MemoryExtractionUseCase` still computes memory `expiresAt` from the wall clock (`memory-extraction.use-case.ts` `computeExpiry`), while the sim's `InMemoryMemoryRepository.findActiveByUser` now filters by the injected clock; under a harness clock that is advanced across simulated days, extracted memories expire on real time, not simulated time.
  evidence: Blind Hunter (Story 12.5 review, 2026-10-25); confirmed by reading `computeExpiry` (zero-arg `new Date()`). Behavior with the default system clock is unchanged; the gap matters once 12.7 runs multi-day journeys. Thread `ClockPort` into `MemoryExtractionUseCase` (and the inline outbox) in 12.3b or 12.7. Severity medium.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-3b-proactive-state-and-clock-rules.md`
  summary: `__fixtures__/evaluation.ts` still overrides `effect-count` with the 12.2 stand-in, so most `evaluate` pairing paths run against the stand-in, not the real rule (only `effect-count.test.ts` uses the real `RULES`).
  evidence: Story 12.3b review, 2026-10-25 (all four layers). Swap the stand-in once 12.4 cases and the 12.7 executor exist. Severity medium.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-3b-proactive-state-and-clock-rules.md`
  summary: State rule params duplicate the criterion's `stateQuery` and the loader does not cross-check them; `alreadySatisfied` then marks a criterion INVALID when the rule reads a different snapshot, when `state-equals` reads `before` on a `change` criterion, and always for `state-not-greater-than` on a `change` criterion.
  evidence: Edge Case Hunter and Verification Gap (Story 12.3b review); `evaluate.ts:216-233`. 12.4 authors: put upper bounds on `invariant` criteria and keep params `query`/`at` equal to `stateQuery`; a loader cross-check is the durable fix. Severity medium.
  resolution: Re-scoped in 12.4 (2026-10-27) — every p-v1 state criterion keeps rule params `query`/`at` equal to its `stateQuery`, every `invariant` carries a bound (`state-equals` or `state-not-greater-than` with `max`), and `loader.test.ts` asserts both for the suite. The loader cross-check stays the durable fix (open).
- source_spec: `_bmad-output/implementation-artifacts/spec-12-3b-proactive-state-and-clock-rules.md`
  summary: The 12.7 executor contract (copy the message column into `metadata.messageType` for `window.outbound`, `steps[].reply.messages` and `unsolicited`; emit only in-window messages in `window.outbound`) is asserted only rule-side; `initiations()` does not filter by `window.from`/`to`.
  evidence: Intent Alignment, Blind Hunter and Edge Case Hunter (Story 12.3b review). Settle in 12.7 with an executor test. Severity medium (unverified).
- source_spec: `_bmad-output/implementation-artifacts/spec-12-3b-proactive-state-and-clock-rules.md`
  summary: `evaluate.ruleChecks` synthesizes `effect-count` with `step: 0` for observation tests, which counts only seed and fixture events.
  evidence: Blind Hunter (Story 12.3b review); pre-existing 12.2 synthesis at `evaluate.ts:94`. Settle when the first observation test pairs a state effect (12.4). Severity medium (unverified).
  resolution: Not applicable in 12.4 (2026-10-27) — P-06 pairs no `stateEffect`; its window events are recorded at `stepIndex` 0, and P-06.E1 states `step: 0` explicitly. Reopen if an observation test pairs a state effect.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-3b-proactive-state-and-clock-rules.md`
  summary: The P-09 bound `max: { repliesWithMetadata }` counts only `steps[].reply.messages`, not `unsolicited`; a summary sent unsolicited would raise the count without raising the bound.
  evidence: Blind Hunter (Story 12.3b review, loop 2). Settle in 12.4 by checking whether survey summaries can arrive unsolicited. Severity medium (unverified).
  resolution: Resolved in 12.4 (2026-10-27) by reading the bundle path — the orchestrator stages a summary only in `persistPreparedTurn`, with `promptMessageId` = the turn's own outbound reply (`conversation-orchestrator.ts` near 1443), and proactive check-ins stage nothing (P-06.E1), so a summary never arrives unsolicited. Corrected statements are a separate gap (entry below).
- source_spec: `_bmad-output/implementation-artifacts/spec-12-3-suite-rule-implementations.md`
  summary: Resolved in 12.3b — rules with a params schema now parse raw params themselves in `run`, so defaults apply and synthesized `effect-count` params are validated; `evaluate` and `loader` unchanged.
  evidence: Story 12.3b (2026-10-25), `suite/rules/*.ts`.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-7-l0-deterministic-executor-and-fixtures.md`
  summary: Real P-suite cases do not yet run offline in the PR gate; the L0 executor is proven on synthetic tests only.
  evidence: Story 12.7 review (Intent Alignment). Needs 12.4 cases, the 12.8 runner and the 12.10 CI job. Severity medium.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-7-l0-deterministic-executor-and-fixtures.md`
  summary: `harness/report.ts` imports `vitest` at module load, so `CoachHarness` cannot load under tsx; `suite:run` (12.8) must make it lazy first.
  evidence: Story 12.7 implementer probe; `docs/agent-failures.md` 2026-10-25 entry. Severity medium.
  resolution: Resolved in 12.8 (2026-10-25) — the hook lives in vitest-free `harness/test-failure-hook.ts`; the import-graph test bans runtime `vitest` imports and spawns the CLI under plain Node.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-7-l0-deterministic-executor-and-fixtures.md`
  summary: The in-memory question-confirmation fake has no contract test against the PostgreSQL repository; `disclosureDelivered` copies an unexported disclosure version literal.
  evidence: Story 12.7 review (Blind Hunter). Settle when P-07/P-09/P-10 L0 cases exist. Severity medium (unverified).
- source_spec: `_bmad-output/implementation-artifacts/spec-12-8-runner-suite-run-and-suite-baseline-accept.md`
  summary: The test-failure hook falls back to Vitest's undocumented `globalThis.__vitest_index__` for the fixture Vitest configs spawned by `failure-classifier.test.ts` and `coach-harness.test.ts`, which lack `setupFiles`.
  evidence: Story 12.8 review (Blind Hunter). Add `setupFiles` to those fixture configs and drop the fallback; open entry in `docs/agent-failures.md`. Severity medium.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-8-runner-suite-run-and-suite-baseline-accept.md`
  summary: `budgets.maxCoachCallsPerRun` / `maxJudgeCallsPerRun` are validated but not enforced by the runner.
  evidence: Story 12.8 review (Blind Hunter). No cost at L0; enforce `budget-exceeded` (AD-15) when the L1/L2 executors land. Severity medium (unverified).
- source_spec: `_bmad-output/implementation-artifacts/spec-12-4-p-suite-atomic-tests-and-smoke-journeys.md`
  summary: `ScriptedStep` has no outputs for `interpretQuestionBundleResponse` or `interpretQuestionClarificationResponse`; the L0 scripted model always answers `unrelated`, so no verdict or clarification is applied at L0.
  evidence: Story 12.4 (2026-10-27), `fakes/scripted-ai.ts`, `executors/l0-scripted.ts`. P-09.A3 (E4-E6) and P-09.A4 (C3, E7) are L1-only tests, and P-09.A5 (C4, C5, E8) carries `levels: ['L1']` inside its L0 test, against the approved effects draft (L0, L1). Add scripted verdict outputs to the schema and the L0 model, then widen those criteria to L0. Severity medium.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-4-p-suite-atomic-tests-and-smoke-journeys.md`
  summary: `state-not-greater-than` `max: { repliesWithMetadata }` takes one metadata key; a corrected statement is staged (counted in `stagedBundleCount`) but carries `v2CorrectedStatement`, not `v2ConfirmationBundle`.
  evidence: Story 12.4 (2026-10-27). P-09.J C6 therefore uses `max: 2` (one summary and one corrected statement in the authored flow); P-09.A5 keeps the metadata bound (delta 0). Accept several keys in the bound. Severity medium.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-4-p-suite-atomic-tests-and-smoke-journeys.md`
  summary: `freshPersona` verifies that no question window exists, so it can never be satisfied together with `pulseCycle` (at L1 and at L2).
  evidence: Story 12.4 (2026-10-27), `fixtures/fresh-persona.ts`, `executors/l2-application-executor.ts`. P-09.J and P-10.J omit `freshPersona` (the spec table lists it); isolation comes from the run profile. Make `freshPersona` ignore a window the same setup opens, or order its verify before `pulseCycle`. Severity low.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-4-p-suite-atomic-tests-and-smoke-journeys.md`
  summary: `confirmationState` cannot say whether a pending clarification was already asked; the question-confirmation fake now treats every seeded clarification as asked and delivered (P-09.A4 needs that state).
  evidence: Story 12.4 (2026-10-27), `fakes/question-confirmation.ts` `seedPendingClarification`. A fixture param (prompt shown or not) is the durable fix. Severity low.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-4-p-suite-atomic-tests-and-smoke-journeys.md`
  summary: P-10.J cannot show a summary on reply 3 on live L1/L2 runs: it starts from pending Belonging questions and the third answer is extracted after the reply, so the production ready-group rule offers nothing yet and P-10.J C2 is expected red. P-10.A1 is fixed (third ready summary approved 2026-10-27).
  evidence: Story 12.4 (2026-10-27); `p-v1-product-findings.md` F5. Add an authored user turn after step 3 (as in P-09.J) and move C2 there, after a Product/QA decision. Severity medium.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-4-p-suite-atomic-tests-and-smoke-journeys.md`
  summary: The spec acceptance criterion puts the P-09.J `bundle-staged` stop checkpoint on step 3; the 2026-10-27 P-09 decision and the design table put it after the summary turn, which is what the suite does (journey step 4).
  evidence: Story 12.4 (2026-10-27), `cases/p-v1/p-09-j.case.ts`, `loader.test.ts`. Reword the acceptance criterion on the next spec touch. Severity low.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-4-p-suite-atomic-tests-and-smoke-journeys.md`
  summary: The `suite:run` console layer table prints the `E` row between S and P+D+C; `report.md` and the CI summary print it after P+D+C, marked "not in verdict".
  evidence: Story 12.4 (2026-10-27), `cli.ts` (outside the story's allowed changes). Severity low.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-4-p-suite-atomic-tests-and-smoke-journeys.md`
  summary: The question-confirmation fake mirrors production for partial verdicts and the ready-group rule only; a `reject` still marks questions `disputed` (production resets and purges them) and a clarified ready statement is not offered as `kind: 'corrected_statement'`.
  evidence: Story 12.4 (2026-10-27), `fakes/question-confirmation.ts`; `question-insight.repository.ts:655-702, 805-830`. No p-v1 test reaches either path. Severity low.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-4-p-suite-atomic-tests-and-smoke-journeys.md`
  summary: P-06 runs with a UTC user and every check-in lands at 08:00 UTC, so neither the 20:00-22:00 known red nor "in the employee's timezone" is exercised.
  evidence: review 2026-10-27 (#10); add a non-UTC persona (e.g. Europe/Kyiv) or a window start that puts a scan in 20:00-22:00 local. Severity medium.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-4-p-suite-atomic-tests-and-smoke-journeys.md`
  summary: Live P-09.J/P-10.J rely on the extractor mapping the suite answers to `q12_strengths_opportunity` (autonomy) and `wellbeing_at_work` (belonging); if it does not, the group never becomes ready.
  evidence: review 2026-10-27 (#11), unverified, severity medium if true; settle with the first L1 run of the journeys or a QA check of the canonical questions.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-4-p-suite-atomic-tests-and-smoke-journeys.md`
  summary: `confirmationState.stagedBundle` cannot seed a `kind: 'corrected_statement'` bundle, so P-09.A5 at L1 takes the regular-bundle verdict path.
  evidence: review 2026-10-27 (#21); `suite/fixtures/confirmation-state.ts:90-109` calls `stageQuestionConfirmationBundle` without `kind`. Severity medium.
- source_spec: `_bmad-output/implementation-artifacts/spec-12-4-p-suite-atomic-tests-and-smoke-journeys.md`
  summary: Meaning criteria on `observation-window` are never judged (`evaluate.ts` returns NOT_RUN `judge-unsupported:observation-window`), so P-06.C4 (restates the earlier conversation) and P-06.C5 (no internal objectives) stay NOT_RUN even at L1, although the P-06.C4 setup now gives the first check-in an earlier conversation and memory.
  evidence: Story 12.4 follow-up (2026-10-27). RESOLVED 2026-10-27: `observation-window` meaning criteria are judged on the window's bot-initiated messages (`windowScope: first` for C4, `all` for C5), with the seed history as the earlier conversation; judge prompt unchanged. Not yet run against a live judge.
