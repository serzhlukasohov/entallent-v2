# Glossary

## Active Product Terms

**Employee**
The end user who talks with the mentor in Slack.

**Mentor**
The AI work companion. It is warm and perceptive, but it is not a therapy bot, HR survey form, or formal coaching-session runner.

**Conversation Turn**
One inbound or outbound message in a conversation. Turns carry text, direction, timestamps, trace IDs, and policy metadata.

**Dialogue Act**
The latest employee message's conversational role, such as greeting, acknowledgement, continuation, request, emotional disclosure, correction, or closing.

**Reply Plan**
The typed policy object that tells rendering how to answer this turn: response move, question limit, grounding requirements, forbidden moves, and relevant anchors.

**Pulse Backlog**
A per-employee queue of pulse questions for an active survey window. It controls what evidence territory is next, what was sent, what was ignored, and what is done.

**Probe**
A soft conversational attempt to learn about a pulse question's territory. It should feel like natural conversation, not a survey question.

**Survey Evidence**
A persisted finding that a conversation contains usable signal for a survey question, including polarity, strength, completeness, confidence, and source message IDs.

**Temporary Working Insight**
An automatically extracted, not-yet-final insight from employee conversation. It can support confirmation, but it is not permanent or reportable until the employee confirms the exact displayed version. A correction creates a new working version and requires a new confirmation. Unconfirmed working state expires at cycle close.

**Permanent Employee-Cycle Insight**
A confirmed, de-identified insight for one employee within one pulse-check cycle. It remains internally linked to the employee, team, and cycle, but must not expose names, projects, or concrete events that identify the source.

**Cross-Pollination**
Closing or advancing a pulse question because the employee organically discussed the relevant topic, even without a proactive prompt.

**Question Group**
The implementation field name for a Pulse Index. New product rules and reports use the term Pulse Index.

**Pulse Index**
The product completion and reporting unit: exactly three canonical pulse questions confirmed together. The active indices are autonomy, belonging, growth, purpose, and end-of-cycle engagement.

**Group Confirmation**
The mentor's employee-facing check of the exact displayed, de-identified Pulse Index summary. It can become reportable only after a recorded Reporting Disclosure, employee confirmation, and a non-withdrawn lifecycle state.

**Trust-Led Guided Pulse**
The employee-chat product mode where the mentor has a soft goal to collect pulse signal, but trust and natural conversation outrank completing a backlog topic in the current dialogue.

**Reactive Conversation**
An employee-led conversation. The employee starts the exchange or brings the topic, and the mentor follows that topic rather than steering toward a backlog item.

**Proactive Pulse Conversation**
An agent-initiated conversation scheduled from the pulse backlog. It should include a natural opening, a topic-relevant question, cause-and-effect clarification, and a human-like closing without feeling like an interview.

**Private Memory**
Concrete employee-specific context used only to make future conversations with that same employee more helpful and continuous.

**Reportable Signal**
A confirmed, de-identified, non-withdrawn employee-cycle insight scoped to one tenant, team, cycle, and Pulse Index. It may feed team-level reporting only through the frozen reporting cohort and must not reveal the employee source.

**Confirmation Gate**
The accuracy and reporting-inclusion step after a recorded Reporting Disclosure. The mentor shows the exact de-identified version that would become reportable. The employee can approve, correct, rewrite, or exclude information; every changed version requires a new confirmation.

**Reporting Disclosure**
The versioned onboarding explanation that confirmed, de-identified employee insights may feed team-level recommendations. Its version and display time are persisted before a confirmation can authorize reporting inclusion.

**Team Aggregation**
The stage that combines reportable insights from at least five distinct employees in one frozen tenant/team/cycle cohort into generalized team-level findings. Each employee counts at most once per Pulse Index.

**Organization Hierarchy**
The company structure configured during setup. Active MVP hierarchy records employees, Team Leads, and direct single-team membership. Manager of Managers branches and HR ownership boundaries are deferred.

**Reporting Cohort**
The frozen tenant/team/cycle roster of active, single-team, survey-opted-in employees captured when a cycle opens. Eligibility counts each employee at most once per Pulse Index. Later deletion, opt-out, or transfer excludes that employee's data without shrinking the denominator.

**Employee Role**
An individual contributor with no subordinates in the configured organization hierarchy.

**Team Lead Role**
A manager with direct employee subordinates. A Team Lead report can only be generated when the direct team satisfies the anonymity floor.

**Manager of Managers Role**
A future role for a manager whose hierarchy includes multiple Team Leads. Its reporting and inference-risk policy are deferred from the active MVP scope.

**Cohort Roll-Up**
A future privacy-preserving aggregation across lower-level teams. It is disabled for MVP; too-small teams fail closed and produce no manager-visible report.

**Development Dashboard**
The current internal product-testing surface used by the development/product team to inspect insight collection and confirmation. It is not a released manager/HR customer surface.

**Intermediate Report**
An immutable team-level Report Snapshot for one Pulse Index generated before cycle close once `max(5, ceil(0.8 × eligibleRosterSize))` distinct roster members have confirmed all three questions. A later visible version requires changed reportable input from at least five distinct employees.

**Final Report**
One team-level cycle Report Snapshot generated after the immutable Cycle Cutoff. It includes only Pulse Indices with at least five distinct eligible employees; the intermediate 80% threshold does not apply. No report is generated when every index is ineligible. Temporary-state cleanup occurs even when no final report is eligible or delivery fails.

**Cycle Cutoff**
The immutable UTC `periodEnd` instant persisted when a cycle opens. Evidence, displayed candidate, confirmation, and any corrected version must all occur inside `[periodStart, periodEnd)` to enter that cycle. A withdrawal applies to snapshots generated or delivered after its persisted time. Later job execution cannot move data across the cutoff.

**Report Snapshot**
An immutable, versioned record of one eligible manager-visible report, its scope, policy version, and privacy-safe payload. Closed audit provenance records the included reportable-input IDs separately and is never part of the manager-visible payload. A queued snapshot is revalidated against withdrawals before delivery; publishing a later snapshot never rewrites an already delivered Slack report.

**Anonymity Floor**
The minimum privacy threshold for manager-visible reporting. Reports and recommendations require at least five distinct employees from the frozen cohort and must remove or generalize identifying details.

**Team-Level Recommendation**
A recommendation addressed to team conditions, processes, communication, workload, expectations, or environment. It must not target a named or inferable employee.

**Open Loop**
Any future-oriented topic the mentor might return to later, including explicit reminders, follow-ups, parked threads, commitments, and goals.

**Reminder**
An explicit employee-requested future ping, such as "remind me tomorrow." It should not be inferred from vague intent.

**Follow-Up**
A future proactive message related to a prior conversation thread. Unlike reminders, follow-ups need a clear consent and policy story before they can be treated as mentor-owned loops.

**Memory Item**
A durable fact or context item about the employee, such as role, project context, stressor, preference, commitment, milestone, or support preference.

**Manager Insight**
Dashboard-visible information derived from employee conversations and survey evidence. It must respect cohort safety, tenant scoping, and identifiable-data boundaries.

**TS Runtime Spine**
The current active product path through TypeScript application code, repositories, queues, prompts, and dashboard/admin contracts.
