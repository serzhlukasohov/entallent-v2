# ADR-011: Mentor-Companion Dialogue Architecture

**Status:** Accepted  
**Date:** 2026-08-18

## Context

enTalent talks to employees in Slack as an AI mentor: it remembers, checks in proactively, and measures engagement from natural conversation. The respond prompt describes a work companion that does not run a coaching session. The domain also has goals, follow-ups, and pulse probes.

Those intents were colliding. Conversation quality was being extended through prompt prohibitions, per-turn re-inference, and a second Python workflow. Goals did not reach live context. Follow-ups could be created from model confidence without asking the employee.

We needed one product identity and one expansion contract before adding more dialogue behavior.

## Decision

Adopt the **mentor-companion** model in `docs/architecture/conversation-dialogue.md`.

- Inbound turn: the employee owns the agenda. The system may reference an open loop only when the message is already in that territory.
- Proactive turn: the system may speak first, with one shared daily budget and a fixed reason priority (safety → explicit reminder → due loop → parked thread → warm check-in; pulse only if it fits).
- Open loops: the system may offer to remember/remind; TypeScript persists the loop only after consent. Silent scheduling from extractor or MAF candidates is not the owner of mentorship loops.
- `ReplyPlan` is derived from persisted `DialogueState` plus classification and risk. It is the only conversational contract both TypeScript and MAF renderers consume.
- Do not introduce a GROW session state machine in Slack.

This inherits ADR-001, ADR-005, ADR-007, and the MAF runtime spine (runtime port, TypeScript-owned side effects, deterministic policy outranks agent output).

## Consequences

**Good:**

- New conversation features have a place to land (state, policy, plan) instead of another prompt rule.
- Proactive cadence and personal follow-up become one initiative budget instead of two bots.
- Consent for loops matches the existing survey-confirmation pattern.
- MAF can stay a renderer without a second brain.

**Bad:**

- First implementation must persist dialogue state and fold today's three policy copies into one use case. That is deliberate scope, not optional polish.
- Cadence pulse check-ins will sometimes lose to a due personal loop. Pulse remains a long-horizon evidence marathon (existing product rule).
