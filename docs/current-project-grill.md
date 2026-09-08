# Current Project Grill

Created: 2026-08-21
Updated: 2026-09-08

Scope: current TypeScript product. MAF is intentionally out of scope.

## Thesis

The project has a strong technical skeleton: hexagonal packages, Postgres as source of truth, BullMQ for async work, typed contracts, prompt tests, and a real dashboard surface. The risk is not lack of architecture. The risk is that the product brain is spread across an oversized orchestrator, prompt prose, pulse docs, and old runtime artifacts.

The current product needs one sharper domain story:

> enTalent is a Slack-native work companion that builds trust through conversation while collecting privacy-aware pulse evidence over time.

Everything else should serve that sentence.

## Implementation Status

The discovery and product-truth portion of the grill is complete. The canonical contract is the 47 requirements in `docs/collected-product-requirements.md`; the BA-facing rendering is superseded and retained only as historical review input.

- Phase 0 — executable product contract: complete.
- Phase 1 — focused baseline repair: complete.
- Phase 2 — reportable-insight boundary: complete locally.
- Phase 3 — team/cycle cohort scope: in progress; persisted cohorts, cycle opening, immutable snapshot/delivery, later intermediate snapshot version gating, final one-message cycle aggregation, and retention cleanup are complete locally.
- Phase 4 — transfer and cycle lifecycle: complete locally.
- Phase 5 — development dashboard boundary: complete locally; all manager-labelled admin dashboard endpoints fail closed unless `INTERNAL_DASHBOARD_ENABLED=true` or `1`.
- Phase 6 pulse behavior is complete locally: numeric engagement capture/scoring, same-index backlog prioritization, and skipped-topic policy are covered by deterministic tests.
- Phase 7 — end-to-end verification: complete locally; deterministic no-MAF prepush and database integration gates pass.
- Other queued work is tracked in `_bmad-output/planning-artifacts/2026-09-03-pr5-product-conformance-audit-and-plan.md`.

Phase 2 has production-verified reporting disclosure, exact delivered-summary binding, multi-group confirmation progression, localized confirmation prompts, and question-free post-agreement acknowledgements. Typed TypeScript de-identification plus correction/withdrawal are locally complete. Phase 3 now has local immutable intermediate snapshots: the first version is idempotent, `delivery_unknown` blocks unsafe resends, later versions require changed reportable inputs from at least five distinct employees, final close sends one consolidated cycle message with only eligible Pulse Indices, and retention cleanup prevents expired/deleted records from returning through active lifecycle paths. Phase 6 now suppresses repeat pressure on a skipped backlog topic while another pending topic is available.

Manager-of-Managers roll-up, HR/HRBP reporting, and the released customer manager/HR surface and auth model remain deferred. Live Slack, production smoke, deploy, push, and PR actions remain separate operational steps requiring explicit authorization.

## Grill Findings

## Product Truths From Grill Session

### Employee experience

For the employee persona, enTalent should feel first like a **friend at work**: someone who hears, understands, supports, and helps the employee understand themselves in work situations. The mentor may coach, mentor, and emotionally support, but it must not feel like an HR questionnaire.

### Team Lead experience

For the Team Lead persona, enTalent should provide an honest team picture and useful recommendations for improving team management. This experience is separate from the employee chat and must not expose individual employee traces. Manager-of-Managers and HR/HRBP experiences are deferred.

The dashboard that exists today is a development/testing dashboard for product visibility. It lets the product team inspect how insights are collected, confirmed, and promoted through the pipeline. It is not the customer-facing manager/HR dashboard for a released product and now fails closed unless `INTERNAL_DASHBOARD_ENABLED=true` or `1`.

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
7. The Team Lead report is generated only from team-level generalized data and recommendations.

The employee is told during the onboarding lifecycle that anonymized team-level information may feed recommendations. The disclosure appears on the first safe survey-relevant turn rather than interrupting a fresh social greeting, and always before the first confirmation. Confirmation messages should not repeat that explanation unless the employee asks what the information is for or where it will be used.

Temporary working insights are visible only to the development/product team in non-customer product testing contexts. Managers and HR must not see temporary insight content, pending-confirmation counts, or other progress hints that reveal who has answered what.

If a temporary working insight is never confirmed, it cannot feed intermediate or final reports. It can remain available to the employee conversation context until the end of the pulse-check cycle, and any useful private-memory facts may remain in memory for future employee conversations. Temporary working insights for that cycle must expire after `periodEnd`, even when no report is eligible or report generation or delivery fails.

If the employee corrects a confirmation summary, the corrected version replaces the old working version for product/reporting purposes. The confirmed corrected content is what becomes permanent.

If a queued report snapshot becomes invalid before delivery, it is cancelled and that worker attempt stops without regenerating a replacement. Only a later explicit report trigger may build a fresh snapshot from current eligible inputs.

If Slack delivery may have succeeded but the worker cannot prove it, the snapshot enters `delivery_unknown`. Automatic retries must not send it again, and later snapshots for the same tenant, cohort, and Pulse Index remain blocked until explicit reconciliation resolves the outcome.

A pre-send TypeScript validation failure cancels the snapshot. A successful Slack receipt with an external message ID marks it delivered. Any exception after sending begins becomes `delivery_unknown`; no Slack provider taxonomy is added in this slice.

Each snapshot freezes its exact Slack workspace connection and manager user target. Delivery revalidates that binding; a changed manager or workspace cancels the snapshot. An existing snapshot is never retargeted, and only a later explicit report trigger may create a new snapshot for the current target.

The first snapshot is persisted only after AI returns a complete manager payload. TypeScript then revalidates contributors and the frozen delivery target before atomically storing the immutable payload and provenance under a database unique key. Only the insertion winner may attempt Slack delivery; a concurrent loser stops. There is no pre-AI `generating` snapshot state unless measured contention later proves it necessary.

Intermediate reports may be generated for a specific index when at least 80% of the team, and no fewer than five employees, have confirmed all three questions in that index. Final close enqueueing starts only after the immutable `periodEnd` cutoff and uses the final floor of at least five distinct frozen-roster employees per Pulse Index; the intermediate 80% threshold does not apply. Final close now enqueues one cycle-level job per cohort; the worker reuses the existing per-index report use case, omits ineligible indices, and sends one consolidated manager message only when at least one index is eligible. Unconfirmed temporary insights remain excluded and are expired by cycle close.

### MVP teams and deferred hierarchy

The active MVP roles are Employee and Team Lead. Each employee belongs to exactly one direct team; multi-team and project-team membership are out of scope. A Team Lead report is based only on that direct team and is generated only when the anonymity floor is satisfied. Small-team roll-up and Manager-of-Managers reporting are disabled until their inference-risk policy is approved.

If an employee changes teams in the middle of a pulse-check cycle, the previous team's insights must not move into the new team's reporting context. The pulse check restarts in a new team-bound working window, which becomes report-eligible only at the next cycle open. Current local implementation closes the old active window and creates an unreportable current-team window for that cycle.

The broader organization hierarchy, Manager-of-Managers reports, and HR/HRBP ownership and access rules are deferred product scope.

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

The internal dashboard and named admin APIs expose per-employee rows, evidence summaries, active risk flags, group status, and pulse backlog state only when the internal dashboard gate is explicitly enabled. That is operationally useful, but it is still close to identifiable employee monitoring.

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

## Current Open And Deferred Product Questions

The core MVP truths above are captured. Current implementation work should follow the numbered requirements rather than reopen them.

1. **Active now — data-model mapping:** What is the smallest mapping from working candidate through de-identification decision, confirmation, exclusion/withdrawal, and reportable employee-cycle insight?
2. **Deferred — Manager of Managers inference risk:** When roll-up is reopened, what subteam breakdowns can be shown without identifying a small team or Team Lead?
3. **Deferred — HR/HRBP reporting:** What visibility, scope, authorization, and audit rules apply?
4. **Deferred — released manager/HR surface:** What customer-facing experience replaces the current development dashboard?
