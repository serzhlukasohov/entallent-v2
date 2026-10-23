# Pulse Check Reports — Product Requirements

Status: approved product decisions; intended behavior, not implementation evidence.

## Purpose

Reports help a Team Lead or Manager understand the current condition of their team, what specifically is causing difficulty or supporting a good experience, and what they can do about it. Scores orient the reader to condition and change. Scores alone do not diagnose a cause, establish causality, or prescribe an action.

### RPT-PR-001 — Four audience-specific reports

Provide intermediate reports separately for Autonomy, Growth, Purpose, and Belonging & Psychological Safety, and one final Engagement report per cycle, for both Team Lead and Manager. The persisted group alias `belonging` may remain an implementation detail. Intermediate reports concern only their triggering Index; final reports give a consolidated Engagement analysis rather than four independent Index summaries.

### RPT-PR-002 — Safe reporting source

Reporting consumes only finalized, confirmed, privacy-accepted, de-identified analytical insights, valid scores where available, and restricted metadata needed for eligibility and lifecycle. It must not read original conversations, private semantic summaries, or temporary working insight content. Organizational audiences do not see individual employee answers, scores, quotations, evidence, or inferable individual recommendations.

### RPT-PR-003 — Condition and cause

Before requesting confirmation, the conversation workflow must understand the employee's condition/opinion and its root cause. An explicit refusal to explain the cause is an approved exception: a sufficiently understood condition may proceed to confirmation, with the cause left unknown. Silence is neither refusal nor confirmation. A missing cause must not be invented. Confirmation, rubric scoring before de-identification, privacy validation, and permanent persistence remain separate mandatory stages. A revised statement requires shown-and-confirmed proof under the current Insight Analysis contract.

### RPT-PR-004 — Meaningful team signals

Group eligible insights by meaningful common causes, retaining their relationship to conditions. Different causes and opposing experiences must not disappear into an average or an unsupported claim about the whole team. Explain the most material supported problems and positive drivers concisely. Do not turn an isolated experience into a universal team claim or reveal its source.

### RPT-PR-005 — Main Focus is a problem

Where a report includes Main Focus, it answers “what specifically needs attention now?” It may combine themes from several Indices. Prioritize confirmed impact on work and employee experience and severity of consequences; use reach and dynamics as additional context. Do not mechanically choose the lowest Index, rank by frequency alone, or derive a cause from a score. No issue must be manufactured when conditions are healthy or evidence does not support a problem.

### RPT-PR-006 — Actionable recommendations

Each report-level or eligible team-level recommendation set contains zero to three prioritized, distinct action items. Fewer than three is valid; none is valid when there is no supported action, including a healthy team. Each action must follow from allowed insight content and fall within the recipient's authority or direct influence. Do not add generic advice to fill slots. Reflect latest confirmed conditions and avoid repeating an obsolete remedy for a resolved problem. A supported successful practice may be maintained without inventing a problem.

### RPT-PR-007 — Team Lead intermediate value

Show the triggering Index, cycle/period, categorical state, dynamics, a brief concrete explanation, and up to three Team Lead actions. Hide the numeric Index score. Clearly identify results and recommendations as preliminary and state that final reporting occurs on the last working day of the cycle.

### RPT-PR-008 — Team Lead final value

Show numeric Engagement, its dynamics, one consolidated explanation of supported Engagement drivers, concrete Main Focus, and up to three prioritized Team Lead actions. Use the open-ended Indices diagnostically; do not display their separate numeric scores. Do not mechanically allocate one action per Index or repeat every intermediate finding.

### RPT-PR-009 — Manager overall scope

The Manager's overall scope includes each Team Lead and each employee in their subordinate teams once, with equal person weight. A Team Lead contributes their own work experience, not an extra vote for the team. Employees of small teams may contribute to the overall result even when their team cannot be displayed separately. Do not calculate the overall metric as an unweighted mean of team metrics.

### RPT-PR-010 — Manager team-management section

Both Manager reports have a second section describing conditions in each subordinate team and how the Manager can influence improvement through its Team Lead. This section uses the subordinate employees' insights, excluding that team's Team Lead's own responses. Give concise problems/causes and zero to three specific actions to discuss or agree with the Team Lead. This is a management aid, not a personal competence rating of the Team Lead.

### RPT-PR-011 — Manager intermediate value

Overall: show the triggering Index numerically on 0–100, dynamics, concise causes, and up to three Manager actions. Teams: show eligible teams' scores and dynamics for the same Index, concise causes/problems, and up to three actions through each Team Lead. Do not include other Index metrics or Engagement as additional intermediate metrics. Both sections are preliminary.

### RPT-PR-012 — Manager final value

Overall: show numeric Engagement, dynamics, a consolidated explanation from employee and Team Lead insights, concrete Main Focus, and up to three Manager actions. Teams: show eligible team Engagement and dynamics, supported concrete focus/causes, and up to three actions through its Team Lead. Use open-ended Indices qualitatively without separate numeric scores. Overall priorities must not be a duplicate list of all team actions. Lack of an eligible team breakdown does not block an eligible overall final.

### RPT-PR-013 — Intermediate participation and one-time release

Release each intermediate Index automatically on first reaching 80% of the applicable cycle participant roster and at least five people with all three confirmed valid scores. Team Lead uses the direct-team roster; Manager uses the overall roster including Team Leads. Publish each Index intermediate once per audience scope and cycle. Do not append late responses or publish routine revisions; eligible later inputs are considered in final.

### RPT-PR-014 — Final timing and participation

Deliver final reports for both roles at the end of the last working day within the Pulse Check cycle, using the company's work calendar and timezone. A weekend end normally means Friday delivery; configured non-working holidays must be respected too. Freeze report-data cutoff at the start of final formation. Count every eligible participant with all three valid quantitative Engagement answers received before that cutoff, not a five-person sample. Require at least five; neither 80% nor complete team participation is required.

### RPT-PR-015 — Timely inputs survive processing delays

Eligibility depends on durable arrival/confirmation events before report cutoff, not execution order or queue latency. Finish processing timely eligible inputs before final assembly; reporting still reads only permanent de-identified results. Later answers or confirmations do not enter this final. A technical failure must not be mislabeled insufficient participation or silently create a known incomplete final. Retry with the same cutoff and delivery safeguards.

### RPT-PR-016 — Departures and transfers

Freeze participant affiliation at cycle opening. Departure, deactivation, or transfer stops further collection for the original team but preserves already confirmed, otherwise eligible insights in that original reporting scope for the current cycle. Keep the participant in that cycle's denominator. Do not copy their old-team insights into a new team's reporting. They are absent from the old team's next-cycle roster. This is distinct from consent withdrawal and is not authorization to retain data against a deletion request.

### RPT-PR-017 — Full and partial withdrawal

A full reporting-permission withdrawal excludes the person's inputs from future deliveries and removes that person from the participation denominator for not-yet-published intermediate reports. Partial withdrawal excludes the specified topic/insight only and leaves the person in the denominator. Loss of a required score removes their complete numeric Index contribution. Other allowed finalized insights may still support final qualitative analysis. Already delivered reports are immutable; never reconstruct withdrawn content through old versions or replacement summaries.

### RPT-PR-018 — Partial and unscored final insights

Final qualitative analysis may use finalized confirmed topics from incomplete Indices, including those of employees without complete quantitative Engagement. A confirmed privacy-accepted `insufficient_evidence` insight without a score may contribute qualitatively when meaningful supported conditions/causes remain. None of these inputs creates a synthetic partial employee Index or numeric missing-data penalty. A safe fallback with no concrete cause cannot justify inventing a recommendation or retrieving private source text.

### RPT-PR-019 — Per-team disclosure floor

Manager intermediate team sections need at least five subordinate employees with complete scored responses for that Index. Manager final team sections need at least five subordinate employees with complete quantitative Engagement. Exclude the Team Lead from those five; do not require an additional team-level 80%. Below the floor, retain the team label and show only localized “Insufficient data,” without a metric, causes, or targeted actions. Its allowed data can still feed overall metrics.

### RPT-PR-020 — Scores and dynamics

Open-ended employee Index = equal-weight arithmetic mean of three valid confirmed rubric scores 0–100; aggregate complete employee Indices with equal person weight. Quantitative Engagement = equal-weight mean of three explicit integer answers 1–10, then equal-person mean. Retain precision through aggregation; round visible numbers to one decimal. Compare with the same metric's final value from the previous completed valid cycle in the same scope. Positive/zero/negative unrounded delta means Improving/Stable/Declining. Missing or incompatible baseline means Baseline established; incompatible scoring policies require compatible rescoring or a new baseline. Employee composition changes retain history with a composition caveat.

### RPT-PR-021 — Language and readable Slack delivery

Deliver privately in Slack using the approved native Block Kit visual hierarchy. All report text, notices, headings, explanations, and actions use the configured company language, default English; personal chat language does not override it. The company language is configurable during admin setup. Personal agent conversations for any role follow the user's comfortable language, without an English-only product restriction. Admin UI and canonical app-generated human-readable stored records use company language as a cross-cutting dependency. Technical identifiers and original employee messages are not silently translated in place.

### RPT-PR-022 — Honest insufficient-data outcome

If fewer than five eligible complete Engagement respondents exist in the overall scope at final cutoff, deliver a localized insufficient-data notice on the final date instead of numeric or narrative final results. Do not show response counts or infer team condition. An eligible Manager overall final still ships if some or all teams lack an individually displayable result. Technical processing failure and insufficient participation are different outcomes.

### RPT-PR-023 — Privacy scope for MVP

Retain de-identification, team signals, minimum participant floors, tenant isolation, no identifiable individual reporting, consent enforcement, and delivery target validation. A new algorithm comparing reports or subtracting overall/team metrics to detect inference is explicitly deferred. Do not require five changed contributors before a product final as an implicit extra participation rule. This decision does not claim inference is impossible and does not weaken the input privacy gate.

### RPT-PR-024 — Immutable, controlled delivery

Persist versioned content, provenance, cutoff, scope, language, and intended recipient before delivery. Prevent duplicate sends and revalidate current authorization/withdrawals and the frozen delivery binding before send. Do not silently retarget a snapshot. Ambiguous provider delivery requires explicit reconciliation before resending the same report. Technical recovery must not rewrite published results or turn a final into routine versioned updates. Access to company setup/admin functions alone does not authorize report access.
