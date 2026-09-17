---
status: in-review
baseline_commit: 3c25e1fecc3453bd9b2300183847d60d754a69f0
---

# CAP-6 — Resolved-detail question planning

Status: In review

## Problem

The response generator receives the recent transcript, but the typed reply plan only limits question count. It does not identify employee-stated details that already close a clarification branch. In D04-03 this allowed a later question to ask whether the difficulty was rebuilding the flow or remembering the stopping point after the employee had already said they had to reconstruct the whole flow.

## Scope

- Add bounded resolved details to the existing situation classification and reply plan.
- Derive them in the existing classifier call from explicit employee statements in the recent active thread.
- Persist the bounded receipt in existing outbound `replyShape` metadata and carry it only across eligible same-session continuation turns.
- Clear resolved details on topic replacement, correction, closing, safety/crisis, confirmation, and a new session.
- Keep resolved-detail text in sanitized untrusted response context.
- Preserve the existing `maxQuestions` policy so a materially new question remains possible.

## Non-goals

- Phrase-specific matching for the payment example.
- A semantic graph, extra model call, new database state, or database migration.
- Any MAF or `agent-service` change.
- Suppressing the accepted new question after “That's really all there is to it.”

## Acceptance criteria

1. `SituationClassification` can carry a bounded list of explicit, already resolved thread details and remains compatible with older classifier payloads.
2. `buildReplyPlan` trims, deduplicates, caps, and preserves those details without setting `maxQuestions` to zero.
3. Response policy forbids asking the employee to choose between, repeat, or reconfirm a resolved detail; only a materially new gap may be questioned.
4. Resolved-detail content is sanitized and rendered outside the system prompt as untrusted context.
5. Existing details carry only within an eligible same-session active thread and are cleared at every safety, confirmation, correction, closing, new-topic, or new-session boundary.
6. The D04-03 sequence does not ask whether the difficulty was rebuilding the flow or remembering where work stopped.
7. Focused contract, application, prompt, provider/orchestrator, typecheck, lint, harness, deployment, and sequential Slack evidence pass.

## Verification plan

- RED then GREEN: contracts schema, reply-plan propagation, prompt boundary.
- Focused tests for `@entalent/contracts`, `@entalent/application`, and `@entalent/ai-openai`.
- A model-backed D04-03 simulation with a negative control that leaves one neutral question available when no detail is resolved.
- `pnpm harness:check -- --base <base-revision>`.
- Worker-only production deployment followed by preflight and sequential Slack smoke.

## Spec Change Log

- 2026-09-17 review: aligned the spec with the approved bounded `replyShape` carry-over design after prompt-only re-extraction proved nondeterministic; added deterministic session/dialogue-act and clearing boundaries. Preserve the existing one-model-call path, untrusted prompt boundary, and allowance for materially new questions.
- 2026-09-17 local verification: contracts 89/89, application focused 187/187, AI 145/145, worker 175/175, repeated model-backed D04-03 plus unresolved-detail control runs, final blind review with no findings, and harness `runs/harness/receipt-1789670481321-c35ba0e7.json` passed. Review follow-ups added deterministic clearing for any safety turn and topic replacement, priority for every newly resolved detail inside the cap, the most recent prior details in remaining cap slots, and a no-regex fallback from typed `latestUserSubstance` for same-session/same-topic substantive turns when the classifier omits `resolvedDetails`. Keep status `in-review` until worker deployment and sequential production Slack evidence pass.
