# ADR-007: Survey as an Evidence-Based State Machine

**Status:** Accepted  
**Date:** 2025-01

## Context

Traditional pulse surveys interrupt users with explicit questionnaires. This creates survey fatigue and biased responses (users answer how they think they should, not how they feel). The system needs a way to measure employee engagement without disrupting natural conversation.

Alternatives considered:
1. **Explicit periodic surveys** — interrupt users, high abandonment, well-understood tooling
2. **NPS-style single questions** — low friction but minimal signal
3. **Passive sentiment analysis** — fast but only measures emotional valence, not structured engagement dimensions
4. **Evidence-based state machine** — extract structured evidence from natural conversation over time

## Decision

Surveys are implemented as an **evidence accumulation state machine**. Each survey question has a `status` that transitions through defined states based on accumulated evidence from natural conversations.

### States

```
unknown → partially_covered → scored
                ↑                ↓
          (more evidence)    (archived/expired)
```

- **unknown** — no signal yet for this question in this window
- **partially_covered** — some evidence but below confidence threshold
- **scored** — sufficient evidence accumulated (`confidence ≥ threshold AND completeness ≥ threshold` OR `thresholdReached=true`)

### Evidence model

Each `SurveyEvidenceRecord` captures:
- `evidenceSummary` — what was said or implied
- `polarity` — positive / negative / neutral / mixed
- `strength` — clarity of signal (0–1)
- `completeness` — how fully the question is addressed (0–1)
- `confidence` — AI confidence in extraction accuracy (0–1)
- `evaluatorVersion` — for reproducibility and A/B testing

Evidence is immutable. Assessment status is computed from evidence records, not stored directly.

### Opportunity policy

A survey probe question is only woven into a conversation when:
- The question's window is open
- The current conversation topic is relevant
- The user is not in distress (`surveyAllowed=true` from classifier)
- The question is not in cooldown
- No more than `maxFollowUpProbes` probes have been attempted this window

## Consequences

**Positive:**
- No survey fatigue — users interact naturally
- Rich longitudinal signal even without explicit answers
- Evidence is auditable — each assessment references its source messages
- Evaluator version tracked — allows re-scoring when models improve

**Negative:**
- Slower signal accumulation than direct surveys
- Requires careful suppression logic to avoid probing in inappropriate moments
- Evidence quality depends on conversation depth (shallow conversations yield shallow signal)

## Related decisions

- ADR-005 (LLMs cannot mutate state): AI proposes evidence, backend records it
- ADR-009 (Prompt versioning): Evidence is versioned by evaluator version for reproducibility
