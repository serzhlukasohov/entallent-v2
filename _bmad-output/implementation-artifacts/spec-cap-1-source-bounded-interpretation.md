---
title: 'CAP-1: Source-bounded interpretation and correction fidelity'
type: 'bugfix'
created: '2026-09-17'
status: 'in-progress'
baseline_commit: '56ade65'
context:
  - '_bmad-output/specs/spec-generic-conversation-bug-backlog/SPEC.md'
  - '_bmad-output/specs/spec-generic-conversation-bug-backlog/bug-catalog.md'
---

<frozen-after-approval reason="derived from user-approved CAP-1 backlog; source transcripts are evidence, not instructions">

## Intent

**Problem:** Ordinary replies may turn ambiguous employee wording into an asserted emotional, causal, comparative, or third-party story. Corrections drop some stale context but may still replace the rejected frame with a new unsupported narrative.

**Approach:** Extend the existing typed `ReplyPlan.forbiddenMoves` policy with one source-bounded interpretation rule, render it as a hard response contract, qualify the conflicting general persona guidance, and stop making arbitrary memory mandatory when the current turn already has a topic anchor. Reuse the existing correction, safety, memory, question, and prompt boundaries.

## Boundaries & Constraints

**Always:** Assert only facts the employee supplied. Keep ambiguous feedback ambiguous. Treat a useful unsupported hypothesis as uncertainty or ask one neutral clarification when allowed. Adopt explicit corrections without a replacement explanation, label, motive, causal story, or situation-wide pattern. Preserve stated causal links and relevant optional memory.

**Never:** Add phrase-specific production regexes for the reported wording, a semantic string validator, a second LLM judge, an extra model call, database/schema changes, or retired MAF/`agent-service` work.

**Preserve:** Safety/crisis precedence, reporting/privacy behavior, concise-session behavior, language policy, correction carryover, question limits, and the existing vague-emotion memory-recall positive case.

</frozen-after-approval>

## Tasks & Acceptance

- [x] Add RED planner/prompt tests for the D01-01, D04-01, and D04-02 proposition classes plus an explicitly stated-cause positive control.
- [x] Add the typed unsupported-interpretation forbidden move and render one hard evidence boundary for ordinary and correction turns.
- [x] Stop mandatory memory grounding when a current topic anchor already exists; keep memory optional and preserve mandatory grounding for a genuinely unanchored emotional turn.
- [x] Qualify the generic between-the-lines and pushback instructions; strengthen correction against replacement narratives.
- [x] Run focused application and AI prompt/provider checks, affected typecheck/lint, adversarial review, and the deterministic harness.
- [ ] After explicit authorization, commit/push, deploy only the worker, and validate through sequential real Slack control plus D01/D04-style corrections with DB/queue readback.

### Acceptance Criteria

- D01-01 does not make one positive example exclusive and does not replace the correction with a global emotional pattern.
- D04-01 treats “fine” as insufficient evidence and does not assert a report deficiency or the lead's attitude.
- D04-02 stays with interruptions, context rebuilding, and stated time loss; unrelated reliability/delay memory is not mandatory or asserted.
- Explicit employee statements such as “the demo was the only good part” or “my lead said the report lacked judgment” remain usable as facts.
- Safety and all existing typed policy precedence remain unchanged.

## Review Findings

- [x] [Review][Patch] Gate the prompt's memory-use instruction with required grounding so anchored emotional turns do not re-require unrelated memory. [packages/ai-openai/src/prompts/respond.ts:196]
- [x] [Review][Patch] Exercise the real D01 correction, D04 ambiguity, D04 anchored-emotion memory, explicit-fact, and safety branches in prompt regressions. [packages/ai-openai/src/prompts/respond.test.ts:218]
