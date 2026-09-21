# PR #5 Product Conformance Audit and Remediation Plan

Date: 2026-09-06
Status: audit, Phase 0, Phase 1, and Phase 2 complete locally; Phase 3 implementation in progress
Scope: current TypeScript product spine on `codex/grill-session-docs` against `main`
Primary requirements: `docs/collected-product-requirements.md`
Original audit scope excluded MAF, `agent-service`, production changes, and live-model evaluation. Later production smoke was separately authorized; further production work still requires separate authorization.

## Conclusion

The baseline audited project did not conform to the product requirements collected in PR #5. The status counts and traceability matrix below preserve that baseline; current remediation progress is tracked separately under Implementation Progress.

- Implemented: REQ-008, REQ-010, REQ-014, REQ-015, REQ-019, REQ-036, REQ-042.
- Partial: 22 requirements.
- Missing: REQ-021, REQ-029, REQ-033.
- Contradicted: REQ-013, REQ-017, REQ-022, REQ-024, REQ-025, REQ-026, REQ-032, REQ-037, REQ-039, REQ-040, REQ-041, REQ-046.
- Documentation or deferred scope only: REQ-035, REQ-038, REQ-043.

Exact displayed-summary binding and persisted reporting disclosure are verified in production. The local branch now also has typed de-identification acceptance, correction/withdrawal handling, and a persisted tenant/team/definition/period reporting cohort. The next reporting risk is the immutable report snapshot and delivery lifecycle: revalidation immediately before Slack delivery, delivery idempotency, and final-cycle publication remain open.

## Baseline Requirement Traceability Matrix

| Requirement | Status | Key evidence or gap |
| --- | --- | --- |
| REQ-001 | Partial | Slack ingestion accepts any message without enforcing a private DM: `packages/channel-slack/src/slack.normalizer.ts:24-80`. |
| REQ-002 | Partial | The companion promise remains primarily prompt policy: `packages/ai-openai/src/prompts/respond.ts:96-128`. |
| REQ-003 | Partial | Group reports generate an explanation and three actions, but there is no released manager/HR surface: `packages/application/src/use-cases/group-report.use-case.ts:50-70`. |
| REQ-004 | Partial | Pulse gating exists, while trust-over-backlog fit remains model-decided: `packages/application/src/use-cases/conversation-orchestrator.ts:148-188`. |
| REQ-005 | Partial | `ReplyPlan` follows the latest dialogue act, but pulse-topic fit is not deterministic policy: `packages/application/src/utils/reply-plan.ts:16-46`. |
| REQ-006 | Partial | Proactive check-in selects a backlog topic; its flexible human shape is prompt-led: `packages/application/src/use-cases/proactive-check-in.use-case.ts:79-121`. |
| REQ-007 | Implemented locally | Pending questions from a group with an unresolved active probe are excluded from selection, and stale no-evidence ignored groups move behind other pending topics. |
| REQ-008 | Implemented locally | Engagement questions are eligible only in the half-open final-14-day interval; AI evidence accepts only explicit integer 1-10 numeric values, persists them on assessments, and engagement scores average the three persisted values on a 1-10 scale with one-decimal dashboard display. |
| REQ-009 | Partial | Quarter bounds exist, but active windows are not closed or cleaned at expiry: `apps/worker/src/survey/repositories/survey.repository.ts:41-89`. |
| REQ-010 | Implemented | Full group coverage creates `pending_confirmation`; the shared orchestrator advances one eligible pending group into a natural confirmation prompt, including when other groups are already confirmed: `packages/application/src/use-cases/survey-evidence.use-case.ts:204-265`, `packages/application/src/use-cases/conversation-orchestrator.ts`. |
| REQ-011 | Partial | Raw survey evidence acts as working state without a typed reportability lifecycle: `packages/database/src/schema/survey.ts:81-129`. |
| REQ-012 | Partial | Exact delivered-summary binding and later agreement are implemented, but rewrite and exclusion remain absent and correction does not yet create a replacement version: `packages/contracts/src/ai.ts:199-205`, `packages/application/src/use-cases/conversation-orchestrator.ts`. |
| REQ-013 | Contradicted | Confirmation prompt guidance exists, but no typed TypeScript de-identification policy returns a persisted accepted/rejected decision with reasons and policy version: `packages/ai-openai/src/prompts/group-confirmation.ts:8-15`. |
| REQ-014 | Implemented | Free-text confirmation uses the exact delivered summary in a localized natural prompt; successful agreement produces a question-free acknowledgement: `packages/application/src/use-cases/conversation-orchestrator.ts`, `packages/ai-openai/src/prompts/respond.ts`. |
| REQ-015 | Implemented | A versioned disclosure is rendered deterministically, recorded only after delivery, and required before confirmation; confirmation state preserves disclosure version and time: `packages/application/src/utils/reporting-disclosure.ts`, `apps/worker/src/conversation/repositories/conversation.repository.ts`. |
| REQ-016 | Partial | Per-window confirmed group state exists, but no anonymized permanent insight type does: `packages/database/src/schema/survey-group-states.ts:6-25`. |
| REQ-017 | Contradicted | Correction reopens the group while retaining the prior summary and ignoring `correctionNote`, opposing replacement and reconfirmation: `packages/application/src/use-cases/conversation-orchestrator.ts:397-410`. |
| REQ-018 | Implemented locally | Reports query confirmed states only, and cycle close expires unconfirmed temporary working states after the persisted cutoff. |
| REQ-019 | Implemented | Private memory is stored and read by tenant and employee: `apps/worker/src/memory/repositories/memory.repository.ts:15-89`. |
| REQ-020 | Partial | Reports do not read memory directly, but their summaries lack a de-identification gate: `packages/application/src/use-cases/group-report.use-case.ts:46-55`. |
| REQ-021 | Missing | No exclude verdict or persisted non-reportable marker exists: `packages/contracts/src/ai.ts:201-204`. |
| REQ-022 | Contradicted | Manager contracts expose employee identity, risk, and evidence: `packages/contracts/src/admin-manager-team.ts:10-37`. |
| REQ-023 | Partial | Individual targeting is forbidden only in report prompt prose: `packages/ai-openai/src/prompts/group-report.ts:11-20`. |
| REQ-024 | Contradicted | Historical per-window rows can satisfy the five-person threshold because the query is not cycle-scoped or distinct: `apps/worker/src/survey/repositories/group-state.repository.ts:93-108`. |
| REQ-025 | Contradicted | No structural generalization or inference-risk validator exists before reporting: `packages/ai-openai/src/prompts/group-report.ts:12-18`. |
| REQ-026 | Contradicted | Pulse overview exposes named confirmation and backlog progress: `apps/api/src/admin/pulse-overview.controller.ts:181-227`. |
| REQ-027 | Partial | Team aggregation exists but consumes unscoped individual group summaries: `packages/application/src/use-cases/group-report.use-case.ts:23-55`. |
| REQ-028 | Partial | The 80% and five-person rule exists, but historical duplicate rows can satisfy it: `packages/application/src/use-cases/group-report.use-case.ts:27-35`. |
| REQ-029 | Missing | The only report input is team plus question group; no final-cycle report path exists: `packages/application/src/use-cases/group-report.use-case.ts:4-15`. |
| REQ-030 | Partial | Team action items are generated, but no typed no-individual validator exists: `packages/contracts/src/ai.ts:250-256`. |
| REQ-031 | Partial | The data model contains only flat teams and memberships, not an organization hierarchy: `packages/database/src/schema/teams.ts:5-20`. |
| REQ-032 | Implemented locally | A partial unique index prevents more than one active `member` team per employee. |
| REQ-033 | Missing | Employee role is free text and subordinate relationships are not modeled: `packages/database/src/schema/teams.ts:13-20`. |
| REQ-034 | Partial | A flat team has a manager Slack ID and active members, but no typed Team Lead role: `apps/worker/src/survey/repositories/team.repository.ts:44-69`. |
| REQ-035 | Docs-only | Manager of Managers hierarchy and reporting are explicitly deferred from MVP: `docs/collected-product-requirements.md`. |
| REQ-036 | Implemented | Reports fail closed below five employees and MVP roll-up is disabled: `packages/application/src/use-cases/group-report.use-case.ts:27-35`. |
| REQ-037 | Implemented locally | Active survey-window rollover closes the old cohort-bound window after transfer and starts a current-team window outside the open reporting cohort. |
| REQ-038 | Docs-only | HR/HRBP reporting is explicitly deferred: `docs/collected-product-requirements.md`. |
| REQ-039 | Implemented locally | The current dashboard is labeled as an internal product-testing dashboard and is not treated as a released manager surface. |
| REQ-040 | Implemented locally | Dashboard fetch/post calls and named employee API routes fail closed unless `INTERNAL_DASHBOARD_ENABLED=true` or `1`. |
| REQ-041 | Implemented locally | Development visibility remains available only behind the explicit internal dashboard gate. |
| REQ-042 | Implemented | Inbound jobs execute the TypeScript orchestrator directly: `apps/worker/src/conversation/conversation.processor.ts:268-301`. |
| REQ-043 | Docs-only | MAF exclusion is an explicit architecture scope decision: `docs/adr/ADR-012-typescript-runtime-product-spine.md:14-19`. |
| REQ-044 | Partial | Reply policy is typed, but consent, reportability, and de-identification remain untyped or prompt-only: `packages/application/src/ports/survey.repository.port.ts:29-60`. |
| REQ-045 | Partial | Quiet-hours and some repository filtering exist, but deterministic suppression is not enforced at every pulse entry point: `packages/application/src/use-cases/proactive-scheduler.use-case.ts:49-73`. |
| REQ-046 | Contradicted | Group reporting can query cross-window rows without tenant scope: `apps/worker/src/survey/repositories/group-state.repository.ts:93-108`. |
| REQ-047 | Implemented locally | `retention:cleanup` applies active tenant retention policy cutoffs across messages, survey evidence, memory items, risk signals, survey group states, audit logs, and report snapshots. |

## Audit Baseline Verification Evidence

This table records the pre-Phase-0 baseline. Phase completion evidence is tracked separately below.

| Check | Result |
| --- | --- |
| PR #5 metadata and branch | Open PR; `codex/grill-session-docs` into `main`; 7 documentation files, +794/-0 |
| `git diff --check main...HEAD` | Pass |
| `pnpm typecheck` | Pass, 23/23 tasks |
| API tests | Pass, 91/91 |
| Worker tests | Pass, 140/140 |
| AI adapter tests | Pass, 56/56 |
| Application tests | Fail, 317/318; stale `topicAnchor` expectation in `conversation-orchestrator.test.ts:180` |
| Dashboard production build | Pass |
| Database integration tests | Pass, 19/19 against local Postgres |
| GitHub PR checks | No checks in the captured PR snapshot; final live refresh unavailable because `api.github.com` was unreachable |

## Consolidated BMad Triage

### Accepted implementation defaults — 2026-09-03

1. **Accuracy and reporting consent.** Persist onboarding disclosure; confirmation approves both accuracy and inclusion, with a natural, explicit exclusion option.
2. **Withdrawal after publication.** Block withdrawn content from every future snapshot and record the withdrawal; already delivered Slack messages remain immutable.
3. **Cohort denominator and report updates.** Freeze the eligible roster when the cycle opens, count each employee once, use `max(5, ceil(0.8 × eligibleRosterSize))`, and require changed input from at least five distinct employees before publishing an updated intermediate snapshot.
4. **Small-team roll-up.** Fail closed and defer roll-up until a Manager of Managers inference policy is approved.
5. **HR/HRBP visibility.** Keep HR/HRBP reporting deferred and do not reuse the admin dashboard as an HR surface.
6. **Cycle-close cutoff.** Use immutable `[periodStart, periodEnd)` UTC boundaries and clean temporary state even when no report is eligible or delivery fails.

### Remaining local implementation gaps

No active local implementation gap remains in the current TypeScript MVP slices covered by this remediation plan. The remaining work is verification and explicitly deferred product scope.

Open operational checks:

1. Run final deterministic local gates after the accumulated branch changes.
2. Run live Slack/production smoke only after explicit authorization and with real credentials.

### Deferred product scope

- Manager-of-managers hierarchy and roll-up until OQ-001 is resolved.
- HR/HRBP reporting until OQ-002 is resolved.
- The released customer manager/HR surface and auth model until OQ-004 is designed.

## Remediation Plan

## Implementation Progress

| Phase | Status | Evidence |
| --- | --- | --- |
| Phase 0 — executable product contract | complete | 47 sequential requirements and traceability rows; BMad blind review patched; contract validation and both diff checks pass |
| Phase 1 — focused baseline tests | complete | One stale assertion corrected; focused tests 38/38 and full application tests 318/318 pass |
| Phase 2 — reportable-insight boundary | complete locally | Typed de-identification acceptance plus correction/withdrawal are implemented and locally verified; earlier confirmation/disclosure lifecycle is production-verified |
| Phase 3 — team/cycle cohort scope | in progress | Canonical persisted cohort, cycle opening, transfer rollover, scoped distinct counting, legacy rollover, immutable snapshot/delivery, later intermediate version gating, final one-message cycle aggregation, and cycle-close temporary-state expiry are locally verified |
| Phase 4 — transfer and cycle lifecycle | complete locally | Active-member uniqueness, transfer rollover, cycle-close temporary expiry, and retention cleanup are locally verified |
| Phase 5 — development dashboard boundary | complete locally | `INTERNAL_DASHBOARD_ENABLED` gates dashboard fetch/post plus `manager/team`, `manager/trends`, `pulse/overview`, and `users/:id/insights`; focused API tests and dashboard build pass |
| Phase 6 — pulse behavior | complete locally | Numeric engagement, same-index prioritization, and skipped-topic suppression are locally verified |
| Phase 7 — end-to-end verification | complete locally | `prepush:non-maf` passed outside sandbox; root database integration now executes and passes 25 tests; live Slack/production smoke requires explicit authorization |

### Phase 2 verification evidence — 2026-09-05

- Commit `fa99ae8` fixed multi-group confirmation progression; commit `95e9f03` localized confirmation and closed successful agreements without follow-up questions.
- `95e9f03` passed focused prompt/provider/orchestrator checks, root typecheck/lint/package tests, and script tests.
- Manual Railway deployment `0d268486-ac30-470a-bec7-df50df7bf8a7` reached `SUCCESS` for `reasonable-adaptation / production / worker` only.
- After one explicitly authorized scoped reset, Slack marker `slack-confirm95e9f03-20260905T210302Z` in `D0BJDC2MPE2` exercised a fresh lifecycle.
- Production evidence confirmed `belonging`, `autonomy`, `growth`, and `engagement` with disclosure before prompt, exact persisted summary in each localized prompt, agreement before acknowledgement, and question-free acknowledgements (`maxQuestions=0`, `askedQuestion=false`).
- Six active memory items were persisted. No second reset or non-worker deployment occurred.

### Phase 2 local completion evidence — 2026-09-06

- A pure TypeScript de-identification policy returns a typed accepted/rejected decision with machine-readable reasons and a fixed policy version before confirmation or reporting.
- Correction invalidates the prior candidate and requires a new accepted candidate plus reconfirmation; exclusion and later withdrawal remain outside future report queries.
- Focused contracts/AI/application/worker tests, affected package typecheck/lint/build, and database integration passed. A fresh outside-sandbox `pnpm prepush` passed typecheck, lint, all package unit tests, and script tests in one run.

### Phase 0 — Make the product contract executable

The canonical requirements and glossary define the six accepted defaults and omitted invariants. `Pulse Index` is the single three-question completion unit. Tenant isolation, opt-out, quiet hours, risk suppression, retention, cutoff timestamps, frozen-roster behavior, final eligibility, and fail-closed reporting have explicit acceptance criteria.

Gate: every implementation story maps to numbered requirements with no contradictory acceptance criteria.

### Phase 1 — Lock the current baseline with focused tests

Correct the stale `topicAnchor` assertion after confirming the intended pause behavior. For each later product gap, add its focused failing test immediately before implementing that gap: persisted disclosure before confirmation, exact-summary confirmation, correction and reconfirmation, exclusion and later withdrawal, versioned de-identification acceptance/rejection, distinct cycle-scoped cohort counting, transfer isolation, dashboard production denial, cycle close, retention enforcement, and skipped-topic pulse behavior. Do not accumulate an intentionally red baseline across unrelated gaps.

Gate: the current application baseline is green; each later test is red only while its corresponding fix is being implemented.

### Phase 2 — Establish one reportable-insight boundary

Reuse `survey_group_states` as the working state unless the migration review proves it cannot represent the lifecycle. The delivered outbound message ID already versions the exact displayed summary and disclosure proof; do not add another version field without a demonstrated need. Complete the missing typed states or markers for correction, exclusion, withdrawal, and expiry. Only a confirmed, non-withdrawn employee-cycle insight with an accepted de-identification decision and policy version may cross the reporting port. Delivery-time withdrawal revalidation and stale queued snapshot cancellation remain in Phase 3 snapshot/delivery work.

Keep AI as a candidate generator. One pure TypeScript policy validates known identifiers and forbidden concrete referents, returns a typed accepted/rejected decision with reasons and policy version, and fails closed before confirmation. TypeScript decides, persists, and audits the transition. Private memory and raw survey evidence never satisfy the reporting port.

Gate: `GroupReportUseCase` cannot be called with raw evidence or an unconfirmed summary at compile time or runtime.

### Phase 3 — Scope cohorts and reports to team plus cycle

A canonical `survey_reporting_cohorts` row now freezes a sorted roster for each tenant/team/survey-definition/period at explicit cycle open. Employee windows reference that cohort, and the existing group-report queue, use case, and repository ports carry its ID. Reporting queries confirmed, accepted, non-withdrawn contributors from the exact scope, excludes later opt-out/deletion/transfer without shrinking the denominator, and counts each employee once.

Phase 3 now has the first immutable privacy-safe report snapshot and closed audit provenance, transfer-safe active window rollover, delivery-time contributor and target revalidation, durable delivery idempotency, later intermediate-report version gating, final one-message cycle aggregation, and cycle-close expiry for unconfirmed temporary working states. A later intermediate snapshot may be published only after the latest delivered visible snapshot and only when at least five distinct employees have changed reportable input rows; contributor deltas are used only for the gate and are not exposed in the manager payload. Final close may run only after the immutable `periodEnd` cutoff and uses the final-report floor of five distinct frozen-roster employees per Pulse Index, not the 80% intermediate threshold. It enqueues one cycle-level job per cohort, omits ineligible indices, and sends one consolidated manager message only when at least one index is eligible. If delivery-time revalidation invalidates a snapshot, the current worker attempt cancels it and stops; only a later explicit report trigger may build a replacement. Each snapshot freezes its exact `(workspaceConnectionId, managerSlackUserId)` target. A changed manager/workspace binding cancels the snapshot; it is never retargeted, and only a later explicit trigger may create a new snapshot for the current target. An ambiguous Slack outcome transitions the snapshot to `delivery_unknown`; automatic retries must not call Slack again, and the same tenant/cohort/report key remains delivery-blocked until explicit reconciliation. Pre-send TypeScript validation failure cancels the snapshot, a Slack receipt with an external message ID marks it delivered, and any exception after sending begins becomes `delivery_unknown`; this slice does not add Slack provider taxonomy. A partial unique index enforces one active employee team membership.

Do not add a pre-AI `generating` reservation. After AI returns a complete manager payload, TypeScript revalidates contributors and the frozen delivery target, then atomically persists the immutable payload plus closed provenance behind a database unique key. Only the insertion winner may call Slack; a concurrent loser stops. Add a generation state only if measured contention later justifies the extra lifecycle.

Define the anonymity floor and intermediate completion ratio once in a shared reporting-policy function. These are product constants, not environment settings; operators should not be able to weaken privacy by configuration.

Current gate evidence: historical unscoped windows, another tenant/team/cycle, duplicate employee rows, and transferred employees cannot change the reportable contributor count; focused application/worker tests and PostgreSQL integration tests pass. Final close now queues one final cycle report per cohort and the worker composes one manager message from eligible Pulse Indices.

### Phase 4 — Implement transfer and cycle lifecycle

A partial database unique index now enforces one active employee membership. Persist immutable `periodEnd` when the cycle opens. Transfer rollover closes the old team-bound survey window and excludes its insight state from later snapshots without shrinking the old denominator. It starts a new team-bound working window that cannot report in the current cycle and becomes eligible only when the next cycle opens. The idempotent cycle-close use case now emits eligible final reports and expires unconfirmed working state regardless of report success or cohort size.

The existing effective tenant retention policy is enforced by one idempotent cleanup script. Survey evidence uses `messagesRetentionDays`, permanent employee-cycle insights use `memoryRetentionDays`, risk signals use `riskSignalRetentionDays`, and withdrawals plus report snapshots use `auditLogRetentionDays`; working insights expire at the earlier of cycle close or the memory cutoff. Deleted or expired records do not re-enter active lifecycle paths. Add new policy fields only if a later approved requirement needs independently configurable durations.

Gate: transfer, cutoff, final eligibility, and retention integration tests pass under retries and reordered jobs; expired or deleted records cannot re-enter queues, cohort counts, or reports.

### Phase 5 — Put the development dashboard behind a real boundary

Keep the current detailed dashboard as an internal product-testing surface. Add one fail-closed environment gate for the whole dashboard and its individual-detail API routes. Rename user-facing labels that imply this is the released manager product. Do not build customer manager/HR authorization until OQ-004 is designed.

Gate: a customer or disabled environment cannot render or fetch named employee state even with a valid tenant parameter.

### Phase 6 — Finish pulse behavior at existing policy seams

Extend the existing `ReplyPlan`, `PulseBacklogService`, and typed AI contracts rather than adding another orchestrator. Explicit 1-10 engagement capture, persistence, final-14-day eligibility, 1-10 averaging, same-index backlog prioritization after captured evidence, and skipped-topic suppression are complete locally while preserving employee-led topic, risk blocks, opt-out, and quiet hours.

Gate: deterministic tests cover final-14-days engagement, missing and invalid answers, equal-weight aggregation and display rounding, numeric persistence, same-index completion, reactive topic priority, and skipped-topic behavior.

### Phase 7 — End-to-end verification

Run focused package tests, `pnpm prepush`, relevant database integration tests, and the dashboard build where affected. Run model-backed simulations and live Slack checks only after explicit authorization.

Gate: all deterministic checks pass and every active numbered requirement has current code/test evidence or an explicit approved deferral.

Local result: complete. `pnpm run prepush:non-maf` passed outside the sandbox, and `pnpm exec dotenv -e .env -- pnpm test:integration` now passes 25 database integration tests instead of silently skipping them. Live Slack and production smoke remain separate operational verification and require explicit authorization.

## Ponytail Constraints

- Reuse the existing TypeScript ports, `ReplyPlan`, survey group state, queues, and adapters before adding a new framework layer.
- Remove dead compatibility and future plumbing in separate low-risk changes; candidates include deprecated `ReplyBrief`, unused trend/report fields, duplicated pulse defaults, and unused admin/API surfaces.
- Use the database for membership uniqueness and lifecycle integrity.
- Add a shared policy helper only where at least two real consumers need the same rule.
- Keep MAF, HR reporting, roll-up, and customer dashboard design outside these fixes.

## Completion Criteria for This Planning Task

- All 47 active requirements classified against current code and tests.
- P0/P1/P2 gaps traced to concrete implementation boundaries.
- Product decisions separated from unambiguous engineering work.
- Ordered remediation plan includes verification gates and avoids speculative abstractions.
- No product code changed.
