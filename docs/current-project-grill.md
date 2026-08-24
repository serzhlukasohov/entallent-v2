# Current Project Grill

Date: 2026-08-21

Scope: current TypeScript product. MAF is intentionally out of scope.

## Thesis

The project has a strong technical skeleton: hexagonal packages, Postgres as source of truth, BullMQ for async work, typed contracts, prompt tests, and a real dashboard surface. The risk is not lack of architecture. The risk is that the product brain is spread across an oversized orchestrator, prompt prose, pulse docs, and old runtime artifacts.

The current product needs one sharper domain story:

> enTalent is a Slack-native work companion that builds trust through conversation while collecting privacy-aware pulse evidence over time.

Everything else should serve that sentence.

## Grill Findings

## Product Truths From Grill Session

### Employee experience

For the employee persona, enTalent should feel first like a **friend at work**: someone who hears, understands, supports, and helps the employee understand themselves in work situations. The mentor may coach, mentor, and emotionally support, but it must not feel like an HR questionnaire.

### Manager and HR experience

For the manager/HR persona, enTalent should provide an honest team picture and useful recommendations for improving team management. This experience is separate from the employee chat and must not expose individual employee traces.

The dashboard that exists today is a development/testing dashboard for product visibility. It lets the product team inspect how insights are collected, confirmed, and promoted through the pipeline. It is not the customer-facing manager/HR dashboard for a released product and should be hidden from real customers, likely behind a feature toggle or equivalent environment gate.

### Trust-led guided pulse

The current employee product is best described as **trust-led guided pulse**: the agent has a soft product goal to collect pulse signal, but employee trust outranks finishing a specific backlog topic in a specific conversation.

If the employee answers briefly, avoids a backlog topic, or steers the conversation elsewhere, the agent should not push that same topic again in the same dialogue. It should follow the employee's topic or move on. The skipped backlog topic can return later, after other backlog topics have been attempted.

### Reactive vs proactive conversations

Reactive conversations are employee-led. The employee starts or brings a topic. The agent follows the employee's lead, supports, asks useful clarifying questions, may help reveal cause and effect, and closes naturally. Pulse evidence may emerge, but it does not drive the conversation.

Proactive pulse conversations are agent-initiated on a schedule from the company's backlog topics. They should have a flexible human shape: natural opening, contextual small talk when appropriate, a natural question about the backlog topic, clarifying questions to understand cause and effect, and a human-like closing. The structure exists to serve the product goal, but should not feel rigid or extractive.

### Privacy and reportability

Managers must never see a named employee's specific state, risk, evidence, or recommendation. Manager recommendations are team-level only.

Reports must be based on at least five employees. Even anonymized details must be generalized if a manager could infer the source from a concrete event, person, project, or situation.

Employee conversations can preserve concrete details in private memory so the mentor can remain context-aware in future employee conversations. Those details are not directly reportable.

The reporting pipeline has separate stages:

1. Temporary working insights are extracted automatically while the employee and mentor talk.
2. After the mentor has enough status and cause/effect understanding for a question group, it asks for confirmation in the same natural dialogue.
3. The confirmation message should be sufficient for report generation, but not detailed like a dossier. It should avoid names, projects, and concrete event details; it should express the employee's status and root cause in generalized terms.
4. If the employee confirms, the insight becomes a permanent anonymized employee-cycle insight for that pulse cycle. This is still per employee internally, but stripped of directly identifying details.
5. If the employee corrects, rewrites, or asks to exclude information, the working insight must be changed or excluded before it can become permanent.
6. After at least five employees in a team have permanent anonymized insights, the team-level aggregation can be generated.
7. The manager/HR report is generated only from team-level generalized data and recommendations.

The employee is told during onboarding that anonymized team-level information may feed recommendations. Confirmation messages should not repeat that explanation unless the employee asks what the information is for or where it will be used.

Temporary working insights are visible only to the development/product team in non-customer product testing contexts. Managers and HR must not see temporary insight content, pending-confirmation counts, or other progress hints that reveal who has answered what.

If a temporary working insight is never confirmed, it cannot feed intermediate or final reports. It can remain available to the employee conversation context until the end of the pulse-check cycle, and any useful private-memory facts may remain in memory for future employee conversations. When the pulse-check cycle ends and final reports are generated, temporary working insights for that cycle should be cleared.

If the employee corrects a confirmation summary, the corrected version replaces the old working version for product/reporting purposes. The confirmed corrected content is what becomes permanent.

Intermediate reports may be generated for a specific index when at least 80% of the team, and no fewer than five employees, have confirmed all three questions in that index. Final reports at the end of the pulse-check cycle should include all confirmed permanent insights collected by then. Unconfirmed temporary insights remain excluded.

### Organization hierarchy and reporting cohorts

Company setup must include an organization hierarchy, entered manually or through automation. The hierarchy defines employees, team leads, managers of managers, and HR ownership boundaries.

For MVP, each employee belongs to exactly one team and one branch of the hierarchy. Multi-team or project-team membership is out of scope.

Core roles:

- Employee: an individual contributor with no subordinates.
- Team Lead: a manager with direct employee subordinates.
- Manager of Managers: a manager whose subordinates include multiple team leads.

Reports depend on the audience:

- A Team Lead report is based on that team lead's direct employee team, if the anonymity floor is satisfied.
- A Manager of Managers report can include the teams/subteams under that manager's hierarchy.
- If a Team Lead has fewer than five employees, no team-level report is generated for that team lead. The data can roll up to the next eligible manager-level cohort, where it is mixed with other teams and generalized.

If an employee changes teams in the middle of a pulse-check cycle, the previous team's insights should not move into the new team's reporting context. The pulse check should restart for the employee in the new team, because the prior answers likely describe a different manager/team environment.

HR and HRBP reporting roles are intentionally deferred until Team Lead and Manager of Managers reporting is modeled.

### 1. The orchestrator is carrying too much product policy.

`ConversationOrchestrator` handles profile hydration, group confirmation, classification, feature flags, memory/style loading, risk, pulse probe selection, reminder scheduling, reply planning, language policy, response generation, persistence, message-send enqueue, memory enqueue, style enqueue, and survey evidence enqueue.

That gives the project one powerful spine, but it also means product rules are hard to audit independently. The sharp question:

> If a product manager asks "why did the mentor ask this question now?", can the answer be read from a small policy module, or only reconstructed from orchestration plus prompt text plus DB state?

### 2. Prompt prose is acting like product architecture.

The response prompt defines the companion identity, proactive check-in behavior, confirmation behavior, survey probe etiquette, conversational rhythm, hard question limits, memory usage, safety behavior, and style rules.

Some of that belongs in prompts. But the stable product decisions need names and tests outside the prompt. Otherwise "make it sound better" edits can accidentally change measurement cadence, consent, or safety behavior.

Sharp question:

> Which prompt rules are product invariants, and which are just rendering style?

### 3. Pulse is both a measurement system and a relationship behavior.

The pulse backlog model is concrete and useful: ordered questions, active/pending/done states, ignore handling, engagement unlock, cross-pollination through survey evidence. But product language alternates between "automatically messages every employee once every 3 days" and "never sound like a wellness bot doing rounds."

That tension is the product. It should be explicit:

> The system wants evidence, but the user must experience conversation.

Sharp question:

> When evidence collection and conversational trust conflict, which one wins, and where is that encoded?

### 4. "Memory", "goals", "follow-ups", and "reminders" are not yet one consent model.

Explicit reminders are scheduled inside the orchestrator after classifier detection. Follow-up candidates can also be proposed by memory extraction and scheduled elsewhere. ADR-011 says open loops should persist after consent, but the current code still has multiple loop-like mechanisms.

Sharp question:

> What is the canonical difference between a reminder, a follow-up, a goal, a memory item, and a pulse probe?

If that answer is fuzzy, the mentor will eventually feel spooky: it will remember, ask, and reappear in ways the employee did not knowingly invite.

### 5. Manager analytics can outrun the privacy story.

The dashboard and admin APIs expose per-employee rows, evidence summaries, active risk flags, group status, and pulse backlog state. That is operationally useful, but it is close to identifiable employee monitoring.

Sharp question:

> What can a manager see, what can only an admin see, and what should never be shown as raw evidence?

ADR-008 covers privacy-oriented manager analytics, but the current surface needs a product-facing permission story that is easier to inspect than controller guards plus environment restrictions.

### 6. The repository still tells a dual-runtime story.

The current product direction is TypeScript. Yet package exports, scripts, docs, worker branches, runtime attempts, and runbooks still expose MAF-era concepts. Leaving them in place may be fine temporarily, but the team needs a label for the current state: active TS spine, archived MAF path.

Sharp question:

> Which verification commands prove the current product, and which are historical MAF leftovers?

## Domain Model Pressure Points

- Employee: the person chatting with the mentor.
- Mentor: the AI work companion, not a coach running sessions and not an HR survey bot.
- Conversation turn: one inbound or outbound message with policy-relevant metadata.
- Dialogue act: the latest employee turn's contribution to conversation flow.
- Reply plan: typed policy for the next response.
- Pulse backlog: per-user ordered queue of evidence territories.
- Probe: a soft conversational move that may gather evidence without sounding like a survey.
- Evidence: a persisted claim that a conversation covered a survey question.
- Group confirmation: employee-facing consent/checkpoint before a group becomes confirmed.
- Manager insight: aggregated or identifiable dashboard data with privacy constraints.
- Open loop: any future-oriented item the mentor may return to.

## Next Grill Questions

1. What is the product's primary promise: better employee reflection, manager visibility, retention risk detection, or continuous pulse measurement?
2. What is the one thing the mentor must never optimize for if it harms trust?
3. Should pulse evidence be invisible background extraction, explicit confirmation, or a hybrid by dimension?
4. Who is allowed to see evidence summaries: employee, manager, admin, or nobody?
5. What exact behavior proves "TS runtime is the product spine" in production?
6. Which old MAF artifacts are dangerous because they can still affect production behavior?
7. What is the minimum domain API for "why did the mentor speak now?"
8. Are proactive messages budgeted per product reason or globally per user per day?
9. Is a group confirmation a consent step, a data-quality step, or both?
10. What would make this product feel creepy, even if the code is technically correct?
