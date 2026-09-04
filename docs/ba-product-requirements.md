# enTalent Product Requirements For BA Review

Date: 2026-09-04

Status: draft for Business Analyst review

Scope: current TypeScript product. MAF is intentionally out of scope.

## 1. Executive Summary

enTalent is a multi-persona product for employee listening and team-level management insight.

For employees, the product is a private Slack conversation with an AI agent that should feel like a trusted friend at work: supportive, attentive, emotionally aware, and useful for self-reflection in work situations.

For managers and HR, the product provides anonymized, team-level reports and recommendations based on confirmed employee insights. It must not expose individual employee responses, risks, evidence, or recommendations.

The core product mode is **trust-led guided pulse**: the agent has a soft business goal to collect pulse signals, but employee trust and natural conversation are more important than completing a specific pulse topic in a specific dialogue.

## 2. Personas

### Employee

An individual contributor who talks with the agent in a private Slack chat.

Primary expectation:

- The agent feels like a trusted friend at work.
- The agent listens, understands, supports, and helps the employee understand themselves in work situations.
- The agent may mentor, coach, or emotionally support.
- The agent must not feel like an HR questionnaire, survey bot, or formal interview.

### Team Lead

A manager with direct employee subordinates.

Primary expectation:

- Receives team-level reports only when the direct team satisfies the anonymity floor.
- Never sees named employee insights, individual risk, raw evidence, or individual recommendations.

### Manager of Managers

A manager whose hierarchy includes multiple Team Leads.

Primary expectation:

- May receive rolled-up reports across lower-level teams or subteams.
- Reporting must preserve anonymity and avoid inference risks from small teams.

### HR / HRBP

HR reporting rules are not finalized yet.

Current status:

- HR and HRBP report visibility, scope, and access rules are deferred until Team Lead and Manager of Managers reporting is modeled.

## 3. Product Principles

### PRIN-001: Trust First

Employee trust is the primary condition for product success. If the employee feels interrogated, surveilled, or mined for data, the employee-chat experience is failing even if data collection succeeds.

### PRIN-002: Guided, Not Extractive

The agent may guide proactive pulse conversations toward company-defined topics, but must do so naturally and respectfully.

### PRIN-003: Private Memory Is Not Reportable Signal

The agent may remember concrete employee-specific details for future conversations with the same employee. Those details must not directly feed manager or HR reports.

### PRIN-004: Confirmation Before Reportability

Automatically extracted insights are not reportable until the employee confirms or corrects the agent's understanding.

### PRIN-005: Team-Level Reporting Only

Manager-facing value must come from aggregated team-level patterns and recommendations, not individual monitoring.

### PRIN-006: Anonymity Requires More Than Removing Names

Names, projects, concrete events, and specific situations must be removed or generalized if they could allow a manager to infer the source.

## 4. Employee Conversation Requirements

### REQ-001: Employee Agent Identity

The employee-facing agent must behave like a trusted friend at work.

It should be warm, supportive, attentive, and capable of helping the employee understand their work situation.

### REQ-002: No Survey-Bot Feeling

The employee-facing agent must not feel like:

- An HR survey form.
- A questionnaire.
- A rigid coaching-session runner.
- An interviewer collecting answers.

### REQ-003: Reactive Conversation Mode

When the employee starts a conversation or brings their own topic, the agent must follow the employee's topic.

The agent may:

- Support the employee.
- Ask clarifying questions.
- Help identify cause-and-effect relationships.
- Offer mentoring or coaching when appropriate.
- Close the conversation naturally.

Pulse evidence may be collected if it naturally emerges, but it must not override the employee-led topic.

### REQ-004: Proactive Pulse Conversation Mode

When the agent starts a conversation based on a scheduled pulse backlog topic, the conversation should have a flexible human shape:

1. Natural opening.
2. Contextual small talk when appropriate.
3. A natural question related to the selected backlog topic.
4. Clarifying questions to understand status and root cause.
5. Human-like closing.

This structure is guidance, not a rigid script.

### REQ-005: Natural Backlog Topic Framing

The agent must not repeat the backlog topic word-for-word if it would feel unnatural.

The topic should be translated into a conversational question that helps understand what the employee thinks and feels about that area.

### REQ-006: Skipped Topic Handling

If the employee answers briefly, avoids the topic, changes subject, or does not want to develop the backlog topic, the agent must not push that same topic again in the same dialogue.

The agent should follow the employee's topic or move on.

The skipped backlog topic may return later after other backlog topics have been attempted.

### REQ-007: Human-Like Closing

The agent must not abruptly end the conversation after collecting enough insight.

It should close the dialogue naturally so the employee does not feel that the agent "got what it needed" and left.

## 5. Pulse Backlog Requirements

### REQ-008: MVP Pulse Groups

The MVP pulse check covers twelve topics across four regular groups:

- Autonomy.
- Belonging.
- Growth.
- Purpose.

Engagement may exist as a separate end-of-cycle group.

### REQ-009: Pulse Cycle Duration

The current pulse-check cycle is one quarter.

### REQ-010: Group-Level Completion

The agent should ask for confirmation after it has enough status and root-cause understanding for all required questions in one question group or index.

## 6. Insight Pipeline Requirements

### REQ-011: Temporary Working Insight Creation

The system may automatically extract temporary working insights while the employee and agent talk.

Temporary working insights are working data only. They are not permanent and not reportable.

### REQ-012: Temporary Working Insight Lifetime

Temporary working insights may live until the end of the pulse-check cycle.

If still unconfirmed by cycle end, they must be cleared after final reports are generated.

### REQ-013: Confirmation Gate

Before an insight becomes permanent or reportable, the agent must confirm its understanding with the employee.

The employee may:

- Confirm the summary.
- Correct the summary.
- Rewrite the summary.
- Exclude some or all information from reporting.

### REQ-014: Confirmation Message Content

The confirmation message must be sufficient to support later report generation, but must not feel like a detailed dossier.

It should include:

- Generalized employee status.
- Generalized root cause or cause-and-effect understanding.

It should avoid:

- Names.
- Project names.
- Concrete events.
- Specific situations that could identify the employee or another person.

### REQ-015: Confirmation UX

Confirmation must happen through normal free-text dialogue, not buttons or rigid UI options.

The agent should ask a natural version of "did I understand you correctly?" and wait for the employee's response.

### REQ-016: Reporting Explanation During Confirmation

The agent should not repeat during every confirmation that the information may feed anonymized reports.

This should be explained during onboarding.

If the employee asks why the agent is asking or where the information will be used, the agent must explain that anonymized and generalized team-level information may feed manager/HR recommendations.

### REQ-017: Permanent Employee-Cycle Insight

After employee confirmation, a temporary working insight becomes a permanent anonymized employee-cycle insight.

It remains internally associated with the employee and pulse cycle, but must be stripped of directly identifying details before it can feed team aggregation.

### REQ-018: Correction Replacement

If the employee corrects the confirmation summary, the corrected version replaces the previous working version for product and reporting purposes.

The corrected confirmed version becomes the permanent employee-cycle insight.

### REQ-019: Excluded Information

If the employee asks not to use specific information for reports, that information must not become reportable.

This exclusion request can happen during confirmation or during ordinary conversation.

### REQ-020: Unconfirmed Insight Exclusion

Unconfirmed temporary working insights must not feed intermediate reports or final reports.

They may remain useful for employee conversation context during the active cycle, and useful facts may remain in private memory, but they remain non-reportable.

## 7. Memory Requirements

### REQ-021: Private Memory

The agent may store concrete details in private memory to improve future conversations with the same employee.

Private memory may include:

- Important past events.
- Work context.
- Stressors.
- Preferences.
- Goals.
- Commitments.
- Other context that helps continuity.

### REQ-022: Private Memory Usage

Private memory may be used only to make future employee-agent conversations more helpful and continuous.

### REQ-023: Private Memory Reporting Boundary

Private memory must not directly feed manager or HR reports.

Only confirmed, anonymized, permanent employee-cycle insights may feed team aggregation and reporting.

## 8. Privacy And Visibility Requirements

### REQ-024: No Named Employee Visibility

Managers must never see a named employee's:

- State.
- Risk.
- Evidence.
- Answer.
- Insight.
- Recommendation.

### REQ-025: No Individual Recommendations

Managers must never receive recommendations about a specific named or inferable employee.

Recommendations must address team-level conditions, processes, communication, workload, expectations, environment, or management practices.

### REQ-026: Anonymity Floor

A manager-visible report or recommendation must be based on at least five employees.

### REQ-027: De-Identification Requirement

Removing names is not enough.

Any detail that lets a manager infer the employee source must be generalized or suppressed.

Examples of potentially identifying details:

- A unique project.
- A specific meeting.
- A recent incident.
- A recognizable conflict.
- A role held by only one person in the team.

### REQ-028: No Temporary-State Visibility For Managers/HR

Managers and HR must not see:

- Temporary working insight content.
- Pending-confirmation counts.
- Employee-level progress hints.
- Signals that reveal who has answered what.
- Signals that reveal when a report may become available.

## 9. Reporting Requirements

### REQ-029: Team-Level Aggregation

Reports must be generated from team-level generalized data, not raw employee conversation details.

Team aggregation may occur only after at least five employees in the reporting cohort have confirmed permanent employee-cycle insights.

### REQ-030: Intermediate Reports

An intermediate report may be generated for a specific index when:

- At least 80% of the team has confirmed all three questions in that index.
- At least five employees are included.
- All included insights have passed confirmation.

Intermediate reports are index-specific.

They may be updated later if more employees complete the same index.

### REQ-031: Final Reports

A final report is generated at the end of the pulse-check cycle.

It must include all confirmed permanent employee-cycle insights available by cycle close.

Unconfirmed temporary working insights must remain excluded.

### REQ-032: Team-Level Recommendations

Reports should include practical recommendations that help managers improve the team's working conditions.

Recommendations must not identify, isolate, or imply a specific employee source.

## 10. Organization Hierarchy Requirements

### REQ-033: Company Hierarchy Setup

During company setup, the product must capture the organization hierarchy manually or through automation.

The hierarchy must define:

- Employees.
- Team Leads.
- Managers of Managers.
- HR ownership boundaries.
- Which employee belongs to which team and hierarchy branch.

### REQ-034: MVP Single-Team Membership

For MVP, each employee belongs to exactly one team and one branch of the organization hierarchy.

Multi-team and project-team membership are out of scope for MVP.

### REQ-035: Employee Role

An Employee is an individual contributor with no subordinates in the configured hierarchy.

### REQ-036: Team Lead Role

A Team Lead is a manager with direct employee subordinates.

A Team Lead may receive a report only if the direct team satisfies the anonymity floor.

### REQ-037: Manager of Managers Role

A Manager of Managers is a manager whose hierarchy includes multiple Team Leads.

This role may receive rolled-up reporting across eligible lower-level teams and subteams.

### REQ-038: Small-Team Roll-Up

If a Team Lead has fewer than five employees, no report is generated for that Team Lead.

The team's confirmed insights may roll up to the next eligible manager-level cohort, where they are mixed with other teams and generalized.

### REQ-039: Team Transfer During Pulse Cycle

If an employee changes teams in the middle of a pulse-check cycle, the previous team's insights should not move into the new team's reporting context.

The pulse check should restart for the employee in the new team because prior answers likely describe a different manager/team environment.

## 11. Development Dashboard Requirements

### REQ-040: Development-Only Dashboard

The current dashboard is a development/product testing dashboard.

It exists so the product team can inspect how insights are collected, confirmed, and promoted through the pipeline.

### REQ-041: Not Customer-Facing

The current dashboard must not be treated as the released manager/HR customer surface.

For real customer environments, it should be hidden, likely through a feature toggle or equivalent environment gate.

### REQ-042: Product Team Visibility

In dev/testing contexts, the product team may inspect temporary working insights and confirmation progress to validate product behavior.

This visibility is not available to managers, HR, or customers in the released product.

## 12. Technical/Product Alignment Requirements

### REQ-043: TypeScript Runtime As Product Spine

The current product direction treats the TypeScript runtime as the active product spine.

Inbound Slack messages, response planning, rendering, persistence, queues, prompts, and dashboard/admin contracts should be evaluated against the TypeScript flow.

### REQ-044: MAF Out Of Scope

MAF-specific code, scripts, docs, and cleanup are out of scope for this requirements pass unless a separate task explicitly reopens them.

### REQ-045: Product Policy Must Not Live Only In Prompts

Stable product decisions should be represented in docs, typed contracts, policy modules, and tests, not only in prompt prose.

Prompt text may render product behavior, but should not be the only place where privacy, consent, pulse cadence, or reportability rules are defined.

## 13. Glossary

**Anonymity Floor**
The minimum privacy threshold for manager-visible reporting. Reports and recommendations require at least five employees and must remove or generalize identifying details.

**Confirmation Gate**
The consent and accuracy step where the mentor asks whether it understood a question group correctly before an insight becomes permanent and reportable.

**Development Dashboard**
The current internal product-testing surface used by the product/development team to inspect insight collection and confirmation. It is not a released manager/HR customer surface.

**Employee-Cycle Insight**
A confirmed and anonymized insight associated internally with one employee and one pulse-check cycle. It can feed team aggregation, but must not expose identifying details.

**Final Report**
The end-of-cycle team-level report generated from all confirmed permanent employee-cycle insights available by cycle close.

**Intermediate Report**
A team-level report for one index generated before the pulse-check cycle ends, once at least 80% of the team and at least five employees have confirmed all required questions for that index.

**Manager of Managers**
A manager whose hierarchy includes multiple Team Leads.

**Private Memory**
Concrete employee-specific context used only to make future conversations with the same employee more helpful and continuous.

**Proactive Pulse Conversation**
An agent-initiated conversation scheduled from the pulse backlog.

**Reactive Conversation**
An employee-led conversation where the agent follows the employee's topic.

**Reportable Signal**
An anonymized, confirmed, and generalized signal that may feed team-level reporting.

**Reporting Cohort**
The group of employees whose confirmed insights can be aggregated into a report for a specific audience.

**Team Aggregation**
The stage that combines confirmed employee-cycle insights into generalized team-level findings.

**Team Lead**
A manager with direct employee subordinates.

**Temporary Working Insight**
An automatically extracted, not-yet-final insight from employee conversation. It is not permanent and not reportable until confirmed or corrected.

**Trust-Led Guided Pulse**
The employee-chat product mode where the agent has a soft goal to collect pulse signal, but employee trust and natural conversation outrank completing a backlog topic in the current dialogue.

## 14. Open Questions For BA Review

### OQ-001: Manager of Managers Inference Risk

If a small team rolls up to a Manager of Managers, the manager may still infer which Team Lead or small team caused a negative signal.

Questions to resolve:

1. Can Manager of Managers reports show breakdowns by subteam?
2. Should Manager of Managers reports be roll-up only, without subteam breakdown?
3. If one subteam is large and another is small, can the large subteam be shown separately while the small one remains only inside roll-up?
4. Can reports show "top affected area" without naming the team?
5. Should there be a suppression rule when a recommendation effectively points to a specific Team Lead or small group?

Current hypothesis:

> For MVP, Manager of Managers reports should be roll-up only, without subteam breakdown, unless every displayed subteam independently satisfies the anonymity floor and passes an inference-risk check.

### OQ-002: HR And HRBP Reporting

HR and HRBP report visibility, scope, and access rules still need a separate requirements session.

### OQ-003: Data Model Mapping

The current database model needs to be mapped against the required pipeline:

- Temporary working insight.
- Confirmation pending.
- Confirmed, corrected, or excluded insight.
- Permanent employee-cycle insight.
- Team aggregation.
- Intermediate report.
- Final report.

### OQ-004: Released Manager/HR Product Surface

The released manager/HR product surface still needs to be designed separately from the current development dashboard.
