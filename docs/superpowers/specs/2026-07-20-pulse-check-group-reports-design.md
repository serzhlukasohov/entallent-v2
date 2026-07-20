# Pulse Check: Group Reports Design

**Date:** 2026-07-20  
**Status:** Draft

## Overview

The Pulse Check feature collects employee sentiment across 5 dimensions through natural conversation. When enough evidence is gathered for a dimension group, the agent confirms its understanding with the employee, then generates an anonymised report for the team manager via Slack.

This document covers the full two-level flow: hidden employee-level scoring → team-level manager report.

---

## Question Groups

Questions are organised into 5 groups. Each group has exactly 3 questions.

| Group | Response type |
|---|---|
| Autonomy | open-ended |
| Growth | open-ended |
| Purpose | open-ended |
| Belonging | open-ended |
| Engagement | numeric 0–10 |

The existing Q12 questions are remapped to these groups via a DB migration. The Engagement group requires 3 new questions (`engagement_nps`, `engagement_motivation`, `engagement_current`) added to the active survey definition.

---

## Data Model Changes

### 1. `survey_questions` — two new columns

```
question_group   TEXT NOT NULL  -- 'autonomy' | 'growth' | 'purpose' | 'belonging' | 'engagement'
response_type    TEXT NOT NULL  -- 'open_ended' | 'numeric_0_10'
```

### 2. New table: `survey_group_states`

Tracks the lifecycle of one group for one employee in one survey window.

```sql
CREATE TABLE survey_group_states (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_window_id   UUID NOT NULL REFERENCES survey_windows(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question_group     TEXT NOT NULL,   -- 'autonomy' | 'growth' | 'purpose' | 'belonging' | 'engagement'
  status             TEXT NOT NULL DEFAULT 'in_progress',
                     -- 'in_progress' | 'pending_confirmation' | 'confirmed' | 'report_sent'
  ai_summary         TEXT,            -- generated summary awaiting employee confirmation
  employee_score     NUMERIC(5,2),    -- 0–100, calculated after confirmation
  personal_recs      JSONB,           -- hidden per-employee recommendations
  confirmed_at       TIMESTAMPTZ,
  report_sent_at     TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (survey_window_id, user_id, question_group)
);
```

### 3. New tables: `teams` + `team_memberships`

Source of truth for manager–employee relationships. Slack is only a delivery channel.

```sql
CREATE TABLE teams (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  manager_slack_user_id  TEXT,   -- Slack user ID for report delivery
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE team_memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member',  -- 'member' | 'manager'
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at     TIMESTAMPTZ   -- soft delete; NULL = currently active
);
```

Active team size = `COUNT(*) WHERE role = 'member' AND left_at IS NULL`.

---

## Evidence Pipeline: Group Completion Check

After every `surveyRepo.upsertAssessment()` call in `SurveyEvidenceExtractionUseCase`, the use case runs a group completion check (idempotent):

```
1. Find the question_group of the just-assessed question
2. Load all 3 questions in that group
3. Load their assessments for the current survey_window
4. If ALL 3 assessments have status ∈ {partially_covered, covered, scored}:
   a. Check survey_group_states for this (window, user, group)
   b. If no row exists → INSERT with status='pending_confirmation'
                       → enqueue 'group-confirmation' job
   c. If row already exists → do nothing (idempotent)
```

---

## Two New BullMQ Processors

### `GroupConfirmationProcessor` (queue: `group-confirmation`)

**Input:** `{ surveyWindowId, userId, tenantId, questionGroup }`

1. Load all evidence and confirmed assessments for the 3 questions in the group
2. Call AI: generate a first-person summary in the employee's language:
   _"Based on our conversations, it seems like... Is that a fair reflection of how you feel?"_
3. Save summary to `survey_group_states.ai_summary`, set `status = 'pending_confirmation'`
4. Send message to employee via Slack (through existing outbox)

### `GroupReportProcessor` (queue: `group-report`)

**Input:** `{ teamId, questionGroup }`

Note: there is no single `surveyWindowId` at team scope — each employee has their own window. The processor joins via `team_memberships → users → survey_group_states` for the current period.

**Anonymity gate (checked first):**
```
confirmed_count = COUNT of survey_group_states WHERE
  status = 'confirmed' AND question_group = X AND user_id IN team members (current period)

required = MAX(5, CEIL(0.8 × active_team_size))

if confirmed_count < required → exit without sending
```

If threshold is met:
1. Calculate team score = arithmetic mean of `employee_score` for all confirmed members
2. Calculate trend: compare to the previous quarter's team mean for this group.
   If no prior period exists → show "No prior data" instead of a trend indicator.
3. Call AI with all confirmed `ai_summary` texts from the team:
   - Generate explanation: why is the score at this level?
   - Generate 3 action items
4. Format and send Slack message to `teams.manager_slack_user_id`
5. Update `survey_group_states.report_sent_at` for all confirmed members

---

## Scoring Formulas

### Engagement (primary metric)

```
Engagement Index = ((Q1 + Q2 + Q3) / 3) × 10
```

Where Q1, Q2, Q3 are the employee's 0–10 answers stated in conversation. Result: 0–100.

**Numeric extraction:** The existing evidence pipeline captures polarity/strength, not raw numbers. For `response_type = 'numeric_0_10'` questions, the AI evaluator is extended to extract and return the specific integer the employee stated (e.g. "I'd say a 7"). This extracted value is stored alongside the evidence record. During scoring, `GroupConfirmationProcessor` reads these extracted values to compute Q1, Q2, Q3. If no explicit number was stated (employee only implied sentiment), the question falls back to the open-ended formula: `structured_score × 10` on a 0–10 scale.

### Autonomy / Growth / Purpose / Belonging

For each of the 3 questions in the group:

```
structured_score = 1.0 (positive) | 0.5 (neutral) | 0.0 (negative)
sentiment_score  = LLM score 0.0–1.0 derived from the confirmed AI summary

question_score = 0.7 × structured_score + 0.3 × sentiment_score
```

```
Group Index = MEAN(question_scores) × 100   → 0–100
```

Rules:
- Missing answers are ignored (no zero-fill in MVP)
- Equal weight per question in MVP
- `employee_score` is stored in `survey_group_states` after confirmation, never exposed to the manager directly

### Team score (manager report)

```
team_score = MEAN(employee_score) across all confirmed team members
```

Pure arithmetic mean — no AI involvement in the number itself.

---

## Confirmation Flow (Conversation Orchestrator)

`ConversationOrchestrator` adds a pre-generation step:

1. Check `survey_group_states` for this user: any row with `status = 'pending_confirmation'`?
2. If yes: classify the employee's latest message as `confirmed` or `needs_correction` (AI call)
3. If `confirmed`:
   - Calculate `employee_score` using the scoring formula
   - Store `personal_recs` (AI-generated, hidden, based on weakest signals + negative sentiment)
   - Set `status = 'confirmed'`, record `confirmed_at`
   - Enqueue `group-report` job
4. If `needs_correction`:
   - AI updates `ai_summary` to incorporate corrections
   - Re-send updated summary to employee for another round of confirmation

---

## Manager Slack Report Format

```
📊 *Autonomy* — Q3 2026

Score: *51 / 100*  ↑ +11 from last period

*What's happening:*
Most of the team understands their responsibilities, but feels their
ideas rarely make it into execution. There's a sense of limited
autonomy in deciding how to approach tasks.

*3 steps to improve:*
• When an idea isn't picked up, explain why — closes the feedback loop
• Give more ownership over approach, not just outcomes
• Short check-ins: "What's slowing you down?"

───────────────────────────────
_Based on responses from 8 team members. Results are anonymous._
```

Scores are shown on 0–100 scale. The team member count is included for transparency about sample size without identifying individuals.

---

## Anonymity Requirements

- The report is only sent when `confirmed_count >= MAX(5, CEIL(0.8 × active_team_size))`
- If `active_team_size < 5`, no report is ever sent for this team
- Individual `employee_score` values are never included in any manager-facing output
- AI summaries used in the manager report are aggregated — no per-employee breakdown
- The "N team members" count in the Slack message is the only individual-count signal exposed

---

## Personal Recommendations (Hidden Layer)

After employee confirmation, the system generates per-employee recommendations per dimension:
- Based on weakest signals and negative sentiment in the confirmed summary
- Stored in `survey_group_states.personal_recs` (JSONB)
- Not shown to employee, manager, or anyone in MVP
- Reserved for future features (e.g., personalised coaching prompts, follow-up scheduling)
- If a motivation persona exists on the user record: include as enrichment context for AI generation

---

## Out of Scope (MVP)

- Skip-level or cross-team reporting
- Email delivery of manager reports
- Employee-facing score dashboard
- Automatic re-surveys when a window closes
- Multi-manager teams (one manager per team in MVP)
