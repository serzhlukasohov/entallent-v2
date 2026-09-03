# Collected Product Requirements

Created: 2026-08-31

Last updated: 2026-09-03

Scope: current TypeScript product. MAF is out of scope.

## 1. Product Positioning

### REQ-001: Multi-Persona Product

enTalent must support two active MVP personas:

- Employee: uses the agent in a private Slack conversation.
- Team Lead: receives privacy-safe team-level reports and recommendations when the direct team is eligible.

The employee and Team Lead experiences are separate product surfaces with different privacy rules. Manager of Managers and HR/HRBP reporting are deferred product surfaces.

### REQ-002: Employee Experience Promise

For employees, the agent must feel primarily like a trusted friend at work: someone who listens, understands, supports, and helps the employee understand themselves in work situations.

The agent may behave as a mentor, coach, or emotional support companion, but it must not feel like an HR questionnaire, survey bot, or formal coaching-session runner.

### REQ-003: Team Lead Experience Promise

For eligible Team Leads, the product must provide an honest team-level picture and useful recommendations for improving team management.

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

### REQ-008: MVP Pulse Indices And Questions

The product completion and reporting unit is a Pulse Index: exactly three questions that are confirmed together and feed one index report. The implementation field `questionGroup` is the persisted alias for a Pulse Index.

The MVP pulse check has four regular indices and one end-of-cycle engagement index:

| Pulse Index | Canonical question stable keys |
| --- | --- |
| Autonomy | `q12_expectations`, `q12_strengths_opportunity`, `q12_opinions_count` |
| Belonging | `wellbeing_at_work`, `q12_supervisor_cares`, `belonging_psychological_safety` |
| Growth | `role_clarity`, `professional_growth`, `q12_progress_discussion` |
| Purpose | `q12_recognition`, `purpose_meaning`, `purpose_contribution` |
| Engagement | `engagement_nps` (Recommendation Likelihood), `engagement_motivation`, `engagement_current` |

Engagement questions are eligible only during the half-open interval `[periodEnd - 14 calendar days, periodEnd)`. Each answer must be an integer explicitly stated by the employee from 1 through 10. Polarity, sentiment, or an inferred score must not substitute for an explicit answer.

All three answers are required before the Engagement Pulse Index is complete. The employee-level value is their equal-weight arithmetic mean. Calculations retain full precision and round to one decimal only for display. A team value is the equal-weight arithmetic mean of eligible employee-level values. Missing or invalid answers keep the index incomplete; `engagement_nps` is a legacy stable key for Recommendation Likelihood and does not use the eNPS promoter/detractor formula.

### REQ-009: Pulse Cycle

The current pulse-check cycle is one quarter. Its interval is `[periodStart, periodEnd)`. `periodEnd` is an immutable UTC instant persisted when the cycle opens; tenant local time is used only to calculate that instant.

Eligibility at the cutoff is determined by durable event timestamps, not by job execution order. Source evidence and the employee confirmation of the exact displayed version must both occur within `[periodStart, periodEnd)`. A correction creates a new version whose evidence, display, and reconfirmation must all occur before `periodEnd` to enter that cycle's final report. A persisted withdrawal applies to every snapshot generated at or after the withdrawal time, including a final-report job that runs after cutoff. Temporary working insights may live until `periodEnd` and must expire after it even when no report is eligible or report generation or delivery fails.

### REQ-010: Group Completion Before Confirmation

After the agent has collected enough status and cause/effect understanding for all three questions in one Pulse Index, it should ask the employee for confirmation in the same natural dialogue.

## 4. Insight Pipeline

### REQ-011: Temporary Working Insights

The system may automatically extract temporary working insights while the employee and mentor talk.

Temporary working insights are not permanent and are not reportable until the employee confirms the exact displayed version. A correction alone never makes an insight reportable.

### REQ-012: Confirmation Gate

Before an insight can become permanent and feed reporting, the agent must show the employee the exact de-identified text that would become reportable and receive confirmation after the reporting disclosure in REQ-015 has been recorded. That confirmation approves both accuracy and inclusion in future team reporting.

The employee may:

- Confirm the summary.
- Correct the summary.
- Rewrite the summary.
- Exclude some or all information from reporting.

### REQ-013: Confirmation Message Style

The confirmation message must be sufficient for future report generation but must not feel like a dossier about the employee.

It must avoid names, project names, concrete events, and specific situations that could identify the employee or other people. It should express the employee's status and root cause in generalized language.

A candidate cannot enter confirmation or reporting until a typed TypeScript de-identification policy returns `accepted` with a policy version. The policy must at minimum reject known employee, manager, teammate, team, project, and customer identifiers; Slack handles; email addresses; phone numbers; URLs; exact dates or times; and source-message identifiers. Rejection keeps the candidate in working state and records machine-readable reasons so it can be generalized and checked again. Prompt instructions alone cannot produce an `accepted` decision.

### REQ-014: Confirmation UX

Confirmation should be a normal free-text conversation, not a button-based UI.

The agent should ask a natural version of "did I understand you correctly?" and wait for the employee's response.

### REQ-015: Reporting Explanation

The employee must learn during onboarding that de-identified information they confirm may feed team-level recommendations. The system must persist the disclosure version and `shownAt` timestamp.

Only a confirmation made after the persisted disclosure can authorize reporting inclusion. The agent should not repeat the explanation during every confirmation and should explain where information goes when the employee asks.

### REQ-016: Permanent Employee-Cycle Insights

After employee confirmation, the exact displayed version becomes a permanent de-identified employee-cycle insight for that employee and pulse cycle.

This record is still internally associated with the employee and cycle, but must be stripped of directly identifying details before it can feed team aggregation.

### REQ-017: Correction Handling

If the employee corrects a confirmation summary, the correction creates a new working version and replaces the old working version for product and reporting purposes.

The corrected version must pass de-identification and be shown to the employee for a new confirmation before it can become the permanent employee-cycle insight.

### REQ-018: Unconfirmed Insight Handling

Unconfirmed temporary working insights must not feed intermediate reports or final reports.

They may remain available to the employee conversation context until the end of the pulse-check cycle. Useful private-memory facts may remain in memory for future employee conversations, but they remain non-reportable.

## 5. Memory And Reportability

### REQ-019: Private Memory

The agent may store concrete details in private memory to make future conversations with the same employee more helpful and continuous.

Private memory may include important past events, work context, stressors, preferences, goals, commitments, or similar employee-specific context.

### REQ-020: Private Memory Is Not Reportable Signal

Private memory must not directly feed manager/HR reports.

Only confirmed, de-identified, non-withdrawn permanent employee-cycle insights may feed team aggregation and reporting.

### REQ-021: Employee Exclusion Request

An employee must be able to tell the agent not to use specific information for reports.

This can happen during confirmation or during ordinary conversation. The exclusion or withdrawal must be persisted and block the information from every future report snapshot. Before delivery, every queued snapshot must be revalidated against current withdrawal state; a snapshot containing newly withdrawn input is cancelled and may be regenerated only from the remaining eligible inputs. Already delivered Slack reports are immutable and must not be silently edited or deleted.

## 6. Privacy And Manager Visibility

### REQ-022: No Individual Manager Visibility

Managers must never see a named employee's specific state, risk, evidence, answer, insight, or recommendation.

### REQ-023: No Individual Recommendations

Managers must never receive recommendations about a specific named or inferable employee.

Recommendations must be addressed to the team, environment, process, communication pattern, workload, expectations, or management practices.

### REQ-024: Anonymity Floor

A manager-visible report or recommendation must be based on at least five distinct employees from the frozen tenant/team/cycle roster. Each employee counts at most once per Pulse Index and cycle.

The roster contains employees who are active, assigned to exactly one team, and opted into survey participation when the cycle opens. Later deletion, opt-out, or transfer excludes that employee's data but does not reduce the frozen denominator; if the threshold becomes unreachable, reporting fails closed until the next cycle.

### REQ-025: De-Identification Beyond Name Removal

Removing names is not enough. Any event, project, situation, or detail that lets a manager infer the employee source must be generalized or suppressed.

### REQ-026: Manager And HR Exclusion From Temporary State

Managers and HR must not see:

- Temporary working insight content.
- Pending-confirmation counts.
- Employee-level progress hints.
- Signals that reveal who has answered what or when a report may become available.

## 7. Reporting

### REQ-027: Team-Level Aggregation

Reports must be generated from tenant-, team-, cycle-, and Pulse Index-scoped generalized data, not raw employee conversation details.

Team aggregation may occur only after at least five employees in the reporting cohort have confirmed permanent employee-cycle insights.

### REQ-028: Intermediate Reports

An intermediate report may be generated for a specific Pulse Index when:

- At least `max(5, ceil(0.8 × eligibleRosterSize))` distinct employees from the frozen roster have confirmed all three questions in that index.
- All included insights have passed confirmation.

Each manager-visible intermediate report is an immutable snapshot. A later version may be published only when reportable inputs from at least five distinct employees have changed since the previous visible snapshot. Versions must not expose per-version contributor deltas.

### REQ-029: Final Reports

A final report is one team-level cycle report generated after the immutable `periodEnd` cutoff. It may include a Pulse Index only when at least five distinct frozen-roster employees have eligible reportable insights for that index; the 80% intermediate threshold does not apply at final close. Ineligible indices are omitted, and no report is generated when every index is ineligible.

It must include all confirmed, non-withdrawn permanent employee-cycle insights whose durable source-event timestamps fall before the cutoff. Unconfirmed temporary working insights must remain excluded and expire after the cutoff even when the cohort is ineligible or report generation or delivery fails.

### REQ-030: Team-Level Recommendations

Reports should include practical team-level recommendations that help managers improve the team's working conditions.

Recommendations must not identify, isolate, or imply a specific employee source.

## 8. Organization Hierarchy And Reporting Cohorts

### REQ-031: Company Hierarchy Setup

During company setup, the product must capture the organization hierarchy manually or through automation.

The active MVP hierarchy must define:

- Employees.
- Team Leads.
- Which employee belongs to which direct team.

Manager of Managers branches and HR ownership boundaries are deferred.

### REQ-032: MVP Single-Team Membership

For MVP, each active employee belongs to exactly one active team. The tenant/team/cycle reporting roster is captured when the cycle opens from active, single-team, survey-opted-in employees and is immutable for that cycle.

Multi-team and project-team membership are out of scope for MVP.

### REQ-033: Employee Role

An Employee is an individual contributor with no subordinates in the configured hierarchy.

### REQ-034: Team Lead Role

A Team Lead is a manager with direct employee subordinates.

A Team Lead may receive a report only if the direct team satisfies the anonymity floor.

### REQ-035: Manager of Managers Role

Manager of Managers hierarchy and reporting are deferred from the active MVP scope.

When this scope is reopened, the role will represent a manager whose hierarchy includes multiple Team Leads and will require a separately approved inference-risk policy.

### REQ-036: Small-Team Fail-Closed Policy

If a Team Lead has fewer than five employees, no report is generated for that Team Lead.

Small-team roll-up is disabled for MVP. Confirmed insights from an ineligible team must not be published or moved into another audience's cohort until Manager of Managers policy is explicitly approved.

### REQ-037: Team Transfer During Pulse Cycle

If an employee changes teams in the middle of a pulse-check cycle, the previous team's insights must remain bound to the source team and cycle and must not move into the new team's reporting context.

The old team-bound window closes and the pulse check restarts in a new team-bound working window because prior answers likely describe a different manager/team environment. During the current cycle, the new window may support private conversation continuity but cannot promote its state into a reportable employee-cycle insight. The frozen reporting roster and denominator do not change; the transferred employee becomes report-eligible in the new team at the next cycle open.

### REQ-038: HR/HRBP Reporting Deferred

HR and HRBP reporting rules are deferred until Team Lead and Manager of Managers reporting is modeled. The admin/development dashboard must not be reused as an HR surface.

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

## 11. Cross-Cutting Product Policies

### REQ-045: Deterministic Pulse Suppression

Pulse collection must be suppressed when survey participation is disabled or the employee has opted out. Active high-risk handling must suppress survey steering while reactive employee support remains available.

Proactive outreach must additionally be suppressed when proactive messaging is disabled for the tenant or employee, the employee is inactive or deleted, or the employee is inside effective quiet hours. The typed tenant and employee policies are authoritative; prompt prose cannot override them.

### REQ-046: Tenant Isolation

All employee-derived state, jobs, cohort counting, reporting inputs, and report snapshots must be scoped to one tenant. Missing or mismatched tenant scope must fail closed. Shared non-personal survey definitions are the only allowed cross-tenant exception.

### REQ-047: Retention And Deletion

Messages, memory, risk signals, audit records, survey evidence, working and permanent insights, withdrawals, and report snapshots must have an effective typed retention policy. Expired or deleted data must not return to future processing, cohort eligibility, or reporting.

The existing tenant policy fields are authoritative and map as follows: survey evidence uses `messagesRetentionDays`; permanent employee-cycle insights use `memoryRetentionDays`; withdrawals and report snapshots use `auditLogRetentionDays`. Temporary working insights expire at the earlier of cycle close or the applicable memory-retention cutoff. Retention durations must not be duplicated in prompts, jobs, or repositories.

## 12. Open Questions

### OQ-001: Manager of Managers Inference Risk

If a small team rolls up to a Manager of Managers, the manager may still infer which Team Lead or small team caused a negative signal.

Open questions:

1. Can Manager of Managers reports show breakdowns by subteam?
2. Should Manager of Managers reports be roll-up only, without subteam breakdown?
3. If one subteam is large and another is small, can the large subteam be shown separately while the small one remains only inside roll-up?
4. Can reports show "top affected area" without naming the team?
5. Should there be a suppression rule when a recommendation effectively points to a specific Team Lead or small group?

Current fail-closed MVP policy:

> Manager of Managers reporting and small-team roll-up are disabled. When this scope is reopened, roll-up must not expose subteam breakdown unless every displayed subteam independently satisfies the anonymity floor and passes an inference-risk check.

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
