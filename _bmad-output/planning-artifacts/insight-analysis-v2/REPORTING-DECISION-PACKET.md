# Insight Analysis V2 reporting decisions — proposed, not approved

Date: 2026-10-03. Scope: complete the V2 report consumer without routing V2 insights through the V1 group-state average. This document requests Product decisions; it does not activate reporting or scoring.

## Already binding

- Scoring Policy 1.0.0 approves twelve question rubrics and reviewed examples. Each confirmed question has an integer score from 0 to 100. Missing, declined, or insufficient evidence has no score.
- IA-019–020 permit an employee-level Index only with three confirmed scored questions and forbid a synthetic score for one or two questions. IA-044–047 allow all confirmed question-level inputs at final cutoff, but intermediate inputs require 3/3.
- REQ-024, REQ-028, and REQ-029 require a frozen direct-team roster, at least five distinct contributors, `max(5, ceil(0.8 * roster))` complete contributors for an intermediate Index, and at least five eligible contributors for a final Index. Existing snapshot delivery rules prevent duplicate or ambiguous Slack sends. Manager of Managers roll-up is disabled for MVP.
- The current V2 selector returns only finalized, de-identified question inputs and trends. The mounted report consumer still reads V1 group states; a V2 cohort is quarantined from that path.

## Verified implementation boundary

- `SelectQuestionInsightInputsUseCase` selects one employee's three required questions within a V2 window. It does not aggregate a frozen team roster or produce a manager report.
- `SurveyRepository.findReportingCohortsReadyForFinalReports` excludes V2-bound cycles, so the current cycle-close job schedules only V1 final reports. A V2 final report needs its own enqueue path and consumer.
- `GroupReportProcessor` and `GroupReportSnapshotRepository` currently send and snapshot V1 group-state results. The V2 consumer must use finalized question inputs and preserve the existing target recheck, immutable snapshot, and `delivery_unknown` safeguards.

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
