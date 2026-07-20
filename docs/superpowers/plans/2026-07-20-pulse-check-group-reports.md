# Pulse Check Group Reports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a conversation provides enough evidence across all 3 questions in a dimension group, the agent confirms its understanding with the employee and then sends an anonymised performance report to their manager via Slack.

**Architecture:** Two-level scoring — employee-private scores computed after confirmation, aggregated (arithmetic mean) at team level. Two new BullMQ processors (`group-confirmation`, `group-report`) handle async delivery. Group completion is detected inline in `SurveyEvidenceExtractionUseCase` after each assessment upsert. The `ConversationOrchestrator` is extended with a pre-generation step that intercepts messages when a group is `pending_confirmation`.

**Tech Stack:** NestJS/BullMQ workers, Drizzle ORM, Zod schemas, OpenAI via `@entalent/ai-openai`, Slack via existing workspace connection infrastructure.

## Global Constraints

- All TypeScript files — no `any`, no untyped casts.
- pnpm workspaces — cross-package imports via workspace packages (`@entalent/*`).
- Drizzle migrations — raw SQL files in `packages/database/migrations/`, numbered sequentially.
- Zod schemas defined in `packages/contracts/src/ai.ts` alongside existing schemas.
- New BullMQ queues must be registered in `apps/worker/src/queue/queue.module.ts`.
- Group completion threshold for report: `confirmed_count >= Math.max(5, Math.ceil(0.8 * activeTeamSize))`.
- Assessment statuses that count as "complete" for a question: `partially_covered`, `scored`.
- Tests run with `pnpm --filter <package> test` (vitest).

## Question Group Mapping

```
autonomy:   q12_expectations, q12_opinions_count, q12_strengths_opportunity
growth:     professional_growth, q12_progress_discussion, role_clarity
purpose:    q12_recognition, purpose_meaning (new), purpose_contribution (new)
belonging:  q12_supervisor_cares, wellbeing_at_work, belonging_psychological_safety (new)
engagement: engagement_nps (new, numeric_0_10), engagement_motivation (new, numeric_0_10),
            engagement_current (new, numeric_0_10)
```

---

## File Map

**New files:**
- `packages/database/migrations/0002_pulse_check_groups.sql`
- `packages/database/src/schema/teams.ts`
- `packages/database/src/schema/survey-group-states.ts`
- `packages/application/src/use-cases/group-confirmation.use-case.ts`
- `packages/application/src/use-cases/group-report.use-case.ts`
- `packages/application/src/utils/group-scoring.ts`
- `packages/application/src/utils/group-scoring.test.ts`
- `packages/ai-openai/src/prompts/group-confirmation.ts`
- `packages/ai-openai/src/prompts/group-report.ts`
- `apps/worker/src/survey/group-confirmation.processor.ts`
- `apps/worker/src/survey/group-report.processor.ts`
- `apps/worker/src/survey/repositories/team.repository.ts`
- `apps/worker/src/survey/repositories/group-state.repository.ts`

**Modified files:**
- `packages/database/src/schema/survey.ts` — add `questionGroup`, `responseType` columns to `surveyQuestions`
- `packages/database/src/schema/index.ts` — export new schema files
- `packages/database/src/seed.ts` — add `questionGroup`/`responseType` to existing questions, add 6 new questions
- `packages/application/src/types/records.ts` — extend `SurveyQuestionRecord`; add `SurveyGroupStateRecord`, `TeamRecord`, `TeamMembershipRecord`
- `packages/application/src/ports/survey.repository.port.ts` — add group state + team methods
- `packages/application/src/ports/outbox.port.ts` — add `GroupConfirmationPayload`, `GroupReportPayload`, two enqueue methods
- `packages/application/src/ports/ai-provider.port.ts` — add `generateGroupSummary`, `generateGroupReport`, `scoreSentiment`
- `packages/contracts/src/ai.ts` — add Zod schemas for group AI outputs
- `packages/application/src/use-cases/survey-evidence.use-case.ts` — add group completion check after upsertAssessment
- `packages/application/src/use-cases/conversation-orchestrator.ts` — add confirmation intercept step
- `packages/application/src/index.ts` — export new use-cases, types, payloads
- `packages/ai-openai/src/openai-provider.ts` — implement new AI methods
- `packages/ai-openai/src/ai-provider-router.ts` — forward new AI methods
- `apps/worker/src/queue/queue.module.ts` — register `GROUP_CONFIRMATION`, `GROUP_REPORT` queues
- `apps/worker/src/conversation/outbox.service.ts` — implement new enqueue methods
- `apps/worker/src/conversation/ai.service.ts` — delegate new AI methods
- `apps/worker/src/survey/survey.module.ts` — wire new processors and repos
- `apps/worker/src/conversation/conversation.module.ts` — inject `GroupStateRepository` into orchestrator

---

## Task 1: DB Migration — teams, team_memberships, survey_group_states, question_group columns

**Files:**
- Create: `packages/database/migrations/0002_pulse_check_groups.sql`
- Modify: `packages/database/src/schema/survey.ts`
- Create: `packages/database/src/schema/teams.ts`
- Create: `packages/database/src/schema/survey-group-states.ts`
- Modify: `packages/database/src/schema/index.ts`

**Interfaces:**
- Produces:
  - `surveyQuestions` table gains `question_group TEXT NOT NULL DEFAULT 'autonomy'` and `response_type TEXT NOT NULL DEFAULT 'open_ended'`
  - `teams` table
  - `team_memberships` table
  - `survey_group_states` table

- [ ] **Step 1: Write the migration SQL**

Create `packages/database/migrations/0002_pulse_check_groups.sql`:

```sql
-- Add question_group and response_type to survey_questions
ALTER TABLE survey_questions
  ADD COLUMN IF NOT EXISTS question_group TEXT NOT NULL DEFAULT 'autonomy',
  ADD COLUMN IF NOT EXISTS response_type TEXT NOT NULL DEFAULT 'open_ended';

-- Teams: source of truth for manager–employee relationships
CREATE TABLE IF NOT EXISTS teams (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  manager_slack_user_id TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Team memberships with soft-delete
CREATE TABLE IF NOT EXISTS team_memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member',
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS team_memberships_team_idx ON team_memberships(team_id) WHERE left_at IS NULL;

-- Survey group states: tracks lifecycle of one dimension group per employee per window
CREATE TABLE IF NOT EXISTS survey_group_states (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_window_id  UUID NOT NULL REFERENCES survey_windows(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question_group    TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'in_progress',
  ai_summary        TEXT,
  employee_score    NUMERIC(5,2),
  personal_recs     JSONB,
  confirmed_at      TIMESTAMPTZ,
  report_sent_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (survey_window_id, user_id, question_group)
);

CREATE INDEX IF NOT EXISTS survey_group_states_user_idx ON survey_group_states(user_id, question_group);
```

- [ ] **Step 2: Add Drizzle schema for teams**

Create `packages/database/src/schema/teams.ts`:

```typescript
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  managerSlackUserId: text('manager_slack_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teamMemberships = pgTable('team_memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp('left_at', { withTimezone: true }),
});

export type DbTeam = typeof teams.$inferSelect;
export type DbTeamMembership = typeof teamMemberships.$inferSelect;
```

- [ ] **Step 3: Add Drizzle schema for survey_group_states**

Create `packages/database/src/schema/survey-group-states.ts`:

```typescript
import { pgTable, uuid, text, numeric, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { surveyWindows } from './survey';

export const surveyGroupStates = pgTable(
  'survey_group_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    surveyWindowId: uuid('survey_window_id').notNull().references(() => surveyWindows.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    questionGroup: text('question_group').notNull(),
    status: text('status').notNull().default('in_progress'),
    aiSummary: text('ai_summary'),
    employeeScore: numeric('employee_score', { precision: 5, scale: 2 }),
    personalRecs: jsonb('personal_recs'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    reportSentAt: timestamp('report_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueWindowUserGroup: unique().on(t.surveyWindowId, t.userId, t.questionGroup),
    userGroupIdx: index('survey_group_states_user_idx').on(t.userId, t.questionGroup),
  }),
);

export type DbSurveyGroupState = typeof surveyGroupStates.$inferSelect;
```

- [ ] **Step 4: Add `questionGroup` and `responseType` columns to survey.ts schema**

In `packages/database/src/schema/survey.ts`, inside `surveyQuestions` table definition, add two new columns after `displayOrder`:

```typescript
questionGroup: text('question_group').notNull().default('autonomy'),
responseType: text('response_type').notNull().default('open_ended'),
```

- [ ] **Step 5: Export new schemas**

In `packages/database/src/schema/index.ts`, add:

```typescript
export * from './teams';
export * from './survey-group-states';
```

- [ ] **Step 6: Run migration locally to verify SQL is valid**

```bash
DATABASE_URL=postgresql://postgres:EsdyfomVVXvMWrqNPsSYTtpitHEaRICU@tokaido.proxy.rlwy.net:43079/railway \
  pnpm --filter @entalent/database run migrate
```

Expected: `Running migrations... Done` with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/database/migrations/0002_pulse_check_groups.sql \
        packages/database/src/schema/teams.ts \
        packages/database/src/schema/survey-group-states.ts \
        packages/database/src/schema/survey.ts \
        packages/database/src/schema/index.ts
git commit -m "feat(db): add teams, survey_group_states, question_group columns migration"
```

---

## Task 2: Seed — assign question_group/response_type to existing questions, add 6 new questions

**Files:**
- Modify: `packages/database/src/seed.ts`

**Interfaces:**
- Produces: All 15 survey questions in DB with correct `questionGroup` and `responseType`.

- [ ] **Step 1: Update existing questions in seed.ts**

In `packages/database/src/seed.ts`, add `questionGroup` and `responseType` to each existing question in the Q12 block. The full mapping:

```typescript
// In the questions array that gets seeded:
{ stableKey: 'role_clarity',           questionGroup: 'growth',      responseType: 'open_ended' }
{ stableKey: 'wellbeing_at_work',      questionGroup: 'belonging',   responseType: 'open_ended' }
{ stableKey: 'professional_growth',    questionGroup: 'growth',      responseType: 'open_ended' }
{ stableKey: 'q12_expectations',       questionGroup: 'autonomy',    responseType: 'open_ended' }
{ stableKey: 'q12_strengths_opportunity', questionGroup: 'autonomy', responseType: 'open_ended' }
{ stableKey: 'q12_recognition',        questionGroup: 'purpose',     responseType: 'open_ended' }
{ stableKey: 'q12_supervisor_cares',   questionGroup: 'belonging',   responseType: 'open_ended' }
{ stableKey: 'q12_opinions_count',     questionGroup: 'autonomy',    responseType: 'open_ended' }
{ stableKey: 'q12_progress_discussion',questionGroup: 'growth',      responseType: 'open_ended' }
```

Add this block to the `surveyQuestions` seed (after the existing Q12 block, same `ON CONFLICT DO NOTHING` pattern):

```typescript
const newQuestions = [
  {
    stableKey: 'purpose_meaning',
    title: 'Work Meaningfulness',
    canonicalMeaning: 'Does the employee find their work meaningful?',
    dimension: 'purpose',
    questionGroup: 'purpose',
    responseType: 'open_ended',
    displayOrder: 20,
    positiveIndicators: ['finds work fulfilling', 'feels their work matters', 'energised by their tasks', 'connected to mission'],
    negativeIndicators: ['feels work is pointless', 'going through the motions', 'no passion left', 'disconnected'],
    probeStrategies: ['Ask what part of their work they find most meaningful', 'Explore what impact their work has had recently'],
    contraindications: ['active crisis', 'resignation announced'],
    confidenceThreshold: 0.70,
    completenessThreshold: 0.65,
  },
  {
    stableKey: 'purpose_contribution',
    title: 'Contribution Clarity',
    canonicalMeaning: 'Does the employee clearly see how their work contributes to something that matters?',
    dimension: 'purpose',
    questionGroup: 'purpose',
    responseType: 'open_ended',
    displayOrder: 21,
    positiveIndicators: ['can articulate impact', 'sees the bigger picture', 'understands how work fits the mission', 'feels relevant'],
    negativeIndicators: ['unsure why they do what they do', 'feels invisible', 'work feels siloed', 'no visibility into outcomes'],
    probeStrategies: ['Ask how their recent project connects to team goals', 'Explore whether they see the outcome of their work'],
    contraindications: ['active crisis'],
    confidenceThreshold: 0.70,
    completenessThreshold: 0.65,
  },
  {
    stableKey: 'belonging_psychological_safety',
    title: 'Psychological Safety',
    canonicalMeaning: 'Does the employee feel safe speaking up with concerns, ideas, or admitting mistakes?',
    dimension: 'relationship',
    questionGroup: 'belonging',
    responseType: 'open_ended',
    displayOrder: 22,
    positiveIndicators: ['comfortable raising concerns', 'feels heard when speaking up', 'can admit mistakes', 'team is non-judgmental'],
    negativeIndicators: ['afraid to speak up', 'fears retaliation', 'hides mistakes', 'silence in meetings'],
    probeStrategies: ['Ask about the last time they raised a concern or idea', 'Explore whether they feel safe disagreeing with their manager'],
    contraindications: ['active harassment signal', 'fear of termination'],
    confidenceThreshold: 0.75,
    completenessThreshold: 0.65,
  },
  {
    stableKey: 'engagement_nps',
    title: 'eNPS',
    canonicalMeaning: 'How likely is the employee to recommend this company as a place to work? (0–10)',
    dimension: 'engagement',
    questionGroup: 'engagement',
    responseType: 'numeric_0_10',
    displayOrder: 30,
    positiveIndicators: ['would definitely recommend', 'proud to work here', 'company is great employer'],
    negativeIndicators: ['would not recommend', 'embarrassed to mention employer', 'actively discouraging others'],
    probeStrategies: ['Ask how likely they are to recommend the company to a friend on a scale of 0 to 10'],
    contraindications: ['active crisis'],
    confidenceThreshold: 0.80,
    completenessThreshold: 0.80,
  },
  {
    stableKey: 'engagement_motivation',
    title: 'Motivation Frequency',
    canonicalMeaning: 'How often does the employee feel motivated to give their best effort at work? (0–10)',
    dimension: 'engagement',
    questionGroup: 'engagement',
    responseType: 'numeric_0_10',
    displayOrder: 31,
    positiveIndicators: ['almost always motivated', 'brings best self every day', 'driven to do excellent work'],
    negativeIndicators: ['rarely motivated', 'just doing the minimum', 'phone it in', 'disengaged'],
    probeStrategies: ['Ask how often they feel motivated to give their best, from 0 (never) to 10 (always)'],
    contraindications: [],
    confidenceThreshold: 0.80,
    completenessThreshold: 0.80,
  },
  {
    stableKey: 'engagement_current',
    title: 'Current Engagement',
    canonicalMeaning: 'How engaged does the employee feel with their work right now? (0–10)',
    dimension: 'engagement',
    questionGroup: 'engagement',
    responseType: 'numeric_0_10',
    displayOrder: 32,
    positiveIndicators: ['fully absorbed', 'time flies at work', 'invested in outcomes', 'energised'],
    negativeIndicators: ['checked out', 'watching the clock', 'present but absent', 'going through motions'],
    probeStrategies: ['Ask how engaged they feel with their current work on a scale of 0 to 10'],
    contraindications: [],
    confidenceThreshold: 0.80,
    completenessThreshold: 0.80,
  },
];
```

For the upsert pattern, add to the existing questions loop — use `ON CONFLICT (survey_definition_id, stable_key) DO UPDATE SET question_group = EXCLUDED.question_group, response_type = EXCLUDED.response_type`.

- [ ] **Step 2: Run seed to verify no errors**

```bash
DATABASE_URL=postgresql://postgres:EsdyfomVVXvMWrqNPsSYTtpitHEaRICU@tokaido.proxy.rlwy.net:43079/railway \
  pnpm --filter @entalent/database run seed
```

Expected: `✓ Added ...` or `question already exists` lines, then exit 0.

- [ ] **Step 3: Verify question count in DB**

```bash
psql postgresql://postgres:EsdyfomVVXvMWrqNPsSYTtpitHEaRICU@tokaido.proxy.rlwy.net:43079/railway \
  -c "SELECT question_group, response_type, COUNT(*) FROM survey_questions GROUP BY 1,2 ORDER BY 1;"
```

Expected: 5 rows — autonomy/3, growth/3, purpose/3, belonging/3, engagement/3.

- [ ] **Step 4: Commit**

```bash
git add packages/database/src/seed.ts
git commit -m "feat(db): assign question groups and add 6 new pulse-check questions"
```

---

## Task 3: Scoring logic — group-scoring.ts with unit tests

**Files:**
- Create: `packages/application/src/utils/group-scoring.ts`
- Create: `packages/application/src/utils/group-scoring.test.ts`

**Interfaces:**
- Produces:
  - `computeEngagementIndex(q1: number, q2: number, q3: number): number` → 0–100
  - `computeOpenEndedQuestionScore(polarity: 'positive'|'neutral'|'negative', sentimentScore: number): number` → 0–1
  - `computeGroupIndex(questionScores: number[]): number` → 0–100

- [ ] **Step 1: Write the failing tests first**

Create `packages/application/src/utils/group-scoring.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeEngagementIndex, computeOpenEndedQuestionScore, computeGroupIndex } from './group-scoring';

describe('computeEngagementIndex', () => {
  it('computes average of three 0-10 scores scaled to 0-100', () => {
    expect(computeEngagementIndex(6, 8, 10)).toBeCloseTo(80, 1);
  });

  it('returns 0 for all zeros', () => {
    expect(computeEngagementIndex(0, 0, 0)).toBe(0);
  });

  it('returns 100 for all tens', () => {
    expect(computeEngagementIndex(10, 10, 10)).toBe(100);
  });

  it('rounds to two decimal places', () => {
    expect(computeEngagementIndex(1, 2, 3)).toBeCloseTo(20, 1);
  });
});

describe('computeOpenEndedQuestionScore', () => {
  it('returns 0.7 * 1 + 0.3 * sentiment for positive polarity', () => {
    expect(computeOpenEndedQuestionScore('positive', 0.8)).toBeCloseTo(0.94, 5);
  });

  it('returns 0.7 * 0.5 + 0.3 * sentiment for neutral polarity', () => {
    expect(computeOpenEndedQuestionScore('neutral', 0.5)).toBeCloseTo(0.5, 5);
  });

  it('returns 0.7 * 0 + 0.3 * sentiment for negative polarity', () => {
    expect(computeOpenEndedQuestionScore('negative', 0.2)).toBeCloseTo(0.06, 5);
  });

  it('clamps to [0, 1]', () => {
    expect(computeOpenEndedQuestionScore('positive', 1.5)).toBeLessThanOrEqual(1);
    expect(computeOpenEndedQuestionScore('negative', -0.5)).toBeGreaterThanOrEqual(0);
  });
});

describe('computeGroupIndex', () => {
  it('returns mean of question scores scaled to 100', () => {
    expect(computeGroupIndex([0.6, 0.8, 1.0])).toBeCloseTo(80, 1);
  });

  it('ignores empty array by returning 0', () => {
    expect(computeGroupIndex([])).toBe(0);
  });

  it('works with single question', () => {
    expect(computeGroupIndex([0.5])).toBeCloseTo(50, 1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter @entalent/application test -- group-scoring
```

Expected: FAIL — `computeEngagementIndex is not defined`.

- [ ] **Step 3: Implement group-scoring.ts**

Create `packages/application/src/utils/group-scoring.ts`:

```typescript
const STRUCTURED_WEIGHT = 0.7;
const SENTIMENT_WEIGHT = 0.3;

const POLARITY_STRUCTURED: Record<string, number> = {
  positive: 1.0,
  neutral: 0.5,
  negative: 0.0,
};

export function computeEngagementIndex(q1: number, q2: number, q3: number): number {
  return Math.round(((q1 + q2 + q3) / 3) * 10 * 100) / 100;
}

export function computeOpenEndedQuestionScore(
  polarity: string,
  sentimentScore: number,
): number {
  const structured = POLARITY_STRUCTURED[polarity] ?? 0.5;
  const raw = STRUCTURED_WEIGHT * structured + SENTIMENT_WEIGHT * sentimentScore;
  return Math.min(1, Math.max(0, raw));
}

export function computeGroupIndex(questionScores: number[]): number {
  if (questionScores.length === 0) return 0;
  const mean = questionScores.reduce((a, b) => a + b, 0) / questionScores.length;
  return Math.round(mean * 100 * 100) / 100;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm --filter @entalent/application test -- group-scoring
```

Expected: PASS — 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/utils/group-scoring.ts \
        packages/application/src/utils/group-scoring.test.ts
git commit -m "feat(scoring): add group scoring formulas with unit tests"
```

---

## Task 4: Type extensions — records, ports, contracts Zod schemas

**Files:**
- Modify: `packages/application/src/types/records.ts`
- Modify: `packages/application/src/ports/survey.repository.port.ts`
- Modify: `packages/application/src/ports/outbox.port.ts`
- Modify: `packages/application/src/ports/ai-provider.port.ts`
- Modify: `packages/contracts/src/ai.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**
- Produces:
  - `SurveyGroupStateRecord`, `TeamRecord`, `TeamMembershipRecord` types in records.ts
  - `SurveyQuestionRecord` gains `questionGroup: string` and `responseType: string`
  - `SurveyRepositoryPort` gains 5 new methods (see step 2)
  - `OutboxPort` gains `enqueueGroupConfirmation`, `enqueueGroupReport`
  - `AiProviderPort` gains `generateGroupSummary`, `generateGroupReport`, `scoreSentiment`
  - Zod schemas `GroupSummarySchema`, `GroupReportSchema`, `SentimentScoreSchema` in contracts

- [ ] **Step 1: Extend records.ts**

In `packages/application/src/types/records.ts`, add `questionGroup` and `responseType` to `SurveyQuestionRecord`:

```typescript
export interface SurveyQuestionRecord {
  // ... existing fields ...
  questionGroup: string;   // 'autonomy' | 'growth' | 'purpose' | 'belonging' | 'engagement'
  responseType: string;    // 'open_ended' | 'numeric_0_10'
}
```

Then add new record types at the end of the file:

```typescript
export interface SurveyGroupStateRecord {
  id: string;
  surveyWindowId: string;
  userId: string;
  tenantId: string;
  questionGroup: string;
  status: string;  // 'in_progress' | 'pending_confirmation' | 'confirmed' | 'report_sent'
  aiSummary: string | null;
  employeeScore: number | null;
  personalRecs: unknown | null;
  confirmedAt: Date | null;
  reportSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamRecord {
  id: string;
  tenantId: string;
  name: string;
  managerSlackUserId: string | null;
  createdAt: Date;
}

export interface TeamMembershipRecord {
  id: string;
  teamId: string;
  userId: string;
  role: string;
  joinedAt: Date;
  leftAt: Date | null;
}
```

- [ ] **Step 2: Extend survey.repository.port.ts**

Add to `SurveyRepositoryPort` interface:

```typescript
// Group state methods
findGroupState(userId: string, windowId: string, questionGroup: string): Promise<SurveyGroupStateRecord | null>;
findPendingConfirmationGroups(userId: string): Promise<SurveyGroupStateRecord[]>;
upsertGroupState(params: UpsertGroupStateParams): Promise<SurveyGroupStateRecord>;
findConfirmedGroupStates(userIds: string[], questionGroup: string): Promise<SurveyGroupStateRecord[]>;
// Team methods
findTeamByMemberId(userId: string): Promise<{ teamId: string; managerSlackUserId: string | null; activeTeamSize: number; memberUserIds: string[] } | null>;
findTeamById(teamId: string): Promise<{ teamId: string; managerSlackUserId: string | null; activeTeamSize: number; memberUserIds: string[] } | null>;
```

Add `UpsertGroupStateParams` interface:

```typescript
export interface UpsertGroupStateParams {
  surveyWindowId: string;
  userId: string;
  tenantId: string;
  questionGroup: string;
  status: string;
  aiSummary?: string;
  employeeScore?: number;
  personalRecs?: unknown;
  confirmedAt?: Date;
  reportSentAt?: Date;
}
```

Add the imports at the top:
```typescript
import type { SurveyGroupStateRecord, ... } from '../types/records';
```

- [ ] **Step 3: Extend outbox.port.ts**

Add two new payload interfaces and two new methods:

```typescript
export interface GroupConfirmationPayload {
  surveyWindowId: string;
  userId: string;
  tenantId: string;
  questionGroup: string;
  traceId: string;
}

export interface GroupReportPayload {
  teamId: string;
  questionGroup: string;
  traceId: string;
}

// Add to OutboxPort interface:
enqueueGroupConfirmation(payload: GroupConfirmationPayload): Promise<void>;
enqueueGroupReport(payload: GroupReportPayload): Promise<void>;
```

- [ ] **Step 4: Add Zod schemas to contracts/src/ai.ts**

Append to `packages/contracts/src/ai.ts`:

```typescript
// ── Group Confirmation Generator ────────────────────────────────────────────

export const GroupSummarySchema = z.object({
  summary: z.string(),         // The confirmation message to send to the employee
  sentimentScores: z.record(z.string(), z.number().min(0).max(1)), // questionId → 0–1
  extractedNumericValues: z.record(z.string(), z.number().min(0).max(10)).optional(), // stableKey → 0–10 for engagement questions
});
export type GroupSummary = z.infer<typeof GroupSummarySchema>;

// ── Group Report Generator ───────────────────────────────────────────────────

export const GroupReportSchema = z.object({
  explanation: z.string(),     // Why is the score at this level (3-4 sentences)
  actionItems: z.array(z.string()).length(3), // Exactly 3 action items
});
export type GroupReport = z.infer<typeof GroupReportSchema>;

// ── Sentiment Scorer ─────────────────────────────────────────────────────────

export const SentimentScoreSchema = z.object({
  score: z.number().min(0).max(1),  // 0 = strongly negative, 1 = strongly positive
});
export type SentimentScore = z.infer<typeof SentimentScoreSchema>;
```

- [ ] **Step 5: Extend ai-provider.port.ts**

Add imports and three new method signatures:

```typescript
import type { GroupSummary, GroupReport } from '@entalent/contracts';

// Add to AiProviderPort interface:
generateGroupSummary(
  summaries: Array<{ questionId: string; stableKey: string; evidenceSummary: string; polarity: string }>,
  questionGroup: string,
): Promise<GroupSummary>;

generateGroupReport(
  teamSummaries: string[],
  questionGroup: string,
  teamScore: number,
  trend: number | null,
): Promise<GroupReport>;

scoreSentiment(text: string): Promise<number>;
```

- [ ] **Step 6: Export new types from application/src/index.ts**

Add to `packages/application/src/index.ts`:

```typescript
export type { SurveyGroupStateRecord, TeamRecord, TeamMembershipRecord } from './types/records';
export type { UpsertGroupStateParams } from './ports/survey.repository.port';
export type { GroupConfirmationPayload, GroupReportPayload } from './ports/outbox.port';
export { GroupConfirmationUseCase } from './use-cases/group-confirmation.use-case';
export type { GroupConfirmationInput } from './use-cases/group-confirmation.use-case';
export { GroupReportUseCase } from './use-cases/group-report.use-case';
export type { GroupReportInput } from './use-cases/group-report.use-case';
```

- [ ] **Step 7: Build contracts and application packages to check types compile**

```bash
pnpm --filter @entalent/contracts build && pnpm --filter @entalent/application build
```

Expected: Both build with no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add packages/application/src/types/records.ts \
        packages/application/src/ports/survey.repository.port.ts \
        packages/application/src/ports/outbox.port.ts \
        packages/application/src/ports/ai-provider.port.ts \
        packages/contracts/src/ai.ts \
        packages/application/src/index.ts
git commit -m "feat(types): add group state records, ports, and AI contract schemas"
```

---

## Task 5: AI prompts + OpenAI provider implementation

**Files:**
- Create: `packages/ai-openai/src/prompts/group-confirmation.ts`
- Create: `packages/ai-openai/src/prompts/group-report.ts`
- Modify: `packages/ai-openai/src/openai-provider.ts`
- Modify: `packages/ai-openai/src/ai-provider-router.ts`
- Modify: `apps/worker/src/conversation/ai.service.ts`

**Interfaces:**
- Consumes: `GroupSummarySchema`, `GroupReportSchema`, `SentimentScoreSchema` from `@entalent/contracts`
- Produces: `OpenAiProvider` and `AiService` implement the 3 new methods

- [ ] **Step 1: Create group-confirmation prompt**

Create `packages/ai-openai/src/prompts/group-confirmation.ts`:

```typescript
import type { ConversationTurn } from '@entalent/application';
import { sanitizeTurnContent, INJECTION_GUARD } from './sanitize';

export function buildGroupConfirmationSystemPrompt(questionGroup: string): string {
  return `You are an empathetic AI mentor summarising what you have learned about an employee in the "${questionGroup}" dimension of their work experience.

Your goal: write a short, warm confirmation message that the employee can say "yes, that's right" or "actually, let me clarify" to.

Rules:
- Write in the same language as the conversation (Russian if the conversation is in Russian)
- Write in first person from the AI mentor's perspective: "Based on our conversations, it sounds like..."
- Be specific about what they said — don't paraphrase vaguely
- End with a clear invite to confirm or correct: "Is that a fair reflection of how you're feeling?"
- Keep it under 150 words
- For sentimentScores: score each piece of evidence 0.0 (very negative) to 1.0 (very positive) based on the employee's attitude
- For extractedNumericValues: if the employee gave a specific number on a 0-10 scale, extract it (stableKey → value). Only include if an explicit number was stated.

Return JSON only:
{
  "summary": "Your confirmation message here",
  "sentimentScores": { "questionId": 0.0 },
  "extractedNumericValues": { "stableKey": 7 }
}${INJECTION_GUARD}`;
}

export function buildGroupConfirmationUserPrompt(
  summaries: Array<{ questionId: string; stableKey: string; evidenceSummary: string; polarity: string }>,
  questionGroup: string,
): string {
  const evidenceList = summaries
    .map((s) => `[${s.stableKey} — ${s.polarity}]: ${sanitizeTurnContent(s.evidenceSummary)}`)
    .join('\n\n');

  return `Dimension: ${questionGroup}

Evidence gathered from this employee's conversations:
${evidenceList}

Generate the confirmation summary.`;
}
```

- [ ] **Step 2: Create group-report prompt**

Create `packages/ai-openai/src/prompts/group-report.ts`:

```typescript
import { sanitizeTurnContent, INJECTION_GUARD } from './sanitize';

const GROUP_LABELS: Record<string, string> = {
  autonomy: 'Autonomy',
  growth: 'Growth',
  purpose: 'Purpose',
  belonging: 'Belonging',
  engagement: 'Engagement',
};

export function buildGroupReportSystemPrompt(): string {
  return `You are an organisational health analyst generating an anonymous team report for a manager.

You receive confirmed summaries from multiple team members (anonymised) and a team score.

Your output:
- explanation: 3-4 sentences explaining why the score is at its current level, based on the evidence. Be specific, cite themes. Do not mention individuals.
- actionItems: exactly 3 concrete, specific, actionable recommendations the manager can implement this week. Each under 15 words. Targeted to the specific issues raised.

Write in English. Be direct. Focus on what can change, not what is wrong.

Return JSON only:
{
  "explanation": "...",
  "actionItems": ["...", "...", "..."]
}${INJECTION_GUARD}`;
}

export function buildGroupReportUserPrompt(
  teamSummaries: string[],
  questionGroup: string,
  teamScore: number,
  trend: number | null,
): string {
  const label = GROUP_LABELS[questionGroup] ?? questionGroup;
  const trendText = trend !== null
    ? `Trend vs last period: ${trend >= 0 ? '+' : ''}${trend.toFixed(1)} points`
    : 'No prior period data available.';

  const summariesText = teamSummaries
    .map((s, i) => `Team member ${i + 1}: ${sanitizeTurnContent(s)}`)
    .join('\n\n');

  return `Dimension: ${label}
Team score: ${teamScore.toFixed(1)} / 100
${trendText}

Anonymised team member summaries:
${summariesText}

Generate the manager report.`;
}
```

- [ ] **Step 3: Implement the 3 new methods in openai-provider.ts**

In `packages/ai-openai/src/openai-provider.ts`, add imports:

```typescript
import { GroupSummarySchema, GroupReportSchema, SentimentScoreSchema } from '@entalent/contracts';
import { buildGroupConfirmationSystemPrompt, buildGroupConfirmationUserPrompt } from './prompts/group-confirmation';
import { buildGroupReportSystemPrompt, buildGroupReportUserPrompt } from './prompts/group-report';
import type { GroupSummary, GroupReport } from '@entalent/contracts';
```

Then add three new `async` methods to the `OpenAiProvider` class:

```typescript
async generateGroupSummary(
  summaries: Array<{ questionId: string; stableKey: string; evidenceSummary: string; polarity: string }>,
  questionGroup: string,
): Promise<GroupSummary> {
  const raw = await this.complete(
    buildGroupConfirmationSystemPrompt(questionGroup),
    buildGroupConfirmationUserPrompt(summaries, questionGroup),
    this.analysisModel,
  );
  return GroupSummarySchema.parse(JSON.parse(raw));
}

async generateGroupReport(
  teamSummaries: string[],
  questionGroup: string,
  teamScore: number,
  trend: number | null,
): Promise<GroupReport> {
  const raw = await this.complete(
    buildGroupReportSystemPrompt(),
    buildGroupReportUserPrompt(teamSummaries, questionGroup, teamScore, trend),
    this.analysisModel,
  );
  return GroupReportSchema.parse(JSON.parse(raw));
}

async scoreSentiment(text: string): Promise<number> {
  const raw = await this.complete(
    `Score the sentiment of the following text from 0.0 (very negative) to 1.0 (very positive). Return JSON: {"score": 0.0}`,
    text,
    this.analysisModel,
  );
  return SentimentScoreSchema.parse(JSON.parse(raw)).score;
}
```

- [ ] **Step 4: Forward new methods in ai-provider-router.ts**

In `packages/ai-openai/src/ai-provider-router.ts`, add the three methods to `AiProviderWithFallback`:

```typescript
async generateGroupSummary(
  summaries: Array<{ questionId: string; stableKey: string; evidenceSummary: string; polarity: string }>,
  questionGroup: string,
): Promise<GroupSummary> {
  return this.withFallback((p) => p.generateGroupSummary(summaries, questionGroup));
}

async generateGroupReport(
  teamSummaries: string[],
  questionGroup: string,
  teamScore: number,
  trend: number | null,
): Promise<GroupReport> {
  return this.withFallback((p) => p.generateGroupReport(teamSummaries, questionGroup, teamScore, trend));
}

async scoreSentiment(text: string): Promise<number> {
  return this.withFallback((p) => p.scoreSentiment(text));
}
```

Import `GroupSummary, GroupReport` from `@entalent/contracts`.

- [ ] **Step 5: Delegate from ai.service.ts**

In `apps/worker/src/conversation/ai.service.ts`, add the three delegating methods:

```typescript
import type { GroupSummary, GroupReport } from '@entalent/contracts';

generateGroupSummary(
  summaries: Array<{ questionId: string; stableKey: string; evidenceSummary: string; polarity: string }>,
  questionGroup: string,
): Promise<GroupSummary> {
  return this.provider.generateGroupSummary(summaries, questionGroup);
}

generateGroupReport(
  teamSummaries: string[],
  questionGroup: string,
  teamScore: number,
  trend: number | null,
): Promise<GroupReport> {
  return this.provider.generateGroupReport(teamSummaries, questionGroup, teamScore, trend);
}

scoreSentiment(text: string): Promise<number> {
  return this.provider.scoreSentiment(text);
}
```

- [ ] **Step 6: Build ai-openai package to verify types**

```bash
pnpm --filter @entalent/ai-openai build
```

Expected: 0 TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add packages/ai-openai/src/prompts/group-confirmation.ts \
        packages/ai-openai/src/prompts/group-report.ts \
        packages/ai-openai/src/openai-provider.ts \
        packages/ai-openai/src/ai-provider-router.ts \
        apps/worker/src/conversation/ai.service.ts
git commit -m "feat(ai): add generateGroupSummary, generateGroupReport, scoreSentiment"
```

---

## Task 6: Repository implementations — GroupStateRepository, TeamRepository, extend SurveyRepository

**Files:**
- Create: `apps/worker/src/survey/repositories/group-state.repository.ts`
- Create: `apps/worker/src/survey/repositories/team.repository.ts`
- Modify: `apps/worker/src/survey/repositories/survey.repository.ts`

**Interfaces:**
- Consumes: `surveyGroupStates`, `teams`, `teamMemberships`, `surveyQuestions`, `surveyAssessments` Drizzle tables
- Produces: Concrete implementations of all methods added to `SurveyRepositoryPort` in Task 4

- [ ] **Step 1: Implement GroupStateRepository**

Create `apps/worker/src/survey/repositories/group-state.repository.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { surveyGroupStates } from '@entalent/database';
import type { SurveyGroupStateRecord, UpsertGroupStateParams } from '@entalent/application';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class GroupStateRepository {
  constructor(private readonly db: DatabaseService) {}

  async findGroupState(
    userId: string,
    windowId: string,
    questionGroup: string,
  ): Promise<SurveyGroupStateRecord | null> {
    const [row] = await this.db.client
      .select()
      .from(surveyGroupStates)
      .where(
        and(
          eq(surveyGroupStates.userId, userId),
          eq(surveyGroupStates.surveyWindowId, windowId),
          eq(surveyGroupStates.questionGroup, questionGroup),
        ),
      )
      .limit(1);
    return row ? mapGroupState(row) : null;
  }

  async findPendingConfirmationGroups(userId: string): Promise<SurveyGroupStateRecord[]> {
    const rows = await this.db.client
      .select()
      .from(surveyGroupStates)
      .where(
        and(
          eq(surveyGroupStates.userId, userId),
          eq(surveyGroupStates.status, 'pending_confirmation'),
        ),
      );
    return rows.map(mapGroupState);
  }

  async upsertGroupState(params: UpsertGroupStateParams): Promise<SurveyGroupStateRecord> {
    const [row] = await this.db.client
      .insert(surveyGroupStates)
      .values({
        surveyWindowId: params.surveyWindowId,
        userId: params.userId,
        tenantId: params.tenantId,
        questionGroup: params.questionGroup,
        status: params.status,
        aiSummary: params.aiSummary,
        employeeScore: params.employeeScore !== undefined ? String(params.employeeScore) : undefined,
        personalRecs: params.personalRecs as never,
        confirmedAt: params.confirmedAt,
        reportSentAt: params.reportSentAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [surveyGroupStates.surveyWindowId, surveyGroupStates.userId, surveyGroupStates.questionGroup],
        set: {
          status: params.status,
          aiSummary: params.aiSummary,
          employeeScore: params.employeeScore !== undefined ? String(params.employeeScore) : undefined,
          personalRecs: params.personalRecs as never,
          confirmedAt: params.confirmedAt,
          reportSentAt: params.reportSentAt,
          updatedAt: new Date(),
        },
      })
      .returning();
    return mapGroupState(row);
  }

  async findConfirmedGroupStates(
    userIds: string[],
    questionGroup: string,
  ): Promise<SurveyGroupStateRecord[]> {
    if (userIds.length === 0) return [];
    const { inArray } = await import('drizzle-orm');
    const rows = await this.db.client
      .select()
      .from(surveyGroupStates)
      .where(
        and(
          inArray(surveyGroupStates.userId, userIds),
          eq(surveyGroupStates.questionGroup, questionGroup),
          eq(surveyGroupStates.status, 'confirmed'),
        ),
      );
    return rows.map(mapGroupState);
  }
}

function mapGroupState(row: typeof surveyGroupStates.$inferSelect): SurveyGroupStateRecord {
  return {
    id: row.id,
    surveyWindowId: row.surveyWindowId,
    userId: row.userId,
    tenantId: row.tenantId,
    questionGroup: row.questionGroup,
    status: row.status,
    aiSummary: row.aiSummary,
    employeeScore: row.employeeScore !== null ? Number(row.employeeScore) : null,
    personalRecs: row.personalRecs,
    confirmedAt: row.confirmedAt,
    reportSentAt: row.reportSentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
```

- [ ] **Step 2: Implement TeamRepository**

Create `apps/worker/src/survey/repositories/team.repository.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { eq, and, isNull, count } from 'drizzle-orm';
import { teams, teamMemberships } from '@entalent/database';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class TeamRepository {
  constructor(private readonly db: DatabaseService) {}

  async findTeamByMemberId(
    userId: string,
  ): Promise<{ teamId: string; managerSlackUserId: string | null; activeTeamSize: number; memberUserIds: string[] } | null> {
    const [membership] = await this.db.client
      .select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.userId, userId),
          eq(teamMemberships.role, 'member'),
          isNull(teamMemberships.leftAt),
        ),
      )
      .limit(1);

    if (!membership) return null;

    const [team] = await this.db.client
      .select()
      .from(teams)
      .where(eq(teams.id, membership.teamId))
      .limit(1);

    if (!team) return null;

    const members = await this.db.client
      .select({ userId: teamMemberships.userId })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.teamId, membership.teamId),
          eq(teamMemberships.role, 'member'),
          isNull(teamMemberships.leftAt),
        ),
      );

    return {
      teamId: team.id,
      managerSlackUserId: team.managerSlackUserId,
      activeTeamSize: members.length,
      memberUserIds: members.map((m) => m.userId),
    };
  }
}
```

- [ ] **Step 3: Extend SurveyRepository to include questionGroup in mapQuestion**

In `apps/worker/src/survey/repositories/survey.repository.ts`, update `mapQuestion` to include new fields:

```typescript
function mapQuestion(row: DbSurveyQuestion): SurveyQuestionRecord {
  return {
    // ... existing fields ...
    questionGroup: (row as typeof surveyQuestions.$inferSelect & { questionGroup: string }).questionGroup ?? 'autonomy',
    responseType: (row as typeof surveyQuestions.$inferSelect & { responseType: string }).responseType ?? 'open_ended',
  };
}
```

Note: TypeScript will need the Drizzle schema updated (Task 1) for proper inference. Cast via `row as any` only if needed during build — clean up after schema reflects the new columns.

- [ ] **Step 4: Build worker to verify compilation**

```bash
pnpm --filter @entalent/worker build
```

Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/survey/repositories/group-state.repository.ts \
        apps/worker/src/survey/repositories/team.repository.ts \
        apps/worker/src/survey/repositories/survey.repository.ts
git commit -m "feat(repos): add GroupStateRepository, TeamRepository, extend SurveyRepository"
```

---

## Task 7: Use cases — GroupConfirmationUseCase and GroupReportUseCase

**Files:**
- Create: `packages/application/src/use-cases/group-confirmation.use-case.ts`
- Create: `packages/application/src/use-cases/group-report.use-case.ts`

**Interfaces:**
- Consumes: `SurveyRepositoryPort` (findQuestionsForWindow, findEvidenceForQuestion, findGroupState, upsertGroupState, findTeamByMemberId, findConfirmedGroupStates), `AiProviderPort` (generateGroupSummary, generateGroupReport, scoreSentiment), `OutboxPort` (enqueueMessageSend for employee confirmation)
- Produces:
  - `GroupConfirmationUseCase.execute({ surveyWindowId, userId, tenantId, questionGroup })` — generates AI summary, saves to group state, enqueues message to employee
  - `GroupReportUseCase.execute({ teamId, questionGroup })` — checks threshold, computes team score, generates AI report, returns `{ shouldSend: boolean; slackUserId: string | null; message: string }`

- [ ] **Step 1: Implement GroupConfirmationUseCase**

Create `packages/application/src/use-cases/group-confirmation.use-case.ts`:

```typescript
import type { AiProviderPort } from '../ports/ai-provider.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import type { OutboxPort } from '../ports/outbox.port';

export interface GroupConfirmationInput {
  surveyWindowId: string;
  userId: string;
  tenantId: string;
  questionGroup: string;
  externalWorkspaceId: string;
  externalConversationId: string;
  channelType: string;
}

export class GroupConfirmationUseCase {
  constructor(
    private readonly surveyRepo: SurveyRepositoryPort,
    private readonly ai: AiProviderPort,
    private readonly outbox: OutboxPort,
  ) {}

  async execute(input: GroupConfirmationInput): Promise<void> {
    const questions = await this.surveyRepo.findQuestionsForWindow(input.surveyWindowId);
    const groupQuestions = questions.filter((q) => q.questionGroup === input.questionGroup);

    const evidenceSummaries: Array<{
      questionId: string;
      stableKey: string;
      evidenceSummary: string;
      polarity: string;
    }> = [];

    for (const q of groupQuestions) {
      const evidence = await this.surveyRepo.findEvidenceForQuestion(
        input.userId,
        q.id,
        input.surveyWindowId,
      );
      const latest = evidence.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      if (latest) {
        evidenceSummaries.push({
          questionId: q.id,
          stableKey: q.stableKey,
          evidenceSummary: latest.evidenceSummary,
          polarity: latest.polarity,
        });
      }
    }

    if (evidenceSummaries.length === 0) return;

    const groupSummary = await this.ai.generateGroupSummary(evidenceSummaries, input.questionGroup);

    await this.surveyRepo.upsertGroupState({
      surveyWindowId: input.surveyWindowId,
      userId: input.userId,
      tenantId: input.tenantId,
      questionGroup: input.questionGroup,
      status: 'pending_confirmation',
      aiSummary: groupSummary.summary,
    });

    // Send confirmation message to employee via outbox
    // Note: MessageSendPayload requires a saved messageId — use a sentinel approach.
    // The outbox enqueueGroupConfirmation will handle direct Slack send without creating a DB message.
    await this.outbox.enqueueGroupConfirmation({
      surveyWindowId: input.surveyWindowId,
      userId: input.userId,
      tenantId: input.tenantId,
      questionGroup: input.questionGroup,
      traceId: `group-confirm-${input.surveyWindowId}-${input.questionGroup}`,
    });
  }
}
```

- [ ] **Step 2: Implement GroupReportUseCase**

Create `packages/application/src/use-cases/group-report.use-case.ts`:

```typescript
import type { AiProviderPort } from '../ports/ai-provider.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import { computeGroupIndex, computeOpenEndedQuestionScore, computeEngagementIndex } from '../utils/group-scoring';

export interface GroupReportInput {
  teamId: string;
  questionGroup: string;
}

export interface GroupReportResult {
  shouldSend: boolean;
  managerSlackUserId: string | null;
  message: string;
  teamScore: number;
  confirmedCount: number;
}

export class GroupReportUseCase {
  constructor(
    private readonly surveyRepo: SurveyRepositoryPort,
    private readonly ai: AiProviderPort,
  ) {}

  async execute(input: GroupReportInput): Promise<GroupReportResult> {
    const team = await this.surveyRepo.findTeamById(input.teamId);
    if (!team) return { shouldSend: false, managerSlackUserId: null, message: '', teamScore: 0, confirmedCount: 0 };

    const required = Math.max(5, Math.ceil(0.8 * team.activeTeamSize));

    const confirmedStates = await this.surveyRepo.findConfirmedGroupStates(
      team.memberUserIds,
      input.questionGroup,
    );

    if (confirmedStates.length < required) {
      return { shouldSend: false, managerSlackUserId: null, message: '', teamScore: 0, confirmedCount: confirmedStates.length };
    }

    const scores = confirmedStates
      .filter((s) => s.employeeScore !== null)
      .map((s) => s.employeeScore as number);

    const teamScore = scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
      : 0;

    const teamSummaries = confirmedStates
      .filter((s) => s.aiSummary)
      .map((s) => s.aiSummary as string);

    const report = await this.ai.generateGroupReport(
      teamSummaries,
      input.questionGroup,
      teamScore,
      null, // trend — future: compare previous window
    );

    const groupLabel = input.questionGroup.charAt(0).toUpperCase() + input.questionGroup.slice(1);
    const message = [
      `📊 *${groupLabel}* — Q${Math.ceil((new Date().getMonth() + 1) / 3)} ${new Date().getFullYear()}`,
      ``,
      `Score: *${teamScore.toFixed(1)} / 100*`,
      ``,
      `*What's happening:*`,
      report.explanation,
      ``,
      `*3 steps to improve:*`,
      ...report.actionItems.map((item) => `• ${item}`),
      ``,
      `───────────────────────────────`,
      `_Based on responses from ${confirmedStates.length} team members. Results are anonymous._`,
    ].join('\n');

    return {
      shouldSend: true,
      managerSlackUserId: team.managerSlackUserId,
      message,
      teamScore,
      confirmedCount: confirmedStates.length,
    };
  }
}
```

- [ ] **Step 3: Build to verify types compile**

```bash
pnpm --filter @entalent/application build
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/application/src/use-cases/group-confirmation.use-case.ts \
        packages/application/src/use-cases/group-report.use-case.ts \
        packages/application/src/index.ts
git commit -m "feat(use-cases): add GroupConfirmationUseCase and GroupReportUseCase"
```

---

## Task 8: BullMQ queues + OutboxService + processors

**Files:**
- Modify: `apps/worker/src/queue/queue.module.ts`
- Modify: `apps/worker/src/conversation/outbox.service.ts`
- Create: `apps/worker/src/survey/group-confirmation.processor.ts`
- Create: `apps/worker/src/survey/group-report.processor.ts`
- Modify: `apps/worker/src/survey/survey.module.ts`

**Interfaces:**
- Consumes: `GroupConfirmationUseCase`, `GroupReportUseCase`, workspace connection infra for Slack sends
- Produces: Two new BullMQ processors registered in `SurveyModule`

- [ ] **Step 1: Register new queues in queue.module.ts**

In `apps/worker/src/queue/queue.module.ts`, add to `QUEUE_NAMES`:

```typescript
GROUP_CONFIRMATION: 'group-confirmation',
GROUP_REPORT: 'group-report',
```

And register them in `BullModule.registerQueue(...)`:

```typescript
{ name: QUEUE_NAMES.GROUP_CONFIRMATION },
{ name: QUEUE_NAMES.GROUP_REPORT },
```

- [ ] **Step 2: Implement enqueue methods in outbox.service.ts**

In `apps/worker/src/conversation/outbox.service.ts`:

Add two new queue injections to the constructor:

```typescript
@InjectQueue(QUEUE_NAMES.GROUP_CONFIRMATION) private readonly groupConfirmationQueue: Queue<GroupConfirmationPayload>,
@InjectQueue(QUEUE_NAMES.GROUP_REPORT) private readonly groupReportQueue: Queue<GroupReportPayload>,
```

Add two new BullModule queue imports to the conversation module:

```typescript
BullModule.registerQueue(
  { name: QUEUE_NAMES.GROUP_CONFIRMATION },
  { name: QUEUE_NAMES.GROUP_REPORT },
),
```

Implement the two methods:

```typescript
async enqueueGroupConfirmation(payload: GroupConfirmationPayload): Promise<void> {
  await this.groupConfirmationQueue.add('confirm', payload);
}

async enqueueGroupReport(payload: GroupReportPayload): Promise<void> {
  await this.groupReportQueue.add('report', payload);
}
```

Import `GroupConfirmationPayload`, `GroupReportPayload` from `@entalent/application`.

- [ ] **Step 3: Create GroupConfirmationProcessor**

Create `apps/worker/src/survey/group-confirmation.processor.ts`:

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import type { GroupConfirmationPayload } from '@entalent/application';
import { GroupConfirmationUseCase } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';
// Slack send helpers
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';

@Processor(QUEUE_NAMES.GROUP_CONFIRMATION)
export class GroupConfirmationProcessor extends WorkerHost {
  private readonly logger = new Logger(GroupConfirmationProcessor.name);

  constructor(
    private readonly useCase: GroupConfirmationUseCase,
    private readonly wsRepo: WorkspaceConnectionRepository,
  ) {
    super();
  }

  async process(job: Job<GroupConfirmationPayload>): Promise<void> {
    const { surveyWindowId, userId, tenantId, questionGroup, traceId } = job.data;
    this.logger.debug(`Group confirmation for user ${userId} group ${questionGroup} [${traceId}]`);

    try {
      // Get Slack connection for this user
      const ws = await this.wsRepo.findByUserId(userId, tenantId);
      if (!ws) {
        this.logger.warn(`No workspace connection for user ${userId} — skipping confirmation`);
        return;
      }

      await this.useCase.execute({
        surveyWindowId,
        userId,
        tenantId,
        questionGroup,
        externalWorkspaceId: ws.externalWorkspaceId,
        externalConversationId: ws.externalChannelId,
        channelType: ws.channelType,
      });
    } catch (err) {
      this.logger.error(`Group confirmation failed [${traceId}]:`, err);
      throw err;
    }
  }
}
```

Note: `WorkspaceConnectionRepository.findByUserId` may not exist yet — check existing repo. If not, add a `findByUserId(userId, tenantId)` method that queries `channel_accounts` or `workspace_connections` for the user's active Slack DM channel.

- [ ] **Step 4: Create GroupReportProcessor**

Create `apps/worker/src/survey/group-report.processor.ts`:

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import type { GroupReportPayload } from '@entalent/application';
import { GroupReportUseCase } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';
import { SlackSenderService } from '../message-send/slack-sender.service';

@Processor(QUEUE_NAMES.GROUP_REPORT)
export class GroupReportProcessor extends WorkerHost {
  private readonly logger = new Logger(GroupReportProcessor.name);

  constructor(
    private readonly useCase: GroupReportUseCase,
    private readonly slackSender: SlackSenderService,
  ) {
    super();
  }

  async process(job: Job<GroupReportPayload>): Promise<void> {
    const { teamId, questionGroup, traceId } = job.data;
    this.logger.debug(`Group report for team ${teamId} group ${questionGroup} [${traceId}]`);

    try {
      const result = await this.useCase.execute({ teamId, questionGroup });

      if (!result.shouldSend) {
        this.logger.debug(
          `Threshold not met for team ${teamId} group ${questionGroup}: ${result.confirmedCount} confirmed`,
        );
        return;
      }

      if (!result.managerSlackUserId) {
        this.logger.warn(`Team ${teamId} has no manager_slack_user_id — report not sent`);
        return;
      }

      await this.slackSender.sendDirectMessage(result.managerSlackUserId, result.message);
      this.logger.log(`Group report sent to manager ${result.managerSlackUserId} for group ${questionGroup}`);
    } catch (err) {
      this.logger.error(`Group report failed [${traceId}]:`, err);
      throw err;
    }
  }
}
```

Note: `SlackSenderService.sendDirectMessage` — check if this method exists in the message-send module. If only `sendMessage(channelId, text)` exists, adapt accordingly (DM channel ID for a user = their Slack user ID when opening a DM).

- [ ] **Step 5: Wire into SurveyModule**

In `apps/worker/src/survey/survey.module.ts`, add:

```typescript
import { BullModule } from '@nestjs/bullmq';
import { GroupConfirmationProcessor } from './group-confirmation.processor';
import { GroupReportProcessor } from './group-report.processor';
import { GroupConfirmationUseCase, GroupReportUseCase } from '@entalent/application';
import { GroupStateRepository } from './repositories/group-state.repository';
import { TeamRepository } from './repositories/team.repository';
import { QUEUE_NAMES } from '../queue/queue.module';

// In imports:
BullModule.registerQueue(
  { name: QUEUE_NAMES.GROUP_CONFIRMATION },
  { name: QUEUE_NAMES.GROUP_REPORT },
),

// In providers:
GroupStateRepository,
TeamRepository,
{
  provide: GroupConfirmationUseCase,
  useFactory: (surveyRepo, ai, outbox) => new GroupConfirmationUseCase(surveyRepo, ai, outbox),
  inject: [SurveyRepository, AiService, OutboxService],
},
{
  provide: GroupReportUseCase,
  useFactory: (surveyRepo, ai) => new GroupReportUseCase(surveyRepo, ai),
  inject: [SurveyRepository, AiService],
},
GroupConfirmationProcessor,
GroupReportProcessor,
```

`OutboxService` is in `ConversationModule` — export it from there or inject a simpler Slack-send service. If there's a circular dependency, create a dedicated `GroupNotificationService` inside `SurveyModule` that sends Slack messages directly using the workspace connection.

- [ ] **Step 6: Build worker**

```bash
pnpm --filter @entalent/worker build
```

Expected: 0 TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/queue/queue.module.ts \
        apps/worker/src/conversation/outbox.service.ts \
        apps/worker/src/survey/group-confirmation.processor.ts \
        apps/worker/src/survey/group-report.processor.ts \
        apps/worker/src/survey/survey.module.ts
git commit -m "feat(worker): add group-confirmation and group-report processors"
```

---

## Task 9: Group completion check in SurveyEvidenceExtractionUseCase

**Files:**
- Modify: `packages/application/src/use-cases/survey-evidence.use-case.ts`
- Modify: `packages/application/src/ports/survey.repository.port.ts` (add `findAssessmentsForWindow`)
- Modify: `apps/worker/src/survey/repositories/survey.repository.ts` (implement it)

**Interfaces:**
- Consumes: `surveyRepo.findGroupState`, `surveyRepo.upsertGroupState`, `outbox.enqueueGroupConfirmation`
- Produces: After each `upsertAssessment`, checks if the group is newly complete and enqueues `group-confirmation` if so.

- [ ] **Step 1: Add findAssessmentsForWindow to port and repo**

Add to `SurveyRepositoryPort`:

```typescript
findAssessmentsForWindow(windowId: string): Promise<Array<{ surveyQuestionId: string; status: string }>>;
```

Implement in `survey.repository.ts`:

```typescript
async findAssessmentsForWindow(windowId: string): Promise<Array<{ surveyQuestionId: string; status: string }>> {
  const rows = await this.db.client
    .select({ surveyQuestionId: surveyAssessments.surveyQuestionId, status: surveyAssessments.status })
    .from(surveyAssessments)
    .where(eq(surveyAssessments.surveyWindowId, windowId));
  return rows;
}
```

- [ ] **Step 2: Add the group completion check to survey-evidence.use-case.ts**

In `packages/application/src/use-cases/survey-evidence.use-case.ts`, after the `await this.surveyRepo.upsertAssessment(...)` call inside the evidence loop, add a call to the new private method:

```typescript
await this.checkGroupCompletion(input, window.id, ev.questionId, questions);
```

Add the private method:

```typescript
private async checkGroupCompletion(
  input: SurveyEvidenceExtractionInput,
  windowId: string,
  assessedQuestionId: string,
  allQuestions: SurveyQuestionRecord[],
): Promise<void> {
  const assessedQuestion = allQuestions.find((q) => q.id === assessedQuestionId);
  if (!assessedQuestion) return;

  const questionGroup = assessedQuestion.questionGroup;
  if (!questionGroup) return;

  // Check idempotency: if group state already exists (any status), skip
  const existingState = await this.surveyRepo.findGroupState(input.userId, windowId, questionGroup);
  if (existingState) return;

  const groupQuestions = allQuestions.filter((q) => q.questionGroup === questionGroup);
  if (groupQuestions.length === 0) return;

  const assessments = await this.surveyRepo.findAssessmentsForWindow(windowId);
  const assessmentMap = new Map(assessments.map((a) => [a.surveyQuestionId, a.status]));

  const COMPLETE_STATUSES = new Set(['partially_covered', 'scored']);
  const allComplete = groupQuestions.every((q) => COMPLETE_STATUSES.has(assessmentMap.get(q.id) ?? ''));

  if (!allComplete) return;

  // Create group state and trigger confirmation
  await this.surveyRepo.upsertGroupState({
    surveyWindowId: windowId,
    userId: input.userId,
    tenantId: input.tenantId,
    questionGroup,
    status: 'pending_confirmation',
  });

  if (this.outbox) {
    await this.outbox.enqueueGroupConfirmation({
      surveyWindowId: windowId,
      userId: input.userId,
      tenantId: input.tenantId,
      questionGroup,
      traceId: `group-completion-${windowId}-${questionGroup}`,
    });
  }
}
```

Update the constructor to accept an optional `OutboxPort`:

```typescript
constructor(
  private readonly ai: AiProviderPort,
  private readonly conversationRepo: ConversationRepositoryPort,
  private readonly surveyRepo: SurveyRepositoryPort,
  private readonly outbox?: OutboxPort,
) {}
```

Update `SurveyModule` to inject `OutboxService` when constructing `SurveyEvidenceExtractionUseCase`.

- [ ] **Step 3: Build packages**

```bash
pnpm --filter @entalent/application build && pnpm --filter @entalent/worker build
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/application/src/use-cases/survey-evidence.use-case.ts \
        packages/application/src/ports/survey.repository.port.ts \
        apps/worker/src/survey/repositories/survey.repository.ts \
        apps/worker/src/survey/survey.module.ts
git commit -m "feat(pipeline): trigger group confirmation when all 3 questions reach threshold"
```

---

## Task 10: Confirmation intercept in ConversationOrchestrator

**Files:**
- Modify: `packages/application/src/use-cases/conversation-orchestrator.ts`
- Modify: `apps/worker/src/conversation/conversation.module.ts`

**Interfaces:**
- Consumes: `SurveyRepositoryPort.findPendingConfirmationGroups`, `SurveyRepositoryPort.upsertGroupState`, `OutboxPort.enqueueGroupReport`
- Produces: When employee's message arrives and a group is `pending_confirmation`, the orchestrator classifies the reply and either confirms or updates the summary.

- [ ] **Step 1: Add confirmation intercept to ConversationOrchestrator**

In `packages/application/src/use-cases/conversation-orchestrator.ts`, add a new private method and call it early in `orchestrate()` before `classifySituation`:

```typescript
// Add after loading dbMessages and before classification:
const pendingConfirmation = this.surveyRepo
  ? await this.surveyRepo.findPendingConfirmationGroups(userId)
  : [];

let confirmationHandled = false;
if (pendingConfirmation.length > 0) {
  confirmationHandled = await this.handleGroupConfirmation(
    pendingConfirmation[0],
    turns,
    input,
  );
}
```

Add the private method:

```typescript
private async handleGroupConfirmation(
  groupState: SurveyGroupStateRecord,
  turns: ConversationTurn[],
  input: OrchestrateInput,
): Promise<boolean> {
  if (!this.aiProvider || !this.surveyRepo || !this.outbox) return false;

  // Ask AI whether the employee confirmed or wants corrections
  const lastUserTurn = [...turns].reverse().find((t) => t.role === 'user');
  if (!lastUserTurn) return false;

  const classificationPrompt = `The employee was shown this summary and asked to confirm:
"${groupState.aiSummary}"

Their response: "${lastUserTurn.content}"

Did they confirm (say yes / sounds right / correct) or request corrections?
Return JSON: {"outcome": "confirmed" | "needs_correction", "corrections": "what they want changed, if any"}`;

  // Use a lightweight classification — call classifySituation with a synthetic turn
  // We parse the result from the reasoning summary as a workaround.
  // This is a simple heuristic: look for confirmation keywords.
  const text = lastUserTurn.content.toLowerCase();
  const CONFIRM_KEYWORDS = ['да', 'yes', 'верно', 'правильно', 'согласен', 'именно', 'точно', 'ок', 'ok', 'correct', 'right', 'sounds good'];
  const isConfirmed = CONFIRM_KEYWORDS.some((kw) => text.includes(kw));

  if (isConfirmed) {
    // Compute employee_score before confirming
    let employeeScore: number | undefined;
    if (groupState.questionGroup === 'engagement') {
      // Engagement: numeric scores are stored as extractedNumericValues in the group state's aiSummary phase.
      // For MVP, fall back to structured polarity scoring if numeric values unavailable.
      const evidenceItems = await this.surveyRepo.findQuestionsForWindow(groupState.surveyWindowId)
        .then(async (questions) => {
          const groupQs = questions.filter((q) => q.questionGroup === 'engagement');
          const evidenceList = await Promise.all(
            groupQs.map((q) => this.surveyRepo!.findEvidenceForQuestion(input.userId, q.id, groupState.surveyWindowId)),
          );
          return evidenceList.flat();
        });
      const numericValues = evidenceItems
        .filter((e) => e.polarity === 'positive' || e.polarity === 'neutral' || e.polarity === 'negative')
        .slice(0, 3)
        .map((e) => ({ positive: 10, neutral: 5, negative: 0, mixed: 5 }[e.polarity] ?? 5));
      if (numericValues.length === 3) {
        const { computeEngagementIndex } = await import('../utils/group-scoring');
        employeeScore = computeEngagementIndex(numericValues[0], numericValues[1], numericValues[2]);
      }
    } else {
      // Open-ended: 0.7 × structured + 0.3 × sentiment for each question, mean × 100
      const questions = await this.surveyRepo.findQuestionsForWindow(groupState.surveyWindowId);
      const groupQs = questions.filter((q) => q.questionGroup === groupState.questionGroup);
      const { computeOpenEndedQuestionScore, computeGroupIndex } = await import('../utils/group-scoring');
      const questionScores: number[] = [];
      for (const q of groupQs) {
        const evidence = await this.surveyRepo!.findEvidenceForQuestion(input.userId, q.id, groupState.surveyWindowId);
        const latest = evidence.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        if (latest) {
          const sentimentScore = await this.aiProvider.scoreSentiment(latest.evidenceSummary);
          questionScores.push(computeOpenEndedQuestionScore(latest.polarity, sentimentScore));
        }
      }
      if (questionScores.length > 0) {
        employeeScore = computeGroupIndex(questionScores);
      }
    }

    await this.surveyRepo.upsertGroupState({
      surveyWindowId: groupState.surveyWindowId,
      userId: groupState.userId,
      tenantId: groupState.tenantId,
      questionGroup: groupState.questionGroup,
      status: 'confirmed',
      aiSummary: groupState.aiSummary ?? undefined,
      employeeScore,
      confirmedAt: new Date(),
    });

    // Trigger report generation
    const team = await this.surveyRepo.findTeamByMemberId(input.userId);
    if (team) {
      await this.outbox.enqueueGroupReport({
        teamId: team.teamId,
        questionGroup: groupState.questionGroup,
        traceId: `group-report-${groupState.surveyWindowId}-${groupState.questionGroup}`,
      });
    }
  }
  // If needs_correction: GroupConfirmationUseCase will re-run on next cycle
  // (the group state remains pending_confirmation — no change needed here)

  return true; // Signal that this message was a confirmation interaction
}
```

Add `SurveyGroupStateRecord` to imports in orchestrator.

- [ ] **Step 2: Update conversation.module.ts to inject GroupStateRepository**

In `apps/worker/src/conversation/conversation.module.ts`, add `GroupStateRepository` to imports from `SurveyModule` (it must be exported from `SurveyModule`). Pass it to the orchestrator via the `surveyRepo` slot — or create a composite adapter. The simplest approach: extend `SurveyRepository` to implement the new `findPendingConfirmationGroups` and `upsertGroupState` by delegating to `GroupStateRepository`.

Alternatively (cleanest): add `findPendingConfirmationGroups`, `upsertGroupState`, `findTeamByMemberId` methods to `SurveyRepository` directly, delegating to the two new sub-repos via injection.

- [ ] **Step 3: Export new repos from SurveyModule**

In `apps/worker/src/survey/survey.module.ts`, add `exports: [SurveyRepository, GroupStateRepository, TeamRepository]`.

- [ ] **Step 4: Build everything**

```bash
pnpm --filter @entalent/application build && pnpm --filter @entalent/worker build
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/use-cases/conversation-orchestrator.ts \
        apps/worker/src/conversation/conversation.module.ts \
        apps/worker/src/survey/survey.module.ts
git commit -m "feat(orchestrator): intercept employee confirmation messages for group summaries"
```

---

## Task 11: Deploy and smoke test

**Files:** No code changes — deployment and verification only.

- [ ] **Step 1: Build Docker images and push to Railway**

```bash
cd /Users/serzh/Documents/enTalentNew

docker buildx build --platform linux/amd64 -t ghcr.io/<your-org>/entalent-api:pulse-check ./apps/api --push
docker buildx build --platform linux/amd64 -t ghcr.io/<your-org>/entalent-worker:pulse-check ./apps/worker --push
```

Then update the Railway service to use the new image tag.

- [ ] **Step 2: Verify migration ran**

```bash
psql postgresql://postgres:EsdyfomVVXvMWrqNPsSYTtpitHEaRICU@tokaido.proxy.rlwy.net:43079/railway \
  -c "\dt survey_group_states" \
  -c "\dt teams" \
  -c "SELECT COUNT(*) FROM survey_questions WHERE question_group IS NOT NULL;"
```

Expected: tables exist, count = 15.

- [ ] **Step 3: Create a test team**

```bash
psql postgresql://postgres:EsdyfomVVXvMWrqNPsSYTtpitHEaRICU@tokaido.proxy.rlwy.net:43079/railway << 'SQL'
INSERT INTO teams (tenant_id, name, manager_slack_user_id)
VALUES ('7d1e0163-6d53-4713-bd24-254690cc5090', 'Test Team', 'U09GT50APCM')
RETURNING id;
SQL
```

Then insert a `team_memberships` row for user `3f89097d-c104-4da3-8bfd-4384a97dc269` with role `member`.

- [ ] **Step 4: Chat with the Slack bot until 3 questions in one group reach partially_covered**

Send messages about autonomy-related topics (control over work, ideas being heard, clarity of role). Check Redis queue:

```bash
node -e "
const IORedis = require('ioredis');
const r = new IORedis('redis://default:vHhSerFIufSvIoEwUKztOcMfZbDIrWaO@roundhouse.proxy.rlwy.net:22210');
r.keys('bull:group-confirmation:*').then(k => { console.log(k); r.quit(); });
"
```

Expected: a job appears in the `group-confirmation` queue.

- [ ] **Step 5: Verify confirmation message arrives in Slack**

The bot should send a summary message like "Based on our conversations, it seems like you feel..." to your Slack DM.

- [ ] **Step 6: Reply to confirm**

Send "да, верно" (or "yes, that's right"). Verify in DB:

```bash
psql ... -c "SELECT status, confirmed_at FROM survey_group_states WHERE user_id = '3f89097d-c104-4da3-8bfd-4384a97dc269';"
```

Expected: `status = 'confirmed'`, `confirmed_at` is set.

- [ ] **Step 7: Verify group-report job is in queue (will not send — team size threshold)**

Since team has only 1 member, the report won't be delivered (threshold = max(5, ceil(0.8×1)) = 5). That's correct behaviour. Verify the job was processed and logged "Threshold not met".

- [ ] **Step 8: Commit final state + tag**

```bash
git add .
git commit -m "feat: pulse check group reports — complete implementation"
git tag v0.4.0-pulse-check
```
