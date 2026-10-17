---
id: SPEC-conversation-content-filter-recovery
companions:
  - technical-design.md
sources: []
---

> **Canonical contract.** Read this file with `technical-design.md` before implementation. The technical companion records current-source evidence, options, and the staged design.

# Conversation content-filter recovery

## Why

An eligible employee's Slack messages were received and queued, but Azure rejected the classification request and the bot remained silent. Repeating the same request and carrying the rejected text into later prompts made the failure persist. Employees need a safe response; operators need an auditable outcome that does not weaken model safety or create duplicate side effects.

## Capabilities

- **CAP-1**
  - **intent:** An eligible participant understands the verified reason the bot could not answer and has a meaningful next step when a provider rejects an inbound turn for input content.
  - **success:** One typed recovery outcome is committed for the inbound ID and rendered in the participant's language with the verified reason and a fresh-context continuation action; no unsupported policy accusation, duplicate delivery, or model-derived survey, memory, reminder, or risk decision occurs.
- **CAP-2**
  - **intent:** A participant can continue a conversation after a rejected turn.
  - **success:** A subsequent acceptable turn can be processed in a fresh model-context epoch while the complete original history remains in PostgreSQL for audit.
- **CAP-3**
  - **intent:** Operators can identify why a turn stopped and reconcile its delivery state.
  - **success:** The failure phase, bounded provider reason, request correlation, committed outcome, and send status are observable without message text, prompts, secrets, or raw provider responses in logs or receipts.
- **CAP-4**
  - **intent:** Permanent safety rejections and temporary provider outages follow distinct recovery behavior.
  - **success:** A content-filter rejection causes no identical model retry or availability-breaker failure count; retryable network, 429, and 5xx failures still use bounded retries.
- **CAP-5**
  - **intent:** Operators can recover already missed turns without a burst of duplicate replies.
  - **success:** A read-only reconciliation identifies all affected inbound IDs and existing effects; any recovery action is reviewed, idempotent, and separately recorded.

## Constraints

- TypeScript application code owns outcomes and side effects; PostgreSQL is authoritative, and Redis/BullMQ only delivers committed intents. Retired MAF and `agent-service` are outside this flow.
- Preserve Azure safety enforcement. Do not automatically rephrase rejected content, retry it on a different model, or lower the filter threshold to make a request pass.
- Keep tenant and conversation ownership checks, deterministic outbound identity, and transactional effect/dispatch boundaries.
- Persist only bounded failure categories and correlation IDs; participant text and full prompts stay out of operational logs, receipts, and BMad artifacts.
- Reconcile the active CLI-uploaded worker source with a Git revision before implementation; the current checkout contains unrelated dirty edits and differs from observed production logging.

## Non-goals

- Changing Azure content-filter policy or judging whether a participant's text violates policy.
- Replaying the six historical messages automatically or generating six late replies.
- Redesigning all conversation prompts, survey scoring, or the retired MAF runtime.

## Success signal

In a synthetic input-filter fixture, the worker makes one provider call, commits and queues one localized, factually grounded explanation, records no model-derived effects, and processes a later benign turn in a fresh context epoch. The explanation is never emitted for an opaque HTTP 400 without a verified filter subtype. Transient provider failures retain their existing retry path. Production reconciliation confirms delivery and no duplicate response before any incident recovery is declared complete.

## Assumptions

- A typed recovery outcome, rendered as an honest explanation plus a next action, is preferable to a vague apology or silence for a confirmed input-filter rejection. The bot cannot give a model-generated explanation of the rejected content because generation did not occur; final copy and escalation policy require product review.

## Open Questions

- What exact wording and escalation policy should explain verified input filtering versus output filtering in Ukrainian, Russian, and English?
- Should participants be offered a confidential human review path, and which authorized role would handle it without exposing private content to managers?
- If input filtering prevents risk classification, what authorized urgent-safety triage applies, and who may view participant-private text?
- Should the already missed turns receive one reviewed contextual reply, one neutral acknowledgement, or remain operator-managed?
- Which source revision produced the active CLI-uploaded worker image?
