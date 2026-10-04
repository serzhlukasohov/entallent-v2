# Insight Analysis V2 reporting decisions — proposed, not approved

Date: 2026-10-04. Scope: approve the V2 report rules for one five-person test cohort. The V2 consumer is deployed, but this document does not activate reporting or scoring.

## Already binding

- Scoring Policy 1.0.0 approves twelve question rubrics and reviewed examples. Each confirmed question has an integer score from 0 to 100. Missing, declined, or insufficient evidence has no score.
- IA-019–020 permit an employee-level Index only with three confirmed scored questions and forbid a synthetic score for one or two questions. IA-044–047 allow all confirmed question-level inputs at final cutoff, but intermediate inputs require 3/3.
- REQ-024, REQ-028, and REQ-029 require a frozen direct-team roster, at least five distinct contributors, `max(5, ceil(0.8 * roster))` complete contributors for an intermediate Index, and at least five eligible contributors for a final Index. Existing snapshot delivery rules prevent duplicate or ambiguous Slack sends. Manager of Managers roll-up is disabled for MVP.
- The V2 selector returns only finalized, de-identified question inputs. The V2 consumer uses its own snapshot path; V2 cohorts remain quarantined from the V1 group-state report path.

## Verified implementation boundary

- `SelectQuestionInsightInputsUseCase` selects one employee's three required questions within a V2 window. The separate V2 cohort selector and report builder aggregate eligible frozen-roster inputs.
- `SurveyRepository.findReportingCohortsReadyForFinalReports` excludes V2-bound cycles. V2 intermediate and final jobs use a tenant-scoped manual enqueue script; the V1 cycle-close job does not schedule them.
- `V2ReportProcessor` consumes finalized question inputs with its own snapshots, target recheck, immutable first delivery, and `delivery_unknown` safeguards. Its approval constant remains `null`, so manager delivery is disabled.

## Decisions needed before a V2 manager report

| Decision | Proposed MVP rule for approval | Alternative requiring an explicit rule |
| --- | --- | --- |
| Complete employee Index | Arithmetic mean of the three required question scores, with each question weighted equally. Keep the unrounded value for aggregation. | Specify weights, transform, and handling of outliers. The current SPEC explicitly does not approve equal weights by default. |
| Final report with partial responses | Aggregate each question independently from confirmed scored insights; omit any question with fewer than five distinct contributors. Do not compute an Index from a partial employee response. Aggregate complete employee indices separately when at least five contributors qualify. | Specify another partial-coverage aggregation formula and privacy threshold. |
| Precision | Compute aggregates from raw integer question scores; round only display values to one decimal, using the established report format. Persist calculation and policy versions. | Specify internal precision and display rounding. |
| Engagement | Keep Engagement on its separate existing numeric contract; do not mix it into the twelve open-ended questions or convert its scale implicitly. | Approve a new scale and explicit relationship to V2 reports. |
| Scope and trends | Direct team only. Do not show a report-level trend when frozen roster composition or scoring policy changes; retain safe question-level baselines for future analysis. | Specify a composition-adjusted trend and inference-risk rule. |
| Recommendations | Use only de-identified, threshold-eligible team-level inputs. Validate generated recommendations against individual identification and suppress unsafe content. | Specify another generation and evaluation contract. |
| Snapshot overlap | Reuse the implemented first-snapshot and `delivery_unknown` rules. For later versions, implement REQ-028's five-changed-contributor rule and suppress any version that could reveal a smaller delta. | Specify a stronger overlap policy. |
| Calibration acceptance | First approve any supplemental draft fixtures. Run repeated model probes on the approved set, publish observed score deltas and invalid-output counts, then approve a numeric tolerance and monotonicity rule before activation. Current 14/14 prompted-reference matches and 12/12 ordered synthetic pairs are diagnostic, not an acceptance threshold. | Specify the numerical tolerance now, with its fixture set and required pass rate. |

## Minimum acceptance fixtures after approval

1. Intermediate: 3/3 scores for the required frozen-roster count create one immutable snapshot; 1/3 or 2/3, under-threshold, withdrawn, or changed-target cases send nothing.
2. Final: question-level 1/3 and 2/3 inputs can contribute only to eligible per-question aggregates; no partial employee Index is synthesized. A 0/3 employee contributes nothing.
3. Complete Index: three question scores produce the approved employee score and a team aggregate only above the anonymity floor. Mixed policy versions fail closed.
4. Retries, overlapping snapshots, and `delivery_unknown` cannot resend or reveal a small contributor delta.
5. Real model calibration, de-identification, and deployed Slack/role checks pass against the approved thresholds before production activation.

IA-043 employee export/deletion/self-review remains under its separately deferred privacy contract in `IA-043-EMPLOYEE-RIGHTS-DECISION.md`.

## Test-tenant pilot decision ready for owner approval

Decision ID: `v2-report-pilot-2026-10-04`. Status: **pending approval**. Scope: the five-person `Test AI Agent` QA cohort and its active manager only. This decision does not authorize a wider tenant rollout.

- Calculate a complete employee Index as the arithmetic mean of its three confirmed integer question scores, retaining full precision until display. The team Index is the arithmetic mean of complete employee indices. Display one decimal; never create an employee Index from one or two scores.
- For a final report, calculate each question mean independently from confirmed scored insights with at least five distinct contributors. A question below five is omitted. A final cycle message requires all four Index groups to have an eligible report; otherwise the entire message is suppressed. No report-level trend or numeric Engagement conversion is included.
- Manager text contains only Index or question aggregates, contributor counts, and a fixed team-level discussion action. It contains no employee names, quotes, de-identified summaries, individual scores, or generated recommendation text.
- The first intermediate snapshot is immutable. A final message is suppressed if any prior Index delivery is unresolved or if an Index changed for only one to four contributors. A changed Index requires at least five changed contributors. A completed enqueue job can be retried, while the database snapshot prevents duplicate delivery.
- The recipient must remain an active hierarchy manager assigned to an active unit, with a linked account in the same tenant and Slack workspace; the configured team DM must resolve to that account immediately before delivery. V2 provenance follows the existing report audit retention cutoff.
- Before activation, run the approved 14 reference examples three times on the deployed model configuration. Every output must be contract-valid, each scored result within 10 points of its approved reference, every insufficient-evidence example unscored, and all 12 synthetic low/high pairs correctly ordered. Require no privacy failure in the consent, withdrawal, threshold, target-change, and ambiguous-delivery fixtures. Prior diagnostic runs reportedly met the numerical conditions; repeat and record the results for this decision ID before activation.

Approval changes `V2_REPORT_APPROVED_DECISION_ID` from `null` to this ID in reviewed source and permits the tenant-scoped environment gate. Until then, code cannot send a V2 manager report even if the environment variables are set.

### Production branch-trial evidence, 2026-10-04

PR #7 commit `1359a13` passed both CI jobs. With explicit trial authorization, migrations `0047`–`0050` were applied to `reasonable-adaptation` / `production`: the migration journal advanced from 47 to 51, `survey_v2_report_snapshots` exists, and the question-insight table remained empty. Manual releases of `api` (`477750ad`), `worker` (`8609ee63`), and `dashboard` (`1778b9bf`) from that checkout were `SUCCESS` and `RUNNING`. API health returned `ok`, dashboard `/trends` returned HTTP 200, and filtered deployment error logs had zero rows.

After named production PostgreSQL and Redis preflight, the deployed worker model configuration produced 14/14 exact approved reference scores in each of three runs (42/42 total), with the insufficient-evidence example unscored in each run. The 12 synthetic low/high pairs were correctly ordered (12/12). The full synthetic model bridge passed Bundle composition, partial consent, clarification, source boundary, and direct-identifier privacy cases. The deterministic harness and CI covered withdrawal, threshold, target-change, and ambiguous-delivery fixtures. These are synthetic checks; they do not establish live Slack acceptance or approve this pending decision.

A repeat read-only tenant check found one inactive `v2-policy-1.0.0` definition with 12 questions, no unfinished windows, cycle policies, or reporting cohorts, and a QA team with five active, survey-consented, linked members. The configured DM `D0C5MUFTDG8` resolved through the worker's encrypted workspace connection to Slack user `U0C4VG5PK09`, the tenant's active hierarchy manager account. No Slack message was sent in this check.
