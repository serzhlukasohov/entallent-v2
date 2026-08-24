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
An automatically extracted, not-yet-final insight from employee conversation. It can support confirmation, but it is not permanent and is not reportable until the employee confirms or corrects it. It can live until the end of the pulse-check cycle, then should be cleared if still unconfirmed.

**Permanent Employee-Cycle Insight**
A confirmed and anonymized insight for one employee within one pulse-check cycle. It can feed team aggregation, but must not expose names, projects, or concrete events that identify the source.

**Cross-Pollination**
Closing or advancing a pulse question because the employee organically discussed the relevant topic, even without a proactive prompt.

**Question Group**
A pulse theme grouping, currently autonomy, belonging, growth, purpose, and engagement.

**Group Confirmation**
The mentor's employee-facing check that its understanding of a question group is accurate before that group becomes confirmed and can feed reporting.

**Trust-Led Guided Pulse**
The employee-chat product mode where the mentor has a soft goal to collect pulse signal, but trust and natural conversation outrank completing a backlog topic in the current dialogue.

**Reactive Conversation**
An employee-led conversation. The employee starts the exchange or brings the topic, and the mentor follows that topic rather than steering toward a backlog item.

**Proactive Pulse Conversation**
An agent-initiated conversation scheduled from the pulse backlog. It should include a natural opening, a topic-relevant question, cause-and-effect clarification, and a human-like closing without feeling like an interview.

**Private Memory**
Concrete employee-specific context used only to make future conversations with that same employee more helpful and continuous.

**Reportable Signal**
An anonymized, confirmed, and generalized signal that may feed team-level reporting. It must not contain details that reveal the employee source.

**Confirmation Gate**
The consent and accuracy step where the mentor asks whether it understood a question group correctly. The message should be sufficient, natural, and generalized rather than a detailed dossier. The employee can approve, correct, rewrite, or exclude information before it becomes a permanent employee-cycle insight.

**Team Aggregation**
The stage that combines at least five permanent employee-cycle insights into generalized team-level findings.

**Organization Hierarchy**
The company structure configured during setup: who is an employee, who leads whom, which managers own which teams, and which HR roles support which parts of the organization.

**Reporting Cohort**
The group of employees whose confirmed insights can be aggregated into a report for a specific audience. It must satisfy the anonymity floor.

**Employee Role**
An individual contributor with no subordinates in the configured organization hierarchy.

**Team Lead Role**
A manager with direct employee subordinates. A Team Lead report can only be generated when the direct team satisfies the anonymity floor.

**Manager of Managers Role**
A manager whose hierarchy includes multiple team leads. This role can receive rolled-up reporting across eligible lower-level teams/subteams.

**Cohort Roll-Up**
The privacy-preserving fallback where a too-small team does not receive its own report and its data can instead contribute to a larger eligible manager-level cohort.

**Development Dashboard**
The current internal product-testing surface used by the development/product team to inspect insight collection and confirmation. It is not a released manager/HR customer surface.

**Intermediate Report**
A team-level report for one index generated before the pulse-check cycle ends, once at least 80% of the team and at least five employees have confirmed all required questions for that index.

**Final Report**
The end-of-cycle team-level report generated from all confirmed permanent employee-cycle insights available by the close of the pulse-check cycle.

**Anonymity Floor**
The minimum privacy threshold for manager-visible reporting. Reports and recommendations require at least five employees and must remove or generalize identifying details.

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
