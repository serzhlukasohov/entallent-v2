# Epic 11 Context: TypeScript Mentor Conversation Quality

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Improve the production TypeScript mentor through small, measurable slices: keep one inbound orchestration path, make ordinary turn-taking feel natural, preserve only the continuity users need, and require consent before creating future commitments. The epic treats the successful return to TypeScript as the baseline and improves it without building another runtime, dialogue engine, state store, or analytics platform. The employee should experience a companion in each Slack turn and a mentor across days, while TypeScript remains the deterministic owner of policy, persistence, and side effects.

## Stories

- Story 11.1: Establish Direct TypeScript Path And Quality Baseline
- Story 11.2: Make Turn-Taking Natural And Reliable
- Story 11.3: Persist Minimal Continuity And Use Real Goals
- Story 11.4: Require Consent For Loops And Share Proactive Initiative

## Requirements & Constraints

The employee owns the agenda of every inbound turn. The mentor may continue relevant substance but must not pull an unrelated goal, parked thread, pulse probe, or open loop into the conversation. Closing and no-substance acknowledgements must end naturally, without restarting coaching; any reply must respect a single whole-response question budget. Invalid model labels must be normalized at the classifier boundary so ordinary dialogue acts cannot fail the job.

Continuity must be deliberately small: one current or parked thread, sitting timing, and at most one waiting interaction. Active goals may ground a relevant reply, but they are memory for returning later rather than a script for the current turn. A reminder or mentoring loop may be persisted only after an explicit user request or typed consent to an offer. Declining or leaving the topic creates no commitment and must not provoke another question.

All system-initiated contact shares one daily initiative budget. Safety and suppression win first, followed by explicit reminders, due consented loops, relevant parked threads, and warm check-ins; a pulse probe is optional and cannot create a second competing question. Existing quiet-hours, crisis, opt-out, survey, and privacy behavior must not regress.

Each slice must be evaluated against the same TypeScript baseline using existing product data. Measures include reply success and latency, 24-hour return, turns per active conversation, correction and closing failures, and useful memory, goal, survey, or consented-follow-up yield. Segment conversational outcomes by typed dialogue decision and whether a question was asked, but treat those comparisons as correlation rather than causality. Measurement metadata may contain enums, flags, identifiers, and counts only; it must not contain prompts, completions, private memory or topic text, reasoning, or chain-of-thought. Do not publish token, cost, or model-quality claims until the underlying records are truthful.

MAF deletion, service/data cleanup, tenant user-insight hardening, Slack ingress idempotency, stable queue job identifiers, Slack thread propagation, semantic retrieval, and a new analytics surface are outside this epic. Removing the public agent-service domain remains a separate production operation requiring explicit approval.

## Technical Decisions

Use one TypeScript conversation spine: classify once, derive a deterministic `ReplyPlan`, render through the existing AI provider boundary, then let TypeScript validate, commit, and schedule effects. `ReplyPlan` is the shared conversational contract; prompts express persona and register but do not decide product behavior. Add behavior to typed classification, persisted dialogue state, or the single TypeScript dialogue policy instead of adding keyword gates, punctuation heuristics, phrase libraries, or parallel worker/Python policies.

Reuse existing persistence and contracts. Decision evidence belongs in outbound message metadata and existing PostgreSQL records. Minimal dialogue continuity belongs in the existing conversation state field, and active goals come through the existing goal boundary. Do not add a reply-renderer abstraction, planner service, event bus, warehouse, dashboard, evaluator framework, or dialogue-state table.

Persist state summaries and statuses, never raw reasoning. The classifier and renderer remain stateless for a supplied turn context. TypeScript alone may mutate durable product state; model or MAF output can propose content or actions but cannot create memory, loops, follow-ups, or other side effects directly.

## UX & Interaction Patterns

The product voice is mentor-companion, not a coaching session in Slack. Inbound conversation follows the employee's topic; proactive outreach may set one agenda only when the employee is silent. Tone modes adjust register for the current turn and are not session phases. A loop offer consumes the turn's only question, survey confirmation is the reference interaction for typed consent, and unrelated greetings or updates must remain free of stored-goal pressure.

## Cross-Story Dependencies

The direct path and privacy-safe report establish the baseline for every later comparison. Turn-taking and classifier-boundary reliability must stabilize before continuity adds more context. Minimal thread and goal state then supplies the territory needed to decide whether a loop is relevant. Consent-based loops depend on that state and on the existing confirmation pattern; the shared proactive budget is the final policy layer that arbitrates loops, reminders, parked threads, and warm check-ins without creating a second outreach system.
