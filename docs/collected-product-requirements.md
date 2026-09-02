# Collected Product Requirements

Date: 2026-08-31

Scope: current TypeScript product. MAF is out of scope.

## 1. Product Positioning

### REQ-001: Multi-Persona Product

enTalent must support at least two primary MVP personas:

- Employee: uses the agent in a private Slack conversation.
- Manager/HR: receives team-level reports and recommendations.

The employee experience and manager/HR experience are separate product surfaces with different privacy rules.

### REQ-002: Employee Experience Promise

For employees, the agent must feel primarily like a trusted friend at work: someone who listens, understands, supports, and helps the employee understand themselves in work situations.

The agent may behave as a mentor, coach, or emotional support companion, but it must not feel like an HR questionnaire, survey bot, or formal coaching-session runner.

### REQ-003: Manager/HR Experience Promise

For managers and HR, the product must provide an honest team-level picture and useful recommendations for improving team management.

Recommendations must help managers improve team conditions, communication, workload, expectations, motivation, engagement, belonging, autonomy, growth, and purpose.

## 2. Employee Conversation Modes

### REQ-004: Trust-Led Guided Pulse

The employee-chat product mode is trust-led guided pulse.

The agent has a soft product goal to collect pulse signal, but employee trust outranks completing a specific backlog topic in the current dialogue.

### REQ-005: Reactive Conversation

When an employee starts a conversation or brings a topic that does not match the pulse backlog, the agent must follow the employee's topic.

Reactive conversation must be human-like and supportive. The agent may ask clarifying questions, help uncover cause-and-effect relationships, and close naturally.

Pulse evidence may emerge during reactive conversation, but it must not drive or override the employee-led conversation.

### REQ-006: Proactive Pulse Conversation

When the agent starts a conversation on schedule from the pulse backlog, the conversation must have a flexible human shape:

1. Natural opening.
2. Contextual small talk when appropriate.
3. A natural question about the selected backlog topic.
4. Clarifying questions to understand status and cause/effect.
5. Human-like closing.

The agent must not ask the backlog topic word-for-word if that would feel unnatural.

### REQ-007: Skipped Backlog Topic Handling

If an employee answers briefly, avoids a backlog topic, changes subject, or appears unwilling to develop the topic, the agent must not push the same backlog topic again in the same dialogue.

The agent should follow the employee's topic or move on. The skipped backlog topic may return later, after other backlog topics have been attempted.

## 3. Pulse Backlog And Cycle

### REQ-008: MVP Pulse Themes

The MVP pulse check covers twelve topics across four regular groups:

- Autonomy.
- Belonging.
- Growth.
- Purpose.

Engagement questions may be handled as a separate end-of-cycle group.

### REQ-009: Pulse Cycle

The current pulse-check cycle is one quarter.

Temporary working insights may live until the end of the pulse-check cycle. Unconfirmed temporary working insights must be cleared after the cycle ends and final reports are generated.

### REQ-010: Group Completion Before Confirmation

After the agent has collected enough status and cause/effect understanding for all required questions in one question group or index, it should ask the employee for confirmation in the same natural dialogue.

## 4. Insight Pipeline

### REQ-011: Temporary Working Insights

The system may automatically extract temporary working insights while the employee and mentor talk.

Temporary working insights are not permanent and are not reportable until the employee confirms or corrects them.

### REQ-012: Confirmation Gate

Before an insight can become permanent and feed reporting, the agent must confirm with the employee that it understood the employee correctly.

The employee may:

- Confirm the summary.
- Correct the summary.
- Rewrite the summary.
- Exclude some or all information from reporting.

### REQ-013: Confirmation Message Style

The confirmation message must be sufficient for future report generation but must not feel like a dossier about the employee.

It must avoid names, project names, concrete events, and specific situations that could identify the employee or other people. It should express the employee's status and root cause in generalized language.

### REQ-014: Confirmation UX

Confirmation should be a normal free-text conversation, not a button-based UI.

The agent should ask a natural version of "did I understand you correctly?" and wait for the employee's response.

### REQ-015: Reporting Explanation

The employee should learn during onboarding that anonymized team-level information may feed manager/HR recommendations.

The agent should not repeat this explanation during every confirmation. It should explain where the information goes only if the employee asks.

### REQ-016: Permanent Employee-Cycle Insights

After employee confirmation, the temporary working insight becomes a permanent anonymized employee-cycle insight for that employee and pulse cycle.

This record is still internally associated with the employee and cycle, but must be stripped of directly identifying details before it can feed team aggregation.

### REQ-017: Correction Handling

If the employee corrects a confirmation summary, the corrected version replaces the old working version for product and reporting purposes.

The confirmed corrected content becomes the permanent employee-cycle insight.

### REQ-018: Unconfirmed Insight Handling

Unconfirmed temporary working insights must not feed intermediate reports or final reports.

They may remain available to the employee conversation context until the end of the pulse-check cycle. Useful private-memory facts may remain in memory for future employee conversations, but they remain non-reportable.

## 5. Memory And Reportability

### REQ-019: Private Memory

The agent may store concrete details in private memory to make future conversations with the same employee more helpful and continuous.

Private memory may include important past events, work context, stressors, preferences, goals, commitments, or similar employee-specific context.

### REQ-020: Private Memory Is Not Reportable Signal

Private memory must not directly feed manager/HR reports.

Only confirmed, anonymized, permanent employee-cycle insights may feed team aggregation and reporting.

### REQ-021: Employee Exclusion Request

An employee must be able to tell the agent not to use specific information for reports.

This can happen during confirmation or during ordinary conversation. Excluded information must not become reportable.

## 6. Privacy And Manager Visibility

### REQ-022: No Individual Manager Visibility

Managers must never see a named employee's specific state, risk, evidence, answer, insight, or recommendation.

### REQ-023: No Individual Recommendations

Managers must never receive recommendations about a specific named or inferable employee.

Recommendations must be addressed to the team, environment, process, communication pattern, workload, expectations, or management practices.

### REQ-024: Anonymity Floor

A manager-visible report or recommendation must be based on at least five employees.

### REQ-025: De-Identification Beyond Name Removal

Removing names is not enough. Any event, project, situation, or detail that lets a manager infer the employee source must be generalized or suppressed.

### REQ-026: Manager/HR Exclusion From Temporary State

Managers and HR must not see:

- Temporary working insight content.
- Pending-confirmation counts.
- Employee-level progress hints.
- Signals that reveal who has answered what or when a report may become available.

## 7. Reporting

### REQ-027: Team-Level Aggregation

Reports must be generated from team-level generalized data, not raw employee conversation details.

Team aggregation may occur only after at least five employees in the reporting cohort have confirmed permanent employee-cycle insights.

### REQ-028: Intermediate Reports

An intermediate report may be generated for a specific index when:

- At least 80% of the team has confirmed all three questions in that index.
- At least five employees are included.
- All included insights have passed confirmation.

Intermediate reports are index-specific and may be updated later as more employees complete the same index.

### REQ-029: Final Reports

A final report is generated at the end of the pulse-check cycle.

It must include all confirmed permanent employee-cycle insights available by cycle close. Unconfirmed temporary working insights must remain excluded.

### REQ-030: Team-Level Recommendations

Reports should include practical team-level recommendations that help managers improve the team's working conditions.

Recommendations must not identify, isolate, or imply a specific employee source.

## 8. Organization Hierarchy And Reporting Cohorts

### REQ-031: Company Hierarchy Setup

During company setup, the product must capture the organization hierarchy manually or through automation.

The hierarchy must define:

- Employees.
- Team Leads.
- Managers of Managers.
- HR ownership boundaries.
- Which employee belongs to which team and hierarchy branch.

### REQ-032: MVP Single-Team Membership

For MVP, each employee belongs to exactly one team and one branch of the organization hierarchy.

Multi-team and project-team membership are out of scope for MVP.

### REQ-033: Employee Role

An Employee is an individual contributor with no subordinates in the configured hierarchy.

### REQ-034: Team Lead Role

A Team Lead is a manager with direct employee subordinates.

A Team Lead may receive a report only if the direct team satisfies the anonymity floor.

### REQ-035: Manager of Managers Role

A Manager of Managers is a manager whose hierarchy includes multiple Team Leads.

This role may receive rolled-up reporting across eligible lower-level teams and subteams.

### REQ-036: Small-Team Roll-Up

If a Team Lead has fewer than five employees, no report is generated for that Team Lead.

The team's confirmed insights may roll up to the next eligible manager-level cohort, where they are mixed with other teams and generalized.

### REQ-037: Team Transfer During Pulse Cycle

If an employee changes teams in the middle of a pulse-check cycle, the previous team's insights should not move into the new team's reporting context.

The pulse check should restart for the employee in the new team because prior answers likely describe a different manager/team environment.

### REQ-038: HR/HRBP Reporting Deferred

HR and HRBP reporting rules are deferred until Team Lead and Manager of Managers reporting is modeled.

## 9. Development Dashboard

### REQ-039: Development-Only Dashboard

The current dashboard is a development/product testing dashboard.

It exists so the product team can inspect how insights are collected, confirmed, and promoted through the pipeline.

### REQ-040: Not Customer-Facing

The current dashboard must not be treated as the released manager/HR customer surface.

For real customer environments, it should be hidden, likely through a feature toggle or equivalent environment gate.

### REQ-041: Development Visibility

In dev/testing contexts, the product team may inspect temporary working insights and confirmation progress to validate the product behavior.

This visibility is not available to managers, HR, or customers in the released product.

## 10. Current Technical/Product Alignment Requirements

### REQ-042: TypeScript Runtime Is Active Product Spine

The current product direction treats the TypeScript runtime as the active product spine.

Inbound Slack messages, response planning, rendering, persistence, queues, prompts, and dashboard/admin contracts should be judged against the TypeScript flow.

### REQ-043: MAF Out Of Scope

MAF-specific code, scripts, docs, and cleanup are out of scope for this requirements pass unless a separate task explicitly reopens them.

### REQ-044: Product Policy Should Not Live Only In Prompts

Stable product decisions should be represented in docs, typed contracts, policy modules, and tests, not only in prompt prose.

Prompt text may render product behavior, but should not be the only place where privacy, consent, pulse cadence, or reportability rules are defined.

## 11. Open Questions

### OQ-001: Manager of Managers Inference Risk

If a small team rolls up to a Manager of Managers, the manager may still infer which Team Lead or small team caused a negative signal.

Open questions:

1. Can Manager of Managers reports show breakdowns by subteam?
2. Should Manager of Managers reports be roll-up only, without subteam breakdown?
3. If one subteam is large and another is small, can the large subteam be shown separately while the small one remains only inside roll-up?
4. Can reports show "top affected area" without naming the team?
5. Should there be a suppression rule when a recommendation effectively points to a specific Team Lead or small group?

Current hypothesis to test:

> For MVP, Manager of Managers reports should be roll-up only, without subteam breakdown, unless every displayed subteam independently satisfies the anonymity floor and passes an inference-risk check.

### OQ-002: HR And HRBP Reporting

HR and HRBP report visibility, scope, and access rules still need a separate grill session.

### OQ-003: Data Model Mapping

The current database model needs to be mapped against the required pipeline:

- Temporary working insight.
- Confirmation pending.
- Confirmed/corrected/excluded.
- Permanent employee-cycle insight.
- Team aggregation.
- Intermediate report.
- Final report.

### OQ-004: Customer-Facing Manager/HR Surface

The released manager/HR product surface still needs to be designed separately from the current development dashboard.
