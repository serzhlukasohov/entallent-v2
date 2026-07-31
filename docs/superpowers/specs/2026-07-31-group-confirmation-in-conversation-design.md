# Group confirmation woven into the conversation

**Date:** 2026-07-31
**Status:** Approved (design)

## Problem

When a question group reaches completion, the agent asks the employee to confirm
its understanding of that dimension ("Based on our conversations, it sounds like…
Is that a fair reflection?"). This confirmation gates group scoring and report
generation.

Today the confirmation is **broken as a UX**:

1. **Sent outside the conversation.** `GroupConfirmationProcessor`
   (`apps/worker/src/survey/group-confirmation.processor.ts`) sends the summary as a
   **standalone Slack DM**, bypassing the conversation orchestrator, using a fake
   `conversationId` (`group-confirm-…`). It is not saved to the `messages` table.
   It arrives mid-conversation and interrupts the employee — e.g. while they are
   answering the agent's previous question.
2. **Wrong language.** The summary is produced by `generateGroupSummary` in
   isolation from the transcript, so it comes out in English even for Russian
   conversations (weak language signal in the prompt).
3. **Reply not recognised.** `ConversationOrchestrator.handleGroupConfirmation`
   detects confirmation by **keyword match** ('да', 'yes', …) on the user's next
   message. When the employee replies substantively (answering the previous
   question, or phrasing agreement without a keyword), it is not accepted.

## Goal

The confirmation must be **part of the conversation, as one of the agent's
replies** — not a separate injected message. It keeps an explicit "did I
understand you correctly?" beat, but delivered naturally and detected by meaning.

## Approach (chosen)

**Confirmation as a response mode.** Remove the standalone processor. When a group
completes, mark it ready; on the employee's next message the orchestrator produces
a *confirmation-mode reply* through the normal response generator, then interprets
the following message with the LLM.

Alternatives considered and rejected:
- *Standalone but routed through the generator* — fixes language and persistence
  but still a separate message that can interrupt. Fails the core requirement.
- *Hybrid (weave in, else proactive fallback after silence)* — more coverage but
  two code paths. Deferred; can be added later on top of the chosen approach.

## Design

### 1. Group state machine

`survey_group_states.status` transitions:

```
in_progress ──(all group questions covered)──▶ pending_confirmation   // ripe, not yet surfaced
pending_confirmation ──(agent weaves confirm into a reply)──▶ awaiting_confirmation  // surfaced, awaiting reply
awaiting_confirmation ──(agreement)──▶ confirmed        // compute score + trigger report
awaiting_confirmation ──(correction)──▶ in_progress     // reopen; agent keeps exploring
```

New status value added: **`awaiting_confirmation`** (current values: `in_progress`,
`pending_confirmation`, `confirmed`).

Correction path (v1): on `correct`, set `in_progress` and allow one further
confirmation cycle. The completion idempotency guard in `checkGroupCompletion`
(which currently skips if any group state row exists) must be relaxed to re-fire
when the group is back in `in_progress`.

### 2. Surfacing the confirmation (Phase A)

In `ConversationOrchestrator.orchestrate`, after safety/risk checks, if a group is
in `pending_confirmation` (and no awaiting group takes precedence):

- Build a reply strategy `mode: 'confirmation'` that **suppresses survey probes and
  any follow-up question** for this turn.
- Pass `confirmationRequest: { questionGroup, evidence }` into `ResponseContext`.
- `respond.ts` gains a prompt branch instructing the model to, in THIS reply:
  1. briefly and warmly acknowledge / round off what the employee just said (no
     abrupt jump),
  2. paraphrase the agent's understanding of `questionGroup` in 2–4 sentences,
  3. end with exactly ONE question — "did I get that right?" — and ask nothing
     else, raise no new topic, include no probe.
- The reply is produced by the normal response generator, so language and tone
  match the conversation and the message is persisted to `messages`.
- After the reply is saved, set the group state to `awaiting_confirmation`.

Because the confirm reply carries only the confirm question, the employee's next
message is unambiguously a response to it — which also makes detection reliable.

### 3. Detecting the response (Phase B)

If a group is in `awaiting_confirmation`, before normal handling the orchestrator
calls a new AI method that interprets the employee's message against the summary:

`interpretConfirmationResponse(turns, summary) → { verdict: 'agree' | 'correct' | 'unclear', correctionNote? }`

- `agree` → compute `employeeScore` (existing engagement/open-ended logic in
  `handleGroupConfirmation`), set status `confirmed`, trigger group report. This
  turn's reply acknowledges and moves on (existing `topicConfirmed` response hint).
- `correct` → set status `in_progress`; the reply naturally incorporates the
  correction and the agent keeps exploring. Re-confirmation may occur later.
- `unclear` → treat as a normal turn; remain in `awaiting_confirmation` so it can
  resolve on a later message. No nagging / re-ask spam.

The keyword-matching path in `handleGroupConfirmation` is removed entirely.

### 4. Removed components

- `GroupConfirmationProcessor` (standalone DM send).
- `enqueueGroupConfirmation` call in `checkGroupCompletion` and the
  `GROUP_CONFIRMATION` queue registration.
- User-facing use of `generateGroupSummary` output (the English-prone text). The
  aiSummary may still be stored on group state for reporting/records, but is no
  longer sent raw to the employee; the confirm text is generated in-flow.

### 5. Orchestrator ordering

```
safety / risk checks
  → if group awaiting_confirmation: Phase B (interpret reply)
  → else if group pending_confirmation: Phase A (surface confirm, suppress probes)
  → else: normal flow (classify, probe pacing, respond)
```

### 6. Testing

- State transitions: complete → pending → awaiting → confirmed / reopened.
- Confirm turn suppresses survey probe and adds no extra question.
- `interpretConfirmationResponse` verdicts drive score + report (agree), reopen
  (correct), no-op (unclear).
- Confirm reply is generated via the response generator (language follows
  conversation), not a standalone send.
- Reuse existing orchestrator and survey-evidence test patterns.

## Out of scope (v1)

- Proactive fallback when the employee goes silent (hybrid approach) — future.
- Multiple simultaneous pending groups: handle one at a time (highest priority /
  oldest first); others wait.
