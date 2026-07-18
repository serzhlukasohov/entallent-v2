# Survey Engine

## Overview

The survey engine measures employee engagement through natural conversation rather than explicit questionnaires. Questions are embedded as optional probes in normal AI responses. Evidence is extracted from the conversation turns and used to score each dimension.

## Survey States

Each `survey_assessment` per user per question per window progresses through:

```
unknown → insufficient_evidence → partially_covered → scored
                                                  ↑
                                         needs_review (manual flag)
                                         suppressed   (policy block)
```

| Status | Meaning |
|--------|---------|
| `unknown` | No evidence collected yet for this question |
| `insufficient_evidence` | Some evidence but below completeness threshold (0.4) |
| `partially_covered` | Completeness ≥ 0.4 but confidence threshold not met |
| `scored` | Either completeness ≥ threshold OR both polarity count and score confidence are met |
| `needs_review` | Flagged by admin for manual review |
| `suppressed` | Question blocked by safety policy (active high-risk signal) |

## Evidence Model

Each `survey_evidence` record captures one extraction event:

```typescript
{
  surveyWindowId, surveyQuestionId, userId,
  evidenceSummary: string,      // AI-extracted text summary
  polarity: 'positive' | 'negative' | 'neutral' | 'mixed',
  strength: number,             // 0–1: how strongly the evidence bears on the question
  completeness: number,         // 0–1: how much of the question is answered
  confidence: number,           // 0–1: AI confidence in extraction
  sourceMessageIds: uuid[],     // Which turns were used
  promptVersion: string,
}
```

Multiple evidence records accumulate per question per window. The assessment scorer aggregates them.

## Survey Window

A `survey_window` is created automatically for a user on the first conversation of each quarter (`findOrCreateActiveWindow`). Windows track:
- `period_start` / `period_end` — quarter bounds
- `status` — `active` | `completed`
- `coverage` — JSONB snapshot of last computed coverage

## Opportunity Policy

A survey probe is attempted when all of the following are true:
1. `SituationClassification.surveyAllowed = true` (AI classified the turn as appropriate for a probe)
2. `RiskDetection.surveyMustBeBlocked = false`
3. The `conversational_survey` feature flag is enabled for the tenant/user
4. A pending probe question exists for the user's current window

A pending probe question is one where:
- Assessment status is not `scored` or `suppressed`
- Evidence count < `maxFollowUpProbes` (typically 3)
- Cooldown since last probe has elapsed (per-question cooldown, typically 7 days)

## Scoring

`computeAssessmentStatus(evidence)`:

1. Aggregate evidence: sum completeness scores, check threshold
2. `scored` if:
   - Single evidence item crosses both completeness and confidence thresholds (e.g., ≥ 0.7 completeness + ≥ 0.7 confidence), OR
   - Accumulated completeness across all evidence items ≥ threshold
3. `partially_covered` if: total completeness ≥ 0.4
4. `insufficient_evidence` otherwise

Score value (numeric): weighted average of polarity-adjusted strength scores across evidence items. Positive polarity adds to score; negative polarity subtracts.

## Suppression

Survey activity is suppressed when:
- `risk.surveyMustBeBlocked = true` — AI determined current context is inappropriate
- Active high-risk signal on the user — mental health concerns take priority
- User has opted out (`consent_state.surveyEnabled = false`)
- Feature flag `conversational_survey` is disabled

## Global Survey Definition

Seeded in `packages/database/src/seed.ts` — three questions active by default:

| stableKey | Dimension | Meaning |
|-----------|-----------|---------|
| `role_clarity` | engagement | Does the user understand their role and responsibilities? |
| `wellbeing_at_work` | wellbeing | Is the user feeling emotionally and physically well at work? |
| `professional_growth` | growth | Does the user feel they are growing and learning in their role? |

Tenant-specific question sets can be created by inserting a `survey_definition` row with `tenant_id` set and then adding questions linked to that definition.

## Privacy Boundaries

- Individual scores are never shown to managers
- Aggregate coverage stats require cohort ≥ 5 users per dimension
- Evidence summaries are accessible only in the admin debug view (audit-logged)
- Survey probing respects user opt-out via `consent_state.surveyEnabled = false`
