# PR #5 Product Conformance Audit and Remediation Plan

Date: 2026-09-03
Status: audit, Phase 0 contract, and Phase 1 baseline repair complete; Phase 2 discovery in progress
Scope: current TypeScript product spine on `codex/grill-session-docs` against `main`
Primary requirements: `docs/collected-product-requirements.md`
Out of scope: MAF and `agent-service`, production changes, live-model evaluation

## Conclusion

The current project does not yet conform to the product requirements collected in PR #5.

- Implemented: REQ-019, REQ-036, REQ-042.
- Partial: 24 requirements.
- Missing: REQ-015, REQ-021, REQ-029, REQ-033.
- Contradicted: REQ-008, REQ-013, REQ-017, REQ-022, REQ-024, REQ-025, REQ-026, REQ-032, REQ-037, REQ-039, REQ-040, REQ-041, REQ-046.
- Documentation or deferred scope only: REQ-035, REQ-038, REQ-043.

The highest-risk problem is the reporting boundary. Reporting currently consumes `SurveyGroupStateRecord.aiSummary`, while that state is neither the exact summary shown to the employee nor a typed, de-identified, cycle-scoped reportable insight. Local prompt changes cannot enforce consent, correction, exclusion, cohort, and privacy invariants at this boundary.

## Requirement Traceability Matrix

| Requirement | Status | Key evidence or gap |
| --- | --- | --- |
| REQ-001 | Partial | Slack ingestion accepts any message without enforcing a private DM: `packages/channel-slack/src/slack.normalizer.ts:24-80`. |
| REQ-002 | Partial | The companion promise remains primarily prompt policy: `packages/ai-openai/src/prompts/respond.ts:96-128`. |
| REQ-003 | Partial | Group reports generate an explanation and three actions, but there is no released manager/HR surface: `packages/application/src/use-cases/group-report.use-case.ts:50-70`. |
| REQ-004 | Partial | Pulse gating exists, while trust-over-backlog fit remains model-decided: `packages/application/src/use-cases/conversation-orchestrator.ts:148-188`. |
| REQ-005 | Partial | `ReplyPlan` follows the latest dialogue act, but pulse-topic fit is not deterministic policy: `packages/application/src/utils/reply-plan.ts:16-46`. |
| REQ-006 | Partial | Proactive check-in selects a backlog topic; its flexible human shape is prompt-led: `packages/application/src/use-cases/proactive-check-in.use-case.ts:79-121`. |
| REQ-007 | Partial | Stale ignored probes rotate to the queue tail only through a time-based rule: `apps/worker/src/survey/repositories/pulse-backlog.repository.ts:52-126`. |
| REQ-008 | Contradicted | Five three-question indices are seeded, but the contract accepts `numeric_0_10` and orchestration maps polarity to 10/5/0 instead of requiring an explicit 1-10 answer: `packages/contracts/src/ai.ts:246`, `packages/application/src/use-cases/conversation-orchestrator.ts:464`. |
| REQ-009 | Partial | Quarter bounds exist, but active windows are not closed or cleaned at expiry: `apps/worker/src/survey/repositories/survey.repository.ts:41-89`. |
| REQ-010 | Partial | Full group coverage creates `pending_confirmation`, surfaced on a later inbound turn: `packages/application/src/use-cases/survey-evidence.use-case.ts:204-265`. |
| REQ-011 | Partial | Raw survey evidence acts as working state without a typed reportability lifecycle: `packages/database/src/schema/survey.ts:81-129`. |
| REQ-012 | Partial | Confirmation supports only `agree`, `correct`, and `unclear`; rewrite/exclude are absent: `packages/contracts/src/ai.ts:199-205`. |
| REQ-013 | Contradicted | Confirmation generation asks for specificity without deterministic de-identification: `packages/ai-openai/src/prompts/group-confirmation.ts:8-15`. |
| REQ-014 | Partial | Free-text replies are interpreted into a typed verdict, but the exact natural displayed-summary flow is not preserved end to end: `packages/application/src/use-cases/conversation-orchestrator.ts:386-410`. |
| REQ-015 | Missing | `onboarding` is only a mode; no persisted reporting disclosure exists: `packages/contracts/src/ai.ts:209-220`. |
| REQ-016 | Partial | Per-window confirmed group state exists, but no anonymized permanent insight type does: `packages/database/src/schema/survey-group-states.ts:6-25`. |
| REQ-017 | Contradicted | Correction reopens the group while retaining the prior summary and ignoring `correctionNote`, opposing replacement and reconfirmation: `packages/application/src/use-cases/conversation-orchestrator.ts:397-410`. |
| REQ-018 | Partial | Reports query confirmed states only, but no end-of-cycle unconfirmed cleanup exists: `apps/worker/src/survey/repositories/group-state.repository.ts:93-108`. |
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
| REQ-032 | Contradicted | No constraint enforces one active team membership per employee: `packages/database/src/schema/teams.ts:13-20`. |
| REQ-033 | Missing | Employee role is free text and subordinate relationships are not modeled: `packages/database/src/schema/teams.ts:13-20`. |
| REQ-034 | Partial | A flat team has a manager Slack ID and active members, but no typed Team Lead role: `apps/worker/src/survey/repositories/team.repository.ts:44-69`. |
| REQ-035 | Docs-only | Manager of Managers hierarchy and reporting are explicitly deferred from MVP: `docs/collected-product-requirements.md`. |
| REQ-036 | Implemented | Reports fail closed below five employees and MVP roll-up is disabled: `packages/application/src/use-cases/group-report.use-case.ts:27-35`. |
| REQ-037 | Contradicted | Confirmation resolves the employee's current team, allowing prior-cycle signal to move after transfer: `packages/application/src/use-cases/conversation-orchestrator.ts:427-433`. |
| REQ-038 | Docs-only | HR/HRBP reporting is explicitly deferred: `docs/collected-product-requirements.md`. |
| REQ-039 | Contradicted | The detailed dashboard is built and run as a production service: `apps/dashboard/Dockerfile:16-30`. |
| REQ-040 | Contradicted | The dashboard has no user login or whole-surface environment gate: `apps/dashboard/README.md:20-32`. |
| REQ-041 | Contradicted | Named temporary progress remains available through the production-capable dashboard API: `apps/api/src/admin/pulse-overview.controller.ts:181-227`. |
| REQ-042 | Implemented | Inbound jobs execute the TypeScript orchestrator directly: `apps/worker/src/conversation/conversation.processor.ts:268-301`. |
| REQ-043 | Docs-only | MAF exclusion is an explicit architecture scope decision: `docs/adr/ADR-012-typescript-runtime-product-spine.md:14-19`. |
| REQ-044 | Partial | Reply policy is typed, but consent, reportability, and de-identification remain untyped or prompt-only: `packages/application/src/ports/survey.repository.port.ts:29-60`. |
| REQ-045 | Partial | Quiet-hours and some repository filtering exist, but deterministic suppression is not enforced at every pulse entry point: `packages/application/src/use-cases/proactive-scheduler.use-case.ts:49-73`. |
| REQ-046 | Contradicted | Group reporting can query cross-window rows without tenant scope: `apps/worker/src/survey/repositories/group-state.repository.ts:93-108`. |
| REQ-047 | Partial | Typed tenant retention defaults exist, but evidence, insight, withdrawal, and report lifecycle enforcement is incomplete: `packages/domain/src/tenant/tenant.ts:3-47`. |

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

### Remaining implementation gaps

1. Correction reopens a group but discards `correctionNote`; exclusion has no typed verdict or persisted state.
2. Confirmation generation asks for specific details and has no deterministic de-identification gate.
3. Reporting counts historical rows across windows and can count one employee more than once; it is not scoped by tenant, cycle, or team snapshot.
4. Team membership has no database constraint enforcing one active team, and a transfer can carry old-cycle signal into the new team.
5. No cycle closer, final report, or end-of-cycle temporary-state cleanup exists.
6. The development dashboard is built and deployed as a production service and exposes named employee risk, evidence, and progress through manager-labelled contracts.
7. Trust-led pulse steering and same-index prioritization still depend partly on prompt behavior.
8. Engagement lacks explicit 1-10 persistence and the deterministic final-14-days gate.

### Deferred product scope

- Manager-of-managers hierarchy and roll-up until OQ-001 is resolved.
- HR/HRBP reporting until OQ-002 is resolved.
- The released customer manager/HR surface until OQ-004 is designed.

## Remediation Plan

## Implementation Progress

| Phase | Status | Evidence |
| --- | --- | --- |
| Phase 0 — executable product contract | complete | 47 sequential requirements and traceability rows; BMad blind review patched; contract validation and both diff checks pass |
| Phase 1 — focused baseline tests | complete | One stale assertion corrected; focused tests 38/38 and full application tests 318/318 pass |
| Phase 2 — reportable-insight boundary | in progress | REQ-015 disclosure and REQ-012 exact delivered-summary binding complete; next gap is the typed de-identification acceptance gate |
| Phase 3 — team/cycle cohort scope | queued | — |
| Phase 4 — transfer and cycle lifecycle | queued | — |
| Phase 5 — development dashboard boundary | queued | — |
| Phase 6 — pulse behavior | queued | — |
| Phase 7 — end-to-end verification | queued | — |

### Phase 0 — Make the product contract executable

The canonical requirements and glossary define the six accepted defaults and omitted invariants. `Pulse Index` is the single three-question completion unit. Tenant isolation, opt-out, quiet hours, risk suppression, retention, cutoff timestamps, frozen-roster behavior, final eligibility, and fail-closed reporting have explicit acceptance criteria.

Gate: every implementation story maps to numbered requirements with no contradictory acceptance criteria.

### Phase 1 — Lock the current baseline with focused tests

Correct the stale `topicAnchor` assertion after confirming the intended pause behavior. For each later product gap, add its focused failing test immediately before implementing that gap: persisted disclosure before confirmation, exact-summary confirmation, correction and reconfirmation, exclusion and later withdrawal, versioned de-identification acceptance/rejection, distinct cycle-scoped cohort counting, transfer isolation, dashboard production denial, cycle close, retention enforcement, and numeric engagement persistence. Do not accumulate an intentionally red baseline across unrelated gaps.

Gate: the current application baseline is green; each later test is red only while its corresponding fix is being implemented.

### Phase 2 — Establish one reportable-insight boundary

Reuse `survey_group_states` as the working state unless the migration review proves it cannot represent the lifecycle. Introduce one version field and typed states for working, awaiting confirmation, confirmed, excluded, and expired. Persist the exact summary shown to the employee plus the reporting-disclosure version and display time that authorize confirmation. A correction replaces the candidate, increments its version, and returns it to awaiting confirmation. The same persisted excluded state plus `excludedAt` handles exclusion before confirmation and withdrawal after confirmation. Only a confirmed, non-withdrawn employee-cycle insight with an accepted de-identification decision and policy version may cross the reporting port. Revalidate closed provenance against current withdrawal state immediately before Slack delivery and cancel stale queued snapshots.

Keep AI as a candidate generator. One pure TypeScript policy validates known identifiers and forbidden concrete referents, returns a typed accepted/rejected decision with reasons and policy version, and fails closed before confirmation. TypeScript decides, persists, and audits the transition. Private memory and raw survey evidence never satisfy the reporting port.

Gate: `GroupReportUseCase` cannot be called with raw evidence or an unconfirmed summary at compile time or runtime.

### Phase 3 — Scope cohorts and reports to team plus cycle

Bind each employee survey window to its team membership and cycle at creation. Require tenant ID in every employee-derived job contract and repository port for messages, memory, risk, survey evidence, insights, withdrawals, cohort counts, and reports; adapters reject missing or mismatched scope. Pass tenant/team/cycle scope through the existing group-report queue. Query confirmed, non-withdrawn insights by tenant, team snapshot, cycle, and Pulse Index; count distinct employees exactly once. Persist an immutable privacy-safe manager payload separately from closed audit provenance that records input IDs. Updates require changed input from at least five distinct employees.

Define the anonymity floor and intermediate completion ratio once in a shared reporting-policy function. These are product constants, not environment settings; operators should not be able to weaken privacy by configuration.

Gate: historical windows, another tenant, another team, duplicate employee rows, and transferred employees cannot change the current cohort count; contract and adapter tests prove missing or mismatched tenant scope fails closed for every employee-derived job and repository family; manager payloads contain no input provenance.

### Phase 4 — Implement transfer and cycle lifecycle

Enforce one active employee membership with a partial database unique index. Persist immutable `periodEnd` when the cycle opens. A transfer closes the old team-bound survey window and excludes its insight state from later snapshots without shrinking the old denominator. It starts a new team-bound working window that cannot report in the current cycle and becomes eligible only when the next cycle opens. Add an idempotent cycle-close use case that uses evidence, display, confirmation, correction, and withdrawal timestamps against the persisted cutoff; it emits eligible final reports and expires unconfirmed working state regardless of report success or cohort size.

Enforce the existing effective tenant retention policy with one idempotent lifecycle job. Survey evidence uses `messagesRetentionDays`, permanent employee-cycle insights use `memoryRetentionDays`, and withdrawals plus report snapshots use `auditLogRetentionDays`; working insights expire at the earlier of cycle close or the memory cutoff. Deleted or expired records must not re-enter jobs, cohort counts, or reports. Add new policy fields only if a later approved requirement needs independently configurable durations.

Gate: transfer, cutoff, final eligibility, and retention integration tests pass under retries and reordered jobs; expired or deleted records cannot re-enter queues, cohort counts, or reports.

### Phase 5 — Put the development dashboard behind a real boundary

Keep the current detailed dashboard as an internal product-testing surface. Add one fail-closed environment gate for the whole dashboard and its individual-detail API routes. Rename user-facing labels that imply this is the released manager product. Do not build customer manager/HR authorization until OQ-004 is designed.

Gate: a customer or disabled environment cannot render or fetch named employee state even with a valid tenant parameter.

### Phase 6 — Finish pulse behavior at existing policy seams

Extend the existing `ReplyPlan`, `PulseBacklogService`, and typed AI contracts rather than adding another orchestrator. Require all three explicit integer answers from 1 through 10. Persist them and compute the employee value as their equal-weight arithmetic mean, then compute the team value as the equal-weight mean of eligible employee values; retain full precision and round only displayed values to one decimal. Prioritize completion of one Pulse Index while preserving employee-led topic, risk blocks, opt-out, quiet hours, and skipped-topic rotation.

Gate: deterministic tests cover final-14-days engagement, missing and invalid answers, equal-weight aggregation and display rounding, numeric persistence, same-index completion, reactive topic priority, and skipped-topic behavior.

### Phase 7 — End-to-end verification

Run focused package tests, root typecheck, root unit tests, database integration tests, dashboard build, and `pnpm harness:check -- --base main`. Run model-backed simulations and live Slack checks only after explicit authorization.

Gate: all deterministic checks pass and every active numbered requirement has current code/test evidence or an explicit approved deferral.

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
