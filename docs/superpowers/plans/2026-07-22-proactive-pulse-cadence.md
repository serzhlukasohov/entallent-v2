# Proactive Pulse Check Cadence System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-user, per-quarter question backlog that drives structured proactive outreach — one topic every 3 days, strict group order (autonomy → belonging → growth → purpose), engagement questions reserved for the last 14 days of the quarter, with full feedback-loop tracking.

**Architecture:** New `pulse_backlog` DB table + `PulseBacklogRepositoryPort` (application package) + `PulseBacklogService` (application layer, owns the state machine) + `PulseBacklogRepository` (worker). `ProactiveCheckInUseCase` delegates probe selection to `PulseBacklogService`; `SurveyEvidenceExtractionUseCase` notifies it when a question is covered. `findPendingProbeQuestion` is removed from `SurveyRepositoryPort`.

**Tech Stack:** NestJS, BullMQ, Drizzle ORM (PostgreSQL), Vitest, TypeScript, Next.js (dashboard). Monorepo via pnpm workspaces + Turborepo.

## Global Constraints

- Engagement questions (`questionGroup = 'engagement'`) are never in the regular 12-question backlog; they unlock only when `periodEnd - now ≤ engagementUnlockDays` (default 14).
- Canonical group order for backlog init: `autonomy → belonging → growth → purpose`. Within each group: ascending `displayOrder`.
- `initializeIfNeeded` and `unlockEngagementIfNeeded` must be idempotent (safe to call on every check-in).
- `PulseBacklogService` is injected as an optional param into `SurveyEvidenceExtractionUseCase` — tests that don't supply it must keep passing without changes.
- `findPendingProbeQuestion` is fully removed from `SurveyRepositoryPort`; no backwards-compat shim.
- Default check-in gap changes from 5 → 3 days (`PROACTIVE_MIN_GAP_DAYS` env default in `packages/config/src/env.ts`).
- All new DB columns: `NOT NULL` with defaults where meaningful; nullable only when semantically required (`proactive_sent_at`, `resulted_in_coverage`, `done_at`).
- Tests run with: `pnpm --filter @entalent/application test` (Vitest). TypeScript checked with `pnpm --filter @entalent/application typecheck`.

---

### Task 1: DB Schema and Migration

**Files:**
- Create: `packages/database/src/schema/pulse-backlog.ts`
- Modify: `packages/database/src/schema/index.ts`
- Create: `packages/database/migrations/0003_pulse_backlog.sql`

**Interfaces:**
- Produces: `pulseBacklog` drizzle table, `DbPulseBacklog`, `DbNewPulseBacklog` — consumed by Tasks 4, 9, 10.

- [ ] **Step 1: Create the Drizzle schema**

Create `packages/database/src/schema/pulse-backlog.ts`:

```typescript
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { surveyWindows, surveyQuestions } from './survey';

export const pulseBacklog = pgTable(
  'pulse_backlog',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    surveyWindowId: uuid('survey_window_id')
      .notNull()
      .references(() => surveyWindows.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    surveyQuestionId: uuid('survey_question_id')
      .notNull()
      .references(() => surveyQuestions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    status: text('status').notNull().default('pending'), // pending | active | done
    ignoreCount: integer('ignore_count').notNull().default(0),
    proactiveSentAt: timestamp('proactive_sent_at', { withTimezone: true }),
    evidenceCapturedCount: integer('evidence_captured_count').notNull().default(0),
    resultedInCoverage: boolean('resulted_in_coverage'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueWindowUserQuestion: unique('pulse_backlog_window_user_question_key').on(
      t.surveyWindowId,
      t.userId,
      t.surveyQuestionId,
    ),
    userWindowIdx: index('pulse_backlog_user_window_idx').on(t.userId, t.surveyWindowId),
    statusIdx: index('pulse_backlog_status_idx').on(
      t.surveyWindowId,
      t.userId,
      t.status,
      t.position,
    ),
  }),
);

export type DbPulseBacklog = typeof pulseBacklog.$inferSelect;
export type DbNewPulseBacklog = typeof pulseBacklog.$inferInsert;
```

- [ ] **Step 2: Export from schema index**

In `packages/database/src/schema/index.ts`, add at the bottom:

```typescript
export * from './pulse-backlog';
```

- [ ] **Step 3: Write the SQL migration**

Create `packages/database/migrations/0003_pulse_backlog.sql`:

```sql
CREATE TABLE pulse_backlog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_window_id UUID NOT NULL REFERENCES survey_windows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  survey_question_id UUID NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  ignore_count INTEGER NOT NULL DEFAULT 0,
  proactive_sent_at TIMESTAMPTZ,
  evidence_captured_count INTEGER NOT NULL DEFAULT 0,
  resulted_in_coverage BOOLEAN,
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pulse_backlog_window_user_question_key UNIQUE (survey_window_id, user_id, survey_question_id)
);

CREATE INDEX pulse_backlog_user_window_idx ON pulse_backlog (user_id, survey_window_id);
CREATE INDEX pulse_backlog_status_idx ON pulse_backlog (survey_window_id, user_id, status, position);
```

- [ ] **Step 4: Verify migration runs locally**

Start the API dev server and watch the migration log:

```bash
pnpm --filter @entalent/api dev 2>&1 | head -30
```

Expected: `Migrations completed successfully` without errors. Confirm the table exists:

```bash
psql "$DATABASE_URL" -c "\d pulse_backlog"
```

Expected: table columns listed.

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/schema/pulse-backlog.ts packages/database/src/schema/index.ts packages/database/migrations/0003_pulse_backlog.sql
git commit -m "feat(db): add pulse_backlog table and migration"
```

---

### Task 2: `PulseBacklogRepositoryPort` — Port Interface

**Files:**
- Create: `packages/application/src/ports/pulse-backlog.repository.port.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**
- Consumes: `SurveyQuestionRecord` from `packages/application/src/types/records.ts` (already exported).
- Produces: `PulseBacklogRepositoryPort`, `PulseBacklogRecord`, `ResolvedIgnore`, `ProactivePulseConfig`, `DEFAULT_PULSE_CONFIG` — consumed by Tasks 3, 4, 5.

- [ ] **Step 1: Write the port**

Create `packages/application/src/ports/pulse-backlog.repository.port.ts`:

```typescript
import type { SurveyQuestionRecord } from '../types/records';

export interface PulseBacklogRecord {
  id: string;
  surveyWindowId: string;
  userId: string;
  tenantId: string;
  surveyQuestionId: string;
  position: number;
  status: 'pending' | 'active' | 'done';
  ignoreCount: number;
  proactiveSentAt: Date | null;
  evidenceCapturedCount: number;
  resultedInCoverage: boolean | null;
  doneAt: Date | null;
}

export interface ResolvedIgnore {
  questionId: string;
  newPosition: number;
  ignoreCount: number;
}

export interface ProactivePulseConfig {
  /** Days before quarter end when engagement questions unlock. Default: 14 */
  engagementUnlockDays: number;
  /** Hours after probe sent before no-response counts as ignore. Default: 48 */
  ignoreWindowHours: number;
}

export const DEFAULT_PULSE_CONFIG: ProactivePulseConfig = {
  engagementUnlockDays: 14,
  ignoreWindowHours: 48,
};

export interface PulseBacklogRepositoryPort {
  /**
   * Creates 12 backlog entries (non-engagement questions in canonical group order)
   * if no entries exist yet for this user/window pair. Idempotent.
   * Questions whose IDs are in coveredQuestionIds are created with status='done'.
   */
  initializeIfNeeded(
    userId: string,
    tenantId: string,
    windowId: string,
    questions: SurveyQuestionRecord[],
    coveredQuestionIds: Set<string>,
  ): Promise<void>;

  /**
   * Finds all 'active' entries where proactive_sent_at is older than ignoreAfterHours
   * AND no inbound message from the user exists after proactive_sent_at.
   * Moves them back to 'pending' at the end of the queue and increments ignore_count.
   * Returns the resolved entries.
   */
  resolveIgnoredEntries(
    userId: string,
    windowId: string,
    ignoreAfterHours: number,
  ): Promise<ResolvedIgnore[]>;

  /**
   * Returns the pending entry with the lowest position.
   * If engagementOnly=true, only returns entries from questionGroup='engagement'.
   * If engagementOnly=false, only returns entries from questionGroup != 'engagement'.
   */
  findNextPending(
    userId: string,
    windowId: string,
    engagementOnly: boolean,
  ): Promise<PulseBacklogRecord | null>;

  /** Sets status='active' and proactive_sent_at. */
  markActive(
    userId: string,
    windowId: string,
    questionId: string,
    sentAt: Date,
  ): Promise<void>;

  /**
   * Sets status='done', evidenceCapturedCount, and doneAt.
   * resulted_in_coverage is set to true if proactive_sent_at is NOT NULL
   * (i.e., a probe was sent before coverage); otherwise stays NULL.
   * No-op if entry is already 'done'.
   */
  markDone(
    userId: string,
    windowId: string,
    questionId: string,
    evidenceCapturedCount: number,
  ): Promise<void>;

  /**
   * Adds 3 engagement questions at the end of the queue if not already present.
   * Idempotent — uses ON CONFLICT DO NOTHING.
   */
  unlockEngagementIfNeeded(
    userId: string,
    tenantId: string,
    windowId: string,
    engagementQuestions: SurveyQuestionRecord[],
  ): Promise<void>;
}
```

- [ ] **Step 2: Add exports to application index**

In `packages/application/src/index.ts`, add after the existing port exports:

```typescript
export type { PulseBacklogRepositoryPort, PulseBacklogRecord, ResolvedIgnore, ProactivePulseConfig } from './ports/pulse-backlog.repository.port';
export { DEFAULT_PULSE_CONFIG } from './ports/pulse-backlog.repository.port';
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @entalent/application typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/application/src/ports/pulse-backlog.repository.port.ts packages/application/src/index.ts
git commit -m "feat(application): add PulseBacklogRepositoryPort"
```

---

### Task 3: `PulseBacklogService` — State Machine + Unit Tests

**Files:**
- Create: `packages/application/src/services/pulse-backlog.service.ts`
- Create: `packages/application/src/services/pulse-backlog.service.test.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**
- Consumes: `PulseBacklogRepositoryPort`, `DEFAULT_PULSE_CONFIG`, `ProactivePulseConfig` (Task 2); `SurveyRepositoryPort` (existing).
- Produces: `PulseBacklogService` class with `getNextProbeQuestion`, `recordProbeSent`, `markQuestionCovered` — consumed by Tasks 5, 6, 8.

- [ ] **Step 1: Write the failing tests**

Create `packages/application/src/services/pulse-backlog.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PulseBacklogService } from './pulse-backlog.service';
import type { PulseBacklogRepositoryPort, PulseBacklogRecord, ResolvedIgnore } from '../ports/pulse-backlog.repository.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import type { SurveyQuestionRecord, SurveyWindowRecord } from '../types/records';

const QUARTER_END_FAR = new Date(Date.now() + 90 * 86_400_000); // 90 days out
const QUARTER_END_NEAR = new Date(Date.now() + 7 * 86_400_000);  // 7 days out — within 14-day window

function makeWindow(overrides: Partial<SurveyWindowRecord> = {}): SurveyWindowRecord {
  return {
    id: 'w-1',
    tenantId: 't-1',
    userId: 'u-1',
    surveyDefinitionId: 'def-1',
    periodType: 'quarter',
    periodStart: new Date(Date.now() - 80 * 86_400_000),
    periodEnd: QUARTER_END_FAR,
    status: 'active',
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<SurveyQuestionRecord> = {}): SurveyQuestionRecord {
  return {
    id: 'q-1',
    surveyDefinitionId: 'def-1',
    stableKey: 'q12_expectations',
    title: 'Clear Expectations',
    canonicalMeaning: 'Does the employee know what is expected?',
    dimension: 'engagement',
    questionGroup: 'autonomy',
    displayOrder: 10,
    positiveIndicators: [],
    negativeIndicators: [],
    probeStrategies: [],
    contraindications: [],
    confidenceThreshold: 0.72,
    completenessThreshold: 0.65,
    minimumEvidenceCount: 2,
    cooldownDays: 14,
    maxFollowUpProbes: 3,
    responseType: 'open_ended',
    version: '1',
    ...overrides,
  };
}

function makeBacklogEntry(overrides: Partial<PulseBacklogRecord> = {}): PulseBacklogRecord {
  return {
    id: 'b-1',
    surveyWindowId: 'w-1',
    userId: 'u-1',
    tenantId: 't-1',
    surveyQuestionId: 'q-1',
    position: 1,
    status: 'pending',
    ignoreCount: 0,
    proactiveSentAt: null,
    evidenceCapturedCount: 0,
    resultedInCoverage: null,
    doneAt: null,
    ...overrides,
  };
}

function makeBacklogRepo(
  overrides: Partial<Record<keyof PulseBacklogRepositoryPort, ReturnType<typeof vi.fn>>> = {},
): PulseBacklogRepositoryPort {
  return {
    initializeIfNeeded: vi.fn().mockResolvedValue(undefined),
    resolveIgnoredEntries: vi.fn().mockResolvedValue([] as ResolvedIgnore[]),
    findNextPending: vi.fn().mockResolvedValue(makeBacklogEntry()),
    markActive: vi.fn().mockResolvedValue(undefined),
    markDone: vi.fn().mockResolvedValue(undefined),
    unlockEngagementIfNeeded: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSurveyRepo(
  window: SurveyWindowRecord | null,
  questions: SurveyQuestionRecord[] = [makeQuestion()],
  coveredIds: string[] = [],
): SurveyRepositoryPort {
  return {
    findOrCreateActiveWindow: vi.fn().mockResolvedValue(window),
    findQuestionsForWindow: vi.fn().mockResolvedValue(questions),
    findAssessmentsForWindow: vi.fn().mockResolvedValue(
      coveredIds.map((id) => ({ surveyQuestionId: id, status: 'scored' })),
    ),
    saveEvidence: vi.fn(),
    markEvidenceSuperseded: vi.fn(),
    upsertAssessment: vi.fn(),
    findEvidenceForQuestion: vi.fn().mockResolvedValue([]),
    findGroupState: vi.fn(),
    findPendingConfirmationGroups: vi.fn(),
    upsertGroupState: vi.fn(),
    findConfirmedGroupStates: vi.fn(),
    findTeamByMemberId: vi.fn(),
    findTeamById: vi.fn(),
  } as unknown as SurveyRepositoryPort;
}

describe('PulseBacklogService', () => {
  describe('getNextProbeQuestion', () => {
    it('returns null when no active window exists', async () => {
      const service = new PulseBacklogService(makeBacklogRepo(), makeSurveyRepo(null));
      const result = await service.getNextProbeQuestion('u-1', 't-1');
      expect(result).toBeNull();
    });

    it('returns null when no questions exist for the window', async () => {
      const service = new PulseBacklogService(makeBacklogRepo(), makeSurveyRepo(makeWindow(), []));
      const result = await service.getNextProbeQuestion('u-1', 't-1');
      expect(result).toBeNull();
    });

    it('initializes the backlog on first call', async () => {
      const backlogRepo = makeBacklogRepo();
      const surveyRepo = makeSurveyRepo(makeWindow());
      const service = new PulseBacklogService(backlogRepo, surveyRepo);

      await service.getNextProbeQuestion('u-1', 't-1');

      expect(backlogRepo.initializeIfNeeded).toHaveBeenCalledOnce();
    });

    it('passes covered question IDs to initializeIfNeeded', async () => {
      const q1 = makeQuestion({ id: 'q-1' });
      const q2 = makeQuestion({ id: 'q-2', stableKey: 'q12_strengths_opportunity', displayOrder: 11 });
      const backlogRepo = makeBacklogRepo();
      const surveyRepo = makeSurveyRepo(makeWindow(), [q1, q2], ['q-1']);
      const service = new PulseBacklogService(backlogRepo, surveyRepo);

      await service.getNextProbeQuestion('u-1', 't-1');

      const call = (backlogRepo.initializeIfNeeded as ReturnType<typeof vi.fn>).mock.calls[0];
      const coveredSet = call[4] as Set<string>;
      expect(coveredSet.has('q-1')).toBe(true);
      expect(coveredSet.has('q-2')).toBe(false);
    });

    it('calls resolveIgnoredEntries before finding next', async () => {
      const backlogRepo = makeBacklogRepo();
      const service = new PulseBacklogService(backlogRepo, makeSurveyRepo(makeWindow()));

      await service.getNextProbeQuestion('u-1', 't-1');

      expect(backlogRepo.resolveIgnoredEntries).toHaveBeenCalledBefore(
        backlogRepo.findNextPending as ReturnType<typeof vi.fn>,
      );
    });

    it('uses ignoreWindowHours from config when calling resolveIgnoredEntries', async () => {
      const backlogRepo = makeBacklogRepo();
      const service = new PulseBacklogService(backlogRepo, makeSurveyRepo(makeWindow()));

      await service.getNextProbeQuestion('u-1', 't-1', { engagementUnlockDays: 14, ignoreWindowHours: 72 });

      expect(backlogRepo.resolveIgnoredEntries).toHaveBeenCalledWith('u-1', 'w-1', 72);
    });

    it('returns question and windowId when pending entry found', async () => {
      const question = makeQuestion({ id: 'q-1' });
      const backlogRepo = makeBacklogRepo({
        findNextPending: vi.fn().mockResolvedValue(makeBacklogEntry({ surveyQuestionId: 'q-1' })),
      });
      const service = new PulseBacklogService(backlogRepo, makeSurveyRepo(makeWindow(), [question]));

      const result = await service.getNextProbeQuestion('u-1', 't-1');

      expect(result).toEqual({ question, windowId: 'w-1' });
    });

    it('returns null when no pending entry exists', async () => {
      const backlogRepo = makeBacklogRepo({
        findNextPending: vi.fn().mockResolvedValue(null),
      });
      const service = new PulseBacklogService(backlogRepo, makeSurveyRepo(makeWindow()));

      const result = await service.getNextProbeQuestion('u-1', 't-1');

      expect(result).toBeNull();
    });

    it('uses engagementOnly=false in regular mode', async () => {
      const backlogRepo = makeBacklogRepo();
      const service = new PulseBacklogService(backlogRepo, makeSurveyRepo(makeWindow()));

      await service.getNextProbeQuestion('u-1', 't-1');

      expect(backlogRepo.findNextPending).toHaveBeenCalledWith('u-1', 'w-1', false);
    });

    it('uses engagementOnly=true and unlocks engagement when periodEnd is within engagementUnlockDays', async () => {
      const engQuestion = makeQuestion({ id: 'q-eng', questionGroup: 'engagement', displayOrder: 30, stableKey: 'engagement_nps' });
      const regularQuestion = makeQuestion({ id: 'q-1' });
      const backlogRepo = makeBacklogRepo();
      const surveyRepo = makeSurveyRepo(makeWindow({ periodEnd: QUARTER_END_NEAR }), [regularQuestion, engQuestion]);
      const service = new PulseBacklogService(backlogRepo, surveyRepo);

      await service.getNextProbeQuestion('u-1', 't-1', { engagementUnlockDays: 14, ignoreWindowHours: 48 });

      expect(backlogRepo.unlockEngagementIfNeeded).toHaveBeenCalledOnce();
      expect(backlogRepo.findNextPending).toHaveBeenCalledWith('u-1', 'w-1', true);
    });

    it('does NOT unlock engagement when periodEnd is far away', async () => {
      const backlogRepo = makeBacklogRepo();
      const service = new PulseBacklogService(backlogRepo, makeSurveyRepo(makeWindow({ periodEnd: QUARTER_END_FAR })));

      await service.getNextProbeQuestion('u-1', 't-1');

      expect(backlogRepo.unlockEngagementIfNeeded).not.toHaveBeenCalled();
      expect(backlogRepo.findNextPending).toHaveBeenCalledWith('u-1', 'w-1', false);
    });

    it('does NOT pass engagement questions to initializeIfNeeded', async () => {
      const engQuestion = makeQuestion({ id: 'q-eng', questionGroup: 'engagement', displayOrder: 30 });
      const regularQuestion = makeQuestion({ id: 'q-1', questionGroup: 'autonomy' });
      const backlogRepo = makeBacklogRepo();
      const surveyRepo = makeSurveyRepo(makeWindow(), [engQuestion, regularQuestion]);
      const service = new PulseBacklogService(backlogRepo, surveyRepo);

      await service.getNextProbeQuestion('u-1', 't-1');

      const call = (backlogRepo.initializeIfNeeded as ReturnType<typeof vi.fn>).mock.calls[0];
      const questions = call[3] as SurveyQuestionRecord[];
      expect(questions.every((q) => q.questionGroup !== 'engagement')).toBe(true);
    });
  });

  describe('recordProbeSent', () => {
    it('calls backlogRepo.markActive with correct args', async () => {
      const backlogRepo = makeBacklogRepo();
      const service = new PulseBacklogService(backlogRepo, makeSurveyRepo(makeWindow()));
      const sentAt = new Date('2026-07-22T10:00:00Z');

      await service.recordProbeSent('u-1', 'w-1', 'q-1', sentAt);

      expect(backlogRepo.markActive).toHaveBeenCalledWith('u-1', 'w-1', 'q-1', sentAt);
    });
  });

  describe('markQuestionCovered', () => {
    it('calls backlogRepo.markDone with correct args', async () => {
      const backlogRepo = makeBacklogRepo();
      const service = new PulseBacklogService(backlogRepo, makeSurveyRepo(makeWindow()));

      await service.markQuestionCovered('u-1', 'w-1', 'q-1', 3);

      expect(backlogRepo.markDone).toHaveBeenCalledWith('u-1', 'w-1', 'q-1', 3);
    });
  });
});
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
pnpm --filter @entalent/application test -- --reporter=verbose 2>&1 | grep -E "FAIL|Error|cannot find"
```

Expected: test file fails because `PulseBacklogService` doesn't exist yet.

- [ ] **Step 3: Implement `PulseBacklogService`**

Create `packages/application/src/services/pulse-backlog.service.ts`:

```typescript
import type { PulseBacklogRepositoryPort, ProactivePulseConfig } from '../ports/pulse-backlog.repository.port';
import { DEFAULT_PULSE_CONFIG } from '../ports/pulse-backlog.repository.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import type { SurveyQuestionRecord } from '../types/records';

/** Canonical group order for backlog initialization (engagement is excluded). */
const CANONICAL_GROUP_ORDER = ['autonomy', 'belonging', 'growth', 'purpose'] as const;

export class PulseBacklogService {
  constructor(
    private readonly backlogRepo: PulseBacklogRepositoryPort,
    private readonly surveyRepo: SurveyRepositoryPort,
  ) {}

  /**
   * Returns the next probe question and its window ID, or null if nothing is pending.
   * Lazily initializes the backlog on first call. Resolves expired ignores before
   * selecting. Switches to engagement-only mode when the quarter is ending.
   */
  async getNextProbeQuestion(
    userId: string,
    tenantId: string,
    config: ProactivePulseConfig = DEFAULT_PULSE_CONFIG,
  ): Promise<{ question: SurveyQuestionRecord; windowId: string } | null> {
    const window = await this.surveyRepo.findOrCreateActiveWindow(userId, tenantId);
    if (!window) return null;

    const allQuestions = await this.surveyRepo.findQuestionsForWindow(window.id);
    if (!allQuestions.length) return null;

    const nonEngagementQuestions = allQuestions
      .filter((q) => q.questionGroup !== 'engagement')
      .sort((a, b) => {
        const gi = (g: string) => CANONICAL_GROUP_ORDER.indexOf(g as typeof CANONICAL_GROUP_ORDER[number]);
        const groupDiff = gi(a.questionGroup) - gi(b.questionGroup);
        return groupDiff !== 0 ? groupDiff : a.displayOrder - b.displayOrder;
      });

    const assessments = await this.surveyRepo.findAssessmentsForWindow(window.id);
    const coveredIds = new Set(
      assessments
        .filter((a) => a.status === 'scored' || a.status === 'covered')
        .map((a) => a.surveyQuestionId),
    );

    await this.backlogRepo.initializeIfNeeded(
      userId,
      tenantId,
      window.id,
      nonEngagementQuestions,
      coveredIds,
    );

    await this.backlogRepo.resolveIgnoredEntries(userId, window.id, config.ignoreWindowHours);

    const daysUntilEnd = (window.periodEnd.getTime() - Date.now()) / 86_400_000;
    const isEndOfQuarter = daysUntilEnd <= config.engagementUnlockDays;

    if (isEndOfQuarter) {
      const engagementQuestions = allQuestions
        .filter((q) => q.questionGroup === 'engagement')
        .sort((a, b) => a.displayOrder - b.displayOrder);
      await this.backlogRepo.unlockEngagementIfNeeded(userId, tenantId, window.id, engagementQuestions);
    }

    const entry = await this.backlogRepo.findNextPending(userId, window.id, isEndOfQuarter);
    if (!entry) return null;

    const question = allQuestions.find((q) => q.id === entry.surveyQuestionId);
    if (!question) return null;

    return { question, windowId: window.id };
  }

  /** Records that a probe was sent for a question — transitions it to 'active'. */
  async recordProbeSent(
    userId: string,
    windowId: string,
    questionId: string,
    sentAt: Date,
  ): Promise<void> {
    await this.backlogRepo.markActive(userId, windowId, questionId, sentAt);
  }

  /** Records that a question reached coverage — transitions it to 'done'. */
  async markQuestionCovered(
    userId: string,
    windowId: string,
    questionId: string,
    evidenceCount: number,
  ): Promise<void> {
    await this.backlogRepo.markDone(userId, windowId, questionId, evidenceCount);
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
pnpm --filter @entalent/application test -- --reporter=verbose
```

Expected: all tests in `pulse-backlog.service.test.ts` pass. Note: the test uses `toHaveBeenCalledBefore` which requires vitest `>=1.0`. If it fails, replace with ordering check via mock call indices.

- [ ] **Step 5: Add exports to application index**

In `packages/application/src/index.ts`, add:

```typescript
export { PulseBacklogService } from './services/pulse-backlog.service';
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @entalent/application typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/application/src/services/pulse-backlog.service.ts packages/application/src/services/pulse-backlog.service.test.ts packages/application/src/index.ts
git commit -m "feat(application): add PulseBacklogService with state machine and unit tests"
```

---

### Task 4: `PulseBacklogRepository` — NestJS Implementation

**Files:**
- Create: `apps/worker/src/survey/repositories/pulse-backlog.repository.ts`

**Interfaces:**
- Consumes: `PulseBacklogRepositoryPort` (Task 2); `pulseBacklog` drizzle table (Task 1); `surveyQuestions`, `conversations`, `messages` tables from `@entalent/database`; `DatabaseService`.
- Produces: `PulseBacklogRepository` class — consumed by Task 8 (module wiring).

- [ ] **Step 1: Write the repository**

Create `apps/worker/src/survey/repositories/pulse-backlog.repository.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { eq, and, lt, gt, asc, max, ne, sql, inArray } from 'drizzle-orm';
import {
  pulseBacklog,
  surveyQuestions,
  conversations,
  messages,
} from '@entalent/database';
import type {
  PulseBacklogRepositoryPort,
  PulseBacklogRecord,
  ResolvedIgnore,
} from '@entalent/application';
import type { SurveyQuestionRecord } from '@entalent/application';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class PulseBacklogRepository implements PulseBacklogRepositoryPort {
  constructor(private readonly db: DatabaseService) {}

  async initializeIfNeeded(
    userId: string,
    tenantId: string,
    windowId: string,
    questions: SurveyQuestionRecord[],
    coveredQuestionIds: Set<string>,
  ): Promise<void> {
    // Check if already initialized — any row for this user/window means it's done
    const [existing] = await this.db.client
      .select({ id: pulseBacklog.id })
      .from(pulseBacklog)
      .where(and(eq(pulseBacklog.userId, userId), eq(pulseBacklog.surveyWindowId, windowId)))
      .limit(1);

    if (existing) return;

    if (!questions.length) return;

    const values = questions.map((q, idx) => ({
      surveyWindowId: windowId,
      userId,
      tenantId,
      surveyQuestionId: q.id,
      position: idx + 1,
      status: coveredQuestionIds.has(q.id) ? 'done' : 'pending',
      doneAt: coveredQuestionIds.has(q.id) ? new Date() : null,
    }));

    await this.db.client.insert(pulseBacklog).values(values).onConflictDoNothing();
  }

  async resolveIgnoredEntries(
    userId: string,
    windowId: string,
    ignoreAfterHours: number,
  ): Promise<ResolvedIgnore[]> {
    const cutoff = new Date(Date.now() - ignoreAfterHours * 3_600_000);

    const activeEntries = await this.db.client
      .select()
      .from(pulseBacklog)
      .where(
        and(
          eq(pulseBacklog.userId, userId),
          eq(pulseBacklog.surveyWindowId, windowId),
          eq(pulseBacklog.status, 'active'),
          lt(pulseBacklog.proactiveSentAt, cutoff),
        ),
      );

    if (!activeEntries.length) return [];

    // For each active entry, check if user sent ANY inbound message after the probe
    const toIgnore: typeof activeEntries = [];
    for (const entry of activeEntries) {
      const [inbound] = await this.db.client
        .select({ id: messages.id })
        .from(messages)
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .where(
          and(
            eq(conversations.userId, userId),
            eq(messages.direction, 'inbound'),
            gt(messages.occurredAt, entry.proactiveSentAt!),
          ),
        )
        .limit(1);

      if (!inbound) toIgnore.push(entry);
    }

    if (!toIgnore.length) return [];

    // Find current max position to place ignored entries at the end
    const [{ maxPos }] = await this.db.client
      .select({ maxPos: max(pulseBacklog.position) })
      .from(pulseBacklog)
      .where(and(eq(pulseBacklog.userId, userId), eq(pulseBacklog.surveyWindowId, windowId)));

    let nextPos = (maxPos ?? 0) + 1;
    const resolved: ResolvedIgnore[] = [];

    for (const entry of toIgnore) {
      const newIgnoreCount = entry.ignoreCount + 1;
      await this.db.client
        .update(pulseBacklog)
        .set({
          status: 'pending',
          position: nextPos,
          ignoreCount: newIgnoreCount,
          resultedInCoverage: false,
          updatedAt: new Date(),
        })
        .where(eq(pulseBacklog.id, entry.id));

      resolved.push({
        questionId: entry.surveyQuestionId,
        newPosition: nextPos,
        ignoreCount: newIgnoreCount,
      });
      nextPos++;
    }

    return resolved;
  }

  async findNextPending(
    userId: string,
    windowId: string,
    engagementOnly: boolean,
  ): Promise<PulseBacklogRecord | null> {
    const groupFilter = engagementOnly
      ? eq(surveyQuestions.questionGroup, 'engagement')
      : ne(surveyQuestions.questionGroup, 'engagement');

    const rows = await this.db.client
      .select({
        id: pulseBacklog.id,
        surveyWindowId: pulseBacklog.surveyWindowId,
        userId: pulseBacklog.userId,
        tenantId: pulseBacklog.tenantId,
        surveyQuestionId: pulseBacklog.surveyQuestionId,
        position: pulseBacklog.position,
        status: pulseBacklog.status,
        ignoreCount: pulseBacklog.ignoreCount,
        proactiveSentAt: pulseBacklog.proactiveSentAt,
        evidenceCapturedCount: pulseBacklog.evidenceCapturedCount,
        resultedInCoverage: pulseBacklog.resultedInCoverage,
        doneAt: pulseBacklog.doneAt,
      })
      .from(pulseBacklog)
      .innerJoin(surveyQuestions, eq(pulseBacklog.surveyQuestionId, surveyQuestions.id))
      .where(
        and(
          eq(pulseBacklog.userId, userId),
          eq(pulseBacklog.surveyWindowId, windowId),
          eq(pulseBacklog.status, 'pending'),
          groupFilter,
        ),
      )
      .orderBy(asc(pulseBacklog.position))
      .limit(1);

    if (!rows.length) return null;
    return rows[0] as PulseBacklogRecord;
  }

  async markActive(
    userId: string,
    windowId: string,
    questionId: string,
    sentAt: Date,
  ): Promise<void> {
    await this.db.client
      .update(pulseBacklog)
      .set({ status: 'active', proactiveSentAt: sentAt, updatedAt: new Date() })
      .where(
        and(
          eq(pulseBacklog.userId, userId),
          eq(pulseBacklog.surveyWindowId, windowId),
          eq(pulseBacklog.surveyQuestionId, questionId),
        ),
      );
  }

  async markDone(
    userId: string,
    windowId: string,
    questionId: string,
    evidenceCapturedCount: number,
  ): Promise<void> {
    await this.db.client
      .update(pulseBacklog)
      .set({
        status: 'done',
        evidenceCapturedCount,
        // Only set resulted_in_coverage=true if a probe was actually sent
        resultedInCoverage: sql`CASE WHEN proactive_sent_at IS NOT NULL THEN true ELSE NULL END`,
        doneAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pulseBacklog.userId, userId),
          eq(pulseBacklog.surveyWindowId, windowId),
          eq(pulseBacklog.surveyQuestionId, questionId),
          ne(pulseBacklog.status, 'done'), // idempotent — don't overwrite already-done entries
        ),
      );
  }

  async unlockEngagementIfNeeded(
    userId: string,
    tenantId: string,
    windowId: string,
    engagementQuestions: SurveyQuestionRecord[],
  ): Promise<void> {
    if (!engagementQuestions.length) return;

    const [{ maxPos }] = await this.db.client
      .select({ maxPos: max(pulseBacklog.position) })
      .from(pulseBacklog)
      .where(and(eq(pulseBacklog.userId, userId), eq(pulseBacklog.surveyWindowId, windowId)));

    let nextPos = (maxPos ?? 12) + 1;

    const sorted = [...engagementQuestions].sort((a, b) => a.displayOrder - b.displayOrder);
    for (const q of sorted) {
      await this.db.client
        .insert(pulseBacklog)
        .values({
          surveyWindowId: windowId,
          userId,
          tenantId,
          surveyQuestionId: q.id,
          position: nextPos++,
          status: 'pending',
        })
        .onConflictDoNothing(); // UNIQUE constraint prevents duplicates — idempotent
    }
  }
}
```

- [ ] **Step 2: Typecheck worker**

```bash
pnpm --filter @entalent/worker typecheck 2>&1 | head -30
```

Expected: 0 errors (or only pre-existing unrelated errors).

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/survey/repositories/pulse-backlog.repository.ts
git commit -m "feat(worker): add PulseBacklogRepository"
```

---

### Task 5: Update `ProactiveCheckInUseCase` + Unit Tests

**Files:**
- Modify: `packages/application/src/use-cases/proactive-check-in.use-case.ts`
- Create: `packages/application/src/use-cases/proactive-check-in.use-case.test.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**
- Consumes: `PulseBacklogService` (Task 3); `ProactivePulseConfig`, `DEFAULT_PULSE_CONFIG` (Task 2).
- Produces: Updated `ProactiveCheckInInput` (adds optional `pulseConfig`); updated `ProactiveCheckInUseCase` constructor (removes `surveyRepo`, adds optional `pulseBacklogService`) — consumed by Task 8.

- [ ] **Step 1: Write failing tests**

Create `packages/application/src/use-cases/proactive-check-in.use-case.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProactiveCheckInUseCase } from './proactive-check-in.use-case';
import { PulseBacklogService } from '../services/pulse-backlog.service';
import type { AiProviderPort, ConversationTurn } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { OutboxPort } from '../ports/outbox.port';
import type { SurveyQuestionRecord } from '../types/records';

function makeQuestion(): SurveyQuestionRecord {
  return {
    id: 'q-1',
    surveyDefinitionId: 'def-1',
    stableKey: 'q12_expectations',
    title: 'Clear Expectations',
    canonicalMeaning: 'Does the employee know what is expected?',
    dimension: 'engagement',
    questionGroup: 'autonomy',
    displayOrder: 10,
    positiveIndicators: [],
    negativeIndicators: [],
    probeStrategies: ['Ask about their OKRs'],
    contraindications: [],
    confidenceThreshold: 0.72,
    completenessThreshold: 0.65,
    minimumEvidenceCount: 2,
    cooldownDays: 14,
    maxFollowUpProbes: 3,
    responseType: 'open_ended',
    version: '1',
  };
}

function makeConversationRepo(
  overrides: Partial<ConversationRepositoryPort> = {},
): ConversationRepositoryPort {
  return {
    findById: vi.fn().mockResolvedValue({
      id: 'c-1',
      tenantId: 't-1',
      userId: 'u-1',
      channelType: 'slack',
      externalConversationId: 'ext-c-1',
      status: 'active',
      userDisplayName: 'Alex',
    }),
    findRecentMessages: vi.fn().mockResolvedValue([
      { id: 'm-1', direction: 'inbound', text: 'Hello', occurredAt: new Date(), conversationId: 'c-1', tenantId: 't-1', userId: 'u-1', createdAt: new Date() },
    ]),
    saveMessage: vi.fn().mockResolvedValue({ id: 'out-1', conversationId: 'c-1', tenantId: 't-1', userId: 'u-1', direction: 'outbound', text: 'Hi Alex!', occurredAt: new Date(), createdAt: new Date() }),
    findMessageById: vi.fn(),
    findConversationByExternal: vi.fn(),
    ...overrides,
  } as unknown as ConversationRepositoryPort;
}

function makeAiProvider(containsSurveyProbe = false, probeQuestionId: string | null = null): AiProviderPort {
  return {
    generateResponse: vi.fn().mockResolvedValue({
      text: 'Hey Alex, how are things going with your team goals?',
      containsSurveyProbe,
      surveyProbeQuestionId: probeQuestionId,
    }),
    evaluateSurveyEvidence: vi.fn(),
    generateGroupSummary: vi.fn(),
    classifyIntent: vi.fn(),
    extractMemory: vi.fn(),
    detectRisk: vi.fn(),
  } as unknown as AiProviderPort;
}

function makeOutbox(): OutboxPort {
  return {
    enqueueMessageSend: vi.fn().mockResolvedValue(undefined),
    enqueueMemoryExtraction: vi.fn(),
    enqueueFollowUpExecution: vi.fn(),
    enqueueSurveyEvidence: vi.fn(),
    enqueueGroupConfirmation: vi.fn(),
    enqueueGroupReport: vi.fn(),
  };
}

function makePulseBacklogService(
  question: SurveyQuestionRecord | null = makeQuestion(),
): PulseBacklogService {
  return {
    getNextProbeQuestion: vi.fn().mockResolvedValue(
      question ? { question, windowId: 'w-1' } : null,
    ),
    recordProbeSent: vi.fn().mockResolvedValue(undefined),
    markQuestionCovered: vi.fn().mockResolvedValue(undefined),
  } as unknown as PulseBacklogService;
}

const BASE_INPUT = {
  conversationId: 'c-1',
  userId: 'u-1',
  tenantId: 't-1',
  externalWorkspaceId: 'ws-1',
  externalConversationId: 'ext-c-1',
  traceId: 'trace-1',
};

describe('ProactiveCheckInUseCase', () => {
  it('returns a result with the outbound message', async () => {
    const useCase = new ProactiveCheckInUseCase(
      makeConversationRepo(),
      makeAiProvider(),
      makeOutbox(),
      undefined,
      makePulseBacklogService(),
    );

    const result = await useCase.execute(BASE_INPUT);

    expect(result.outboundMessageId).toBe('out-1');
    expect(result.responseText).toContain('Hey Alex');
  });

  it('passes probeQuestion to AI when backlog returns a question', async () => {
    const ai = makeAiProvider();
    const useCase = new ProactiveCheckInUseCase(
      makeConversationRepo(),
      ai,
      makeOutbox(),
      undefined,
      makePulseBacklogService(makeQuestion()),
    );

    await useCase.execute(BASE_INPUT);

    const generateCall = (ai.generateResponse as ReturnType<typeof vi.fn>).mock.calls[0];
    const context = generateCall[2];
    expect(context.proactiveCheckIn.probeQuestion).toMatchObject({
      id: 'q-1',
      probeStrategies: ['Ask about their OKRs'],
    });
  });

  it('passes null probeQuestion to AI when backlog returns null', async () => {
    const ai = makeAiProvider();
    const useCase = new ProactiveCheckInUseCase(
      makeConversationRepo(),
      ai,
      makeOutbox(),
      undefined,
      makePulseBacklogService(null),
    );

    await useCase.execute(BASE_INPUT);

    const context = (ai.generateResponse as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(context.proactiveCheckIn.probeQuestion).toBeUndefined();
  });

  it('calls recordProbeSent when AI embeds a probe', async () => {
    const service = makePulseBacklogService(makeQuestion());
    const useCase = new ProactiveCheckInUseCase(
      makeConversationRepo(),
      makeAiProvider(true, 'q-1'),
      makeOutbox(),
      undefined,
      service,
    );

    await useCase.execute(BASE_INPUT);

    expect(service.recordProbeSent).toHaveBeenCalledWith('u-1', 'w-1', 'q-1', expect.any(Date));
  });

  it('does NOT call recordProbeSent when AI did not embed a probe', async () => {
    const service = makePulseBacklogService(makeQuestion());
    const useCase = new ProactiveCheckInUseCase(
      makeConversationRepo(),
      makeAiProvider(false, null),
      makeOutbox(),
      undefined,
      service,
    );

    await useCase.execute(BASE_INPUT);

    expect(service.recordProbeSent).not.toHaveBeenCalled();
  });

  it('skips probe question on first contact (no messages, no memory)', async () => {
    const convRepo = makeConversationRepo({
      findRecentMessages: vi.fn().mockResolvedValue([]),
    });
    const service = makePulseBacklogService(makeQuestion());
    const useCase = new ProactiveCheckInUseCase(
      convRepo,
      makeAiProvider(),
      makeOutbox(),
      undefined,
      service,
    );

    await useCase.execute(BASE_INPUT);

    expect(service.getNextProbeQuestion).not.toHaveBeenCalled();
  });

  it('works when pulseBacklogService is not provided', async () => {
    const useCase = new ProactiveCheckInUseCase(
      makeConversationRepo(),
      makeAiProvider(),
      makeOutbox(),
    );

    const result = await useCase.execute(BASE_INPUT);
    expect(result.outboundMessageId).toBe('out-1');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter @entalent/application test -- --reporter=verbose 2>&1 | grep -E "FAIL|Error"
```

- [ ] **Step 3: Update `ProactiveCheckInUseCase`**

Replace the entire content of `packages/application/src/use-cases/proactive-check-in.use-case.ts`:

```typescript
import type { ReplyStrategy } from '@entalent/contracts';
import type { AiProviderPort, ConversationTurn } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { MemoryRepositoryPort } from '../ports/memory.repository.port';
import type { OutboxPort } from '../ports/outbox.port';
import type { FeatureFlagPort } from '../ports/feature-flag.port';
import { FEATURE_FLAGS } from '../ports/feature-flag.port';
import type { ProactivePulseConfig } from '../ports/pulse-backlog.repository.port';
import { DEFAULT_PULSE_CONFIG } from '../ports/pulse-backlog.repository.port';
import type { PulseBacklogService } from '../services/pulse-backlog.service';
import type { SurveyQuestionRecord } from '../types/records';

export interface ProactiveCheckInInput {
  conversationId: string;
  userId: string;
  tenantId: string;
  externalWorkspaceId: string;
  externalConversationId: string;
  traceId: string;
  /** Tenant-specific pulse cadence config. Falls back to defaults if omitted. */
  pulseConfig?: ProactivePulseConfig;
}

export interface ProactiveCheckInResult {
  outboundMessageId: string;
  responseText: string;
  probeQuestionId: string | null;
}

/**
 * Agent-initiated check-in. Picks the next pending pulse question from the
 * per-user backlog (via PulseBacklogService) and lets the AI steer conversation
 * naturally toward that topic. The AI may ignore the topic and just open warmly —
 * collecting evidence is a marathon, not a sprint.
 */
export class ProactiveCheckInUseCase {
  constructor(
    private readonly conversationRepo: ConversationRepositoryPort,
    private readonly aiProvider: AiProviderPort,
    private readonly outbox: OutboxPort,
    private readonly memoryRepo?: MemoryRepositoryPort,
    private readonly pulseBacklogService?: PulseBacklogService,
    private readonly featureFlags?: FeatureFlagPort,
  ) {}

  async execute(input: ProactiveCheckInInput): Promise<ProactiveCheckInResult> {
    const { conversationId, tenantId, userId } = input;

    const conversation = await this.conversationRepo.findById(conversationId, tenantId);
    if (!conversation) throw new Error(`Conversation ${conversationId} not found`);

    const dbMessages = await this.conversationRepo.findRecentMessages(conversationId, 10);
    const turns: ConversationTurn[] = dbMessages
      .filter((m) => m.text !== '__init__')
      .map((m) => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: m.text,
        timestamp: m.occurredAt,
      }));

    const userName = conversation.userDisplayName ?? 'there';
    const flagCtx = { tenantId, userId };

    const [memoryEnabled, surveyEnabled] = await Promise.all([
      this.featureFlags
        ? this.featureFlags.isEnabled(FEATURE_FLAGS.MEMORY_EXTRACTION, flagCtx)
        : Promise.resolve(true),
      this.featureFlags
        ? this.featureFlags.isEnabled(FEATURE_FLAGS.CONVERSATIONAL_SURVEY, flagCtx)
        : Promise.resolve(true),
    ]);

    const memoryItems =
      memoryEnabled && this.memoryRepo
        ? await this.memoryRepo.findActiveByUser(userId, tenantId, 20)
        : [];

    // First contact (no history, no memory): earn trust first, never steer toward a survey topic
    const isFirstContact = turns.length === 0 && memoryItems.length === 0;

    const pulseConfig = input.pulseConfig ?? DEFAULT_PULSE_CONFIG;

    const probeResult =
      surveyEnabled && !isFirstContact && this.pulseBacklogService
        ? await this.pulseBacklogService.getNextProbeQuestion(userId, tenantId, pulseConfig)
        : null;

    const probeQuestion: SurveyQuestionRecord | null = probeResult?.question ?? null;

    const strategy: ReplyStrategy = {
      mode: 'proactive_follow_up',
      tone: 'warm',
      includeFollowUpQuestion: true,
      maxResponseLength: 'short',
      forbiddenPatterns: ['checking in', 'just wanted to check', 'reminder'],
    };

    const generated = await this.aiProvider.generateResponse(turns, strategy, {
      userName,
      memoryContext:
        memoryItems.length > 0
          ? {
              items: memoryItems.map((i) => ({
                id: i.id,
                category: i.category,
                content: i.content,
                importance: i.importance,
              })),
              goals: memoryItems
                .filter((i) => i.category === 'goal')
                .map((i) => ({ id: i.id, title: i.content, status: i.status })),
            }
          : undefined,
      proactiveCheckIn: {
        probeQuestion: probeQuestion
          ? { id: probeQuestion.id, probeStrategies: probeQuestion.probeStrategies }
          : undefined,
      },
    });

    const outbound = await this.conversationRepo.saveMessage({
      conversationId,
      tenantId,
      userId,
      direction: 'outbound',
      text: generated.text,
      occurredAt: new Date(),
      traceId: input.traceId,
      messageType: 'proactive_check_in',
      metadata: generated.containsSurveyProbe
        ? { containsSurveyProbe: true, surveyProbeQuestionId: generated.surveyProbeQuestionId }
        : undefined,
    });

    await this.outbox.enqueueMessageSend({
      messageId: outbound.id,
      tenantId,
      conversationId,
      channelType: conversation.channelType,
      externalWorkspaceId: input.externalWorkspaceId,
      externalChannelId: input.externalConversationId,
      text: generated.text,
    });

    // Record that a probe was sent so ignore detection knows when to follow up
    if (
      generated.containsSurveyProbe &&
      generated.surveyProbeQuestionId &&
      probeResult &&
      this.pulseBacklogService
    ) {
      await this.pulseBacklogService.recordProbeSent(
        userId,
        probeResult.windowId,
        generated.surveyProbeQuestionId,
        new Date(),
      );
    }

    return {
      outboundMessageId: outbound.id,
      responseText: generated.text,
      probeQuestionId: generated.containsSurveyProbe
        ? (generated.surveyProbeQuestionId ?? null)
        : null,
    };
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm --filter @entalent/application test -- --reporter=verbose
```

Expected: all tests in `proactive-check-in.use-case.test.ts` pass. Existing tests still pass.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @entalent/application typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/application/src/use-cases/proactive-check-in.use-case.ts packages/application/src/use-cases/proactive-check-in.use-case.test.ts
git commit -m "feat(application): update ProactiveCheckInUseCase to use PulseBacklogService"
```

---

### Task 6: Update `SurveyEvidenceExtractionUseCase` + Unit Tests

**Files:**
- Modify: `packages/application/src/use-cases/survey-evidence.use-case.ts`
- Create: `packages/application/src/use-cases/survey-evidence.use-case.test.ts`

**Interfaces:**
- Consumes: `PulseBacklogService` (Task 3) — injected as optional 5th constructor param.
- Produces: Updated use case that calls `markQuestionCovered` when assessment reaches `scored`/`covered` — consumed by Task 8.

- [ ] **Step 1: Write failing tests**

Create `packages/application/src/use-cases/survey-evidence.use-case.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { SurveyEvidenceExtractionUseCase } from './survey-evidence.use-case';
import { PulseBacklogService } from '../services/pulse-backlog.service';
import type { AiProviderPort } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import type { SurveyQuestionRecord, SurveyWindowRecord, SurveyEvidenceRecord } from '../types/records';

function makeWindow(): SurveyWindowRecord {
  return {
    id: 'w-1', tenantId: 't-1', userId: 'u-1', surveyDefinitionId: 'def-1',
    periodType: 'quarter', periodStart: new Date(), periodEnd: new Date(), status: 'active',
  };
}

function makeQuestion(id = 'q-1', group = 'autonomy'): SurveyQuestionRecord {
  return {
    id, surveyDefinitionId: 'def-1', stableKey: 'q12_expectations', title: 'Clear Expectations',
    canonicalMeaning: 'Does the employee know?', dimension: 'engagement', questionGroup: group,
    displayOrder: 10, positiveIndicators: ['knows goals'], negativeIndicators: ['confused'],
    probeStrategies: [], contraindications: [], confidenceThreshold: 0.72,
    completenessThreshold: 0.65, minimumEvidenceCount: 2, cooldownDays: 14,
    maxFollowUpProbes: 3, responseType: 'open_ended', version: '1',
  };
}

function makeEvidence(): SurveyEvidenceRecord {
  return {
    id: 'ev-1', surveyWindowId: 'w-1', surveyQuestionId: 'q-1', userId: 'u-1',
    sourceMessageIds: ['m-1'], evidenceSummary: 'Knows their goals clearly', polarity: 'positive',
    strength: 0.8, completeness: 0.75, confidence: 0.85, evaluatorVersion: 'v1',
    promptVersion: 'v1', createdAt: new Date(),
  };
}

function makeAi(status: string): AiProviderPort {
  return {
    evaluateSurveyEvidence: vi.fn().mockResolvedValue({
      evidence: [{
        questionId: 'q-1', evidenceSummary: 'Knows their goals clearly',
        polarity: 'positive', strength: 0.8, completeness: 0.75, confidence: 0.85,
        assessmentShouldRemainUnknown: false,
      }],
    }),
    generateResponse: vi.fn(),
    generateGroupSummary: vi.fn().mockResolvedValue({ summary: 'Good clarity on expectations.' }),
    classifyIntent: vi.fn(),
    extractMemory: vi.fn(),
    detectRisk: vi.fn(),
  } as unknown as AiProviderPort;
}

function makeSurveyRepo(assessmentStatus: string): SurveyRepositoryPort {
  return {
    findOrCreateActiveWindow: vi.fn().mockResolvedValue(makeWindow()),
    findQuestionsForWindow: vi.fn().mockResolvedValue([makeQuestion()]),
    saveEvidence: vi.fn().mockResolvedValue(makeEvidence()),
    markEvidenceSuperseded: vi.fn().mockResolvedValue(undefined),
    upsertAssessment: vi.fn().mockResolvedValue(undefined),
    findEvidenceForQuestion: vi.fn().mockResolvedValue([makeEvidence()]),
    findAssessmentsForWindow: vi.fn().mockResolvedValue([
      { surveyQuestionId: 'q-1', status: assessmentStatus },
    ]),
    findGroupState: vi.fn().mockResolvedValue(null),
    findPendingConfirmationGroups: vi.fn().mockResolvedValue([]),
    upsertGroupState: vi.fn().mockResolvedValue({}),
    findConfirmedGroupStates: vi.fn().mockResolvedValue([]),
    findTeamByMemberId: vi.fn().mockResolvedValue(null),
    findTeamById: vi.fn().mockResolvedValue(null),
  } as unknown as SurveyRepositoryPort;
}

function makeConversationRepo(): ConversationRepositoryPort {
  return {
    findRecentMessages: vi.fn().mockResolvedValue([
      { id: 'm-1', direction: 'inbound', text: 'I know exactly what my OKRs are', occurredAt: new Date(), conversationId: 'c-1', tenantId: 't-1', userId: 'u-1', createdAt: new Date() },
    ]),
    findById: vi.fn(),
    saveMessage: vi.fn(),
    findMessageById: vi.fn(),
    findConversationByExternal: vi.fn(),
  } as unknown as ConversationRepositoryPort;
}

function makePulseService(): PulseBacklogService {
  return {
    getNextProbeQuestion: vi.fn(),
    recordProbeSent: vi.fn(),
    markQuestionCovered: vi.fn().mockResolvedValue(undefined),
  } as unknown as PulseBacklogService;
}

const BASE_INPUT = { conversationId: 'c-1', userId: 'u-1', tenantId: 't-1', inboundMessageId: 'm-1' };

describe('SurveyEvidenceExtractionUseCase', () => {
  it('calls markQuestionCovered when assessment reaches scored', async () => {
    const pulseService = makePulseService();
    const useCase = new SurveyEvidenceExtractionUseCase(
      makeAi('scored'),
      makeConversationRepo(),
      makeSurveyRepo('scored'),
      undefined,
      pulseService,
    );

    await useCase.execute(BASE_INPUT);

    expect(pulseService.markQuestionCovered).toHaveBeenCalledWith('u-1', 'w-1', 'q-1', 1);
  });

  it('calls markQuestionCovered when assessment reaches covered', async () => {
    const pulseService = makePulseService();
    const useCase = new SurveyEvidenceExtractionUseCase(
      makeAi('covered'),
      makeConversationRepo(),
      makeSurveyRepo('covered'),
      undefined,
      pulseService,
    );

    await useCase.execute(BASE_INPUT);

    expect(pulseService.markQuestionCovered).toHaveBeenCalled();
  });

  it('does NOT call markQuestionCovered when assessment is partially_covered', async () => {
    const pulseService = makePulseService();
    const useCase = new SurveyEvidenceExtractionUseCase(
      makeAi('partially_covered'),
      makeConversationRepo(),
      makeSurveyRepo('partially_covered'),
      undefined,
      pulseService,
    );

    await useCase.execute(BASE_INPUT);

    expect(pulseService.markQuestionCovered).not.toHaveBeenCalled();
  });

  it('works when pulseBacklogService is not provided', async () => {
    const useCase = new SurveyEvidenceExtractionUseCase(
      makeAi('scored'),
      makeConversationRepo(),
      makeSurveyRepo('scored'),
    );

    await expect(useCase.execute(BASE_INPUT)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter @entalent/application test -- --reporter=verbose 2>&1 | grep -E "FAIL|Error"
```

- [ ] **Step 3: Update `SurveyEvidenceExtractionUseCase`**

Add `pulseBacklogService` as optional 5th constructor param, and call `markQuestionCovered` after assessments that reach `scored`/`covered`.

In `packages/application/src/use-cases/survey-evidence.use-case.ts`, make the following changes:

Add import at the top (after existing imports):

```typescript
import type { PulseBacklogService } from '../services/pulse-backlog.service';
```

Update the constructor:

```typescript
export class SurveyEvidenceExtractionUseCase {
  constructor(
    private readonly ai: AiProviderPort,
    private readonly conversationRepo: ConversationRepositoryPort,
    private readonly surveyRepo: SurveyRepositoryPort,
    private readonly outbox?: OutboxPort,
    private readonly pulseBacklogService?: PulseBacklogService,
  ) {}
```

In the `execute` method, after the existing `await this.surveyRepo.upsertAssessment(...)` call (line ~125), add:

```typescript
      await this.surveyRepo.upsertAssessment({
        surveyWindowId: window.id,
        surveyQuestionId: ev.questionId,
        confidence: ev.confidence,
        status,
        evidenceId: evidenceRecord.id,
        evaluatorVersion: 'v1',
      });

      // Notify backlog when a question reaches coverage threshold
      if ((status === 'scored' || status === 'covered') && this.pulseBacklogService) {
        const allEvidence = await this.surveyRepo.findEvidenceForQuestion(
          input.userId,
          ev.questionId,
          window.id,
        );
        await this.pulseBacklogService.markQuestionCovered(
          input.userId,
          window.id,
          ev.questionId,
          allEvidence.length,
        );
      }

      await this.checkGroupCompletion(input, window.id, ev.questionId, questions);
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm --filter @entalent/application test -- --reporter=verbose
```

Expected: all tests in `survey-evidence.use-case.test.ts` pass. Existing tests still pass.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @entalent/application typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/application/src/use-cases/survey-evidence.use-case.ts packages/application/src/use-cases/survey-evidence.use-case.test.ts
git commit -m "feat(application): SurveyEvidenceExtractionUseCase notifies PulseBacklogService on coverage"
```

---

### Task 7: Remove `findPendingProbeQuestion` + Update Default Gap

**Files:**
- Modify: `packages/application/src/ports/survey.repository.port.ts`
- Modify: `apps/worker/src/survey/repositories/survey.repository.ts`
- Modify: `packages/config/src/env.ts`
- Modify: `packages/application/src/use-cases/proactive-scheduler.test.ts`

**Interfaces:**
- Removes: `findPendingProbeQuestion` from `SurveyRepositoryPort` and `SurveyRepository`.
- Changes: `PROACTIVE_MIN_GAP_DAYS` default from 5 → 3.

- [ ] **Step 1: Remove `findPendingProbeQuestion` from the port**

In `packages/application/src/ports/survey.repository.port.ts`, delete the line:

```typescript
  findPendingProbeQuestion(userId: string, tenantId: string, windowId: string): Promise<SurveyQuestionRecord | null>;
```

Also remove the `SurveyQuestionRecord` import if it's no longer used (check — it's used in `findQuestionsForWindow`'s return type, so keep it).

- [ ] **Step 2: Remove the implementation from `SurveyRepository`**

In `apps/worker/src/survey/repositories/survey.repository.ts`, delete the entire `findPendingProbeQuestion` method (lines 101–157 in the original file).

- [ ] **Step 3: Change the default gap in env schema**

In `packages/config/src/env.ts`, change line 47 from:

```typescript
  PROACTIVE_MIN_GAP_DAYS: z.coerce.number().int().positive().default(5),
```

to:

```typescript
  PROACTIVE_MIN_GAP_DAYS: z.coerce.number().int().positive().default(3),
```

- [ ] **Step 4: Update the scheduler test to reflect the new default**

In `packages/application/src/use-cases/proactive-scheduler.test.ts`, the test `'forwards config thresholds and tenant filter to the repository'` explicitly passes `minCheckInGapDays: 10`, so it does not need changing.

Add a new test to verify the default:

```typescript
  it('uses minCheckInGapDays=3 as the default', async () => {
    const repo = makeRepo([]);
    const queue = makeQueue();
    const useCase = new ProactiveSchedulerUseCase(repo, queue);

    await useCase.scan();

    expect(repo.findCheckInCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ minCheckInGapDays: 3 }),
    );
  });
```

Note: The `DEFAULT_CONFIG` in `proactive-scheduler.use-case.ts` still has `minCheckInGapDays: 5`. Change it to `3` in the use case:

```typescript
const DEFAULT_CONFIG: ProactiveScanConfig = {
  minSilenceDays: 3,
  minCheckInGapDays: 3,   // was 5
  batchLimit: 50,
};
```

- [ ] **Step 5: Run all application tests**

```bash
pnpm --filter @entalent/application test -- --reporter=verbose
```

Expected: all tests pass including the new scheduler default test.

- [ ] **Step 6: Typecheck both packages**

```bash
pnpm --filter @entalent/application typecheck && pnpm --filter @entalent/worker typecheck 2>&1 | head -20
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/application/src/ports/survey.repository.port.ts apps/worker/src/survey/repositories/survey.repository.ts packages/config/src/env.ts packages/application/src/use-cases/proactive-scheduler.use-case.ts packages/application/src/use-cases/proactive-scheduler.test.ts
git commit -m "feat: remove findPendingProbeQuestion, set default check-in gap to 3 days"
```

---

### Task 8: Wire NestJS Modules + Load Tenant Policy in Processor

**Files:**
- Modify: `apps/worker/src/survey/survey.module.ts`
- Modify: `apps/worker/src/conversation/conversation.module.ts`
- Modify: `apps/worker/src/conversation/conversation.processor.ts`

**Interfaces:**
- Consumes: `PulseBacklogRepository` (Task 4), `PulseBacklogService` (Task 3), updated use cases (Tasks 5, 6).
- Produces: fully wired NestJS app — consumed by Task 9, 10 (they require the worker to boot).

- [ ] **Step 1: Update `SurveyModule`**

Replace the entire content of `apps/worker/src/survey/survey.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { SurveyEvidenceExtractionUseCase, GroupReportUseCase, PulseBacklogService } from '@entalent/application';
import type { OutboxPort, GroupConfirmationPayload } from '@entalent/application';
import { SurveyEvidenceProcessor } from './survey-evidence.processor';
import { GroupConfirmationProcessor } from './group-confirmation.processor';
import { GroupReportProcessor } from './group-report.processor';
import { SurveyRepository } from './repositories/survey.repository';
import { PulseBacklogRepository } from './repositories/pulse-backlog.repository';
import { GroupStateRepository } from './repositories/group-state.repository';
import { TeamRepository } from './repositories/team.repository';
import { ConversationRepository } from '../conversation/repositories/conversation.repository';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';
import { AiService } from '../conversation/ai.service';
import { DatabaseModule } from '../database/database.module';
import { QUEUE_NAMES } from '../queue/queue.module';

@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.SURVEY_EVIDENCE },
      { name: QUEUE_NAMES.GROUP_CONFIRMATION },
      { name: QUEUE_NAMES.GROUP_REPORT },
    ),
  ],
  providers: [
    AiService,
    ConversationRepository,
    WorkspaceConnectionRepository,
    GroupStateRepository,
    TeamRepository,
    SurveyRepository,
    PulseBacklogRepository,
    {
      provide: PulseBacklogService,
      useFactory: (backlogRepo: PulseBacklogRepository, surveyRepo: SurveyRepository) =>
        new PulseBacklogService(backlogRepo, surveyRepo),
      inject: [PulseBacklogRepository, SurveyRepository],
    },
    {
      provide: 'SurveyOutboxAdapter',
      useFactory: (queue: Queue<GroupConfirmationPayload>): OutboxPort => ({
        enqueueGroupConfirmation: async (p) => { await queue.add('confirm', p); },
        enqueueMessageSend: async () => {},
        enqueueMemoryExtraction: async () => {},
        enqueueFollowUpExecution: async () => {},
        enqueueSurveyEvidence: async () => {},
        enqueueGroupReport: async () => {},
      }),
      inject: [getQueueToken(QUEUE_NAMES.GROUP_CONFIRMATION)],
    },
    {
      provide: SurveyEvidenceExtractionUseCase,
      useFactory: (
        ai: AiService,
        convRepo: ConversationRepository,
        surveyRepo: SurveyRepository,
        outbox: OutboxPort,
        pulseBacklogService: PulseBacklogService,
      ) => new SurveyEvidenceExtractionUseCase(ai, convRepo, surveyRepo, outbox, pulseBacklogService),
      inject: [AiService, ConversationRepository, SurveyRepository, 'SurveyOutboxAdapter', PulseBacklogService],
    },
    {
      provide: GroupReportUseCase,
      useFactory: (surveyRepo: SurveyRepository, ai: AiService) =>
        new GroupReportUseCase(surveyRepo, ai),
      inject: [SurveyRepository, AiService],
    },
    SurveyEvidenceProcessor,
    GroupConfirmationProcessor,
    GroupReportProcessor,
  ],
  exports: [SurveyRepository, PulseBacklogService],
})
export class SurveyModule {}
```

- [ ] **Step 2: Update `ConversationModule`**

Replace `apps/worker/src/conversation/conversation.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConversationOrchestrator, ProactiveCheckInUseCase, PulseBacklogService } from '@entalent/application';
import { ConversationProcessor } from './conversation.processor';
import { ConversationRepository } from './repositories/conversation.repository';
import { OutboxService } from './outbox.service';
import { AiService } from './ai.service';
import { LlmRunRepository } from './llm-run.repository';
import { DatabaseModule } from '../database/database.module';
import { MemoryModule } from '../memory/memory.module';
import { SurveyModule } from '../survey/survey.module';
import { SafetyModule } from '../safety/safety.module';
import { FeatureFlagModule } from '../feature-flags/feature-flag.module';
import { FeatureFlagRepository } from '../feature-flags/feature-flag.repository';
import { MemoryRepository } from '../memory/repositories/memory.repository';
import { SurveyRepository } from '../survey/repositories/survey.repository';
import { RiskSignalRepository } from '../safety/repositories/risk-signal.repository';
import { EscalationStubService } from '../safety/escalation-stub.service';
import { ScheduledActionRepository } from '../followup/repositories/scheduled-action.repository';
import { QUEUE_NAMES } from '../queue/queue.module';

@Module({
  imports: [
    DatabaseModule,
    MemoryModule,
    SurveyModule,
    SafetyModule,
    FeatureFlagModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.CONVERSATION },
      { name: QUEUE_NAMES.MESSAGE_SEND },
      { name: QUEUE_NAMES.MEMORY_EXTRACTION },
      { name: QUEUE_NAMES.FOLLOWUP_EXECUTION },
      { name: QUEUE_NAMES.SURVEY_EVIDENCE },
    ),
  ],
  providers: [
    AiService,
    ConversationRepository,
    OutboxService,
    ScheduledActionRepository,
    {
      provide: ConversationOrchestrator,
      useFactory: (
        repo: ConversationRepository,
        ai: AiService,
        outbox: OutboxService,
        memoryRepo: MemoryRepository,
        surveyRepo: SurveyRepository,
        riskSignalRepo: RiskSignalRepository,
        escalation: EscalationStubService,
        featureFlags: FeatureFlagRepository,
        scheduledActionRepo: ScheduledActionRepository,
      ) => new ConversationOrchestrator(repo, ai, outbox, memoryRepo, surveyRepo, riskSignalRepo, escalation, featureFlags, scheduledActionRepo),
      inject: [
        ConversationRepository, AiService, OutboxService, MemoryRepository, SurveyRepository,
        RiskSignalRepository, EscalationStubService, FeatureFlagRepository, ScheduledActionRepository,
      ],
    },
    {
      provide: ProactiveCheckInUseCase,
      useFactory: (
        repo: ConversationRepository,
        ai: AiService,
        outbox: OutboxService,
        memoryRepo: MemoryRepository,
        pulseBacklogService: PulseBacklogService,
        featureFlags: FeatureFlagRepository,
      ) => new ProactiveCheckInUseCase(repo, ai, outbox, memoryRepo, pulseBacklogService, featureFlags),
      inject: [
        ConversationRepository, AiService, OutboxService, MemoryRepository,
        PulseBacklogService, FeatureFlagRepository,
      ],
    },
    ConversationProcessor,
    LlmRunRepository,
  ],
})
export class ConversationModule {}
```

- [ ] **Step 3: Update `ConversationProcessor` to load tenant policy**

Replace `apps/worker/src/conversation/conversation.processor.ts`:

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { ConversationOrchestrator, ProactiveCheckInUseCase } from '@entalent/application';
import type { ProactivePulseConfig } from '@entalent/application';
import { tenants } from '@entalent/database';
import { QUEUE_NAMES } from '../queue/queue.module';
import { LlmRunRepository } from './llm-run.repository';
import { DatabaseService } from '../database/database.service';

export type ConversationJob = {
  messageId: string;
  conversationId: string;
  userId: string;
  tenantId: string;
  externalWorkspaceId: string;
  externalConversationId: string;
  traceId: string;
};

export type CheckInJob = Omit<ConversationJob, 'messageId'>;

const DEFAULT_PULSE_CONFIG: ProactivePulseConfig = { engagementUnlockDays: 14, ignoreWindowHours: 48 };

@Processor(QUEUE_NAMES.CONVERSATION)
export class ConversationProcessor extends WorkerHost implements OnApplicationShutdown {
  private readonly logger = new Logger(ConversationProcessor.name);

  constructor(
    private readonly orchestrator: ConversationOrchestrator,
    private readonly checkInUseCase: ProactiveCheckInUseCase,
    private readonly llmRunRepo: LlmRunRepository,
    private readonly db: DatabaseService,
  ) {
    super();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.close();
  }

  async process(job: Job<ConversationJob | CheckInJob>): Promise<void> {
    if (job.name === 'check-in') {
      await this.processCheckIn(job as Job<CheckInJob>);
      return;
    }
    await this.processInbound(job as Job<ConversationJob>);
  }

  private async processCheckIn(job: Job<CheckInJob>): Promise<void> {
    this.logger.log(`Processing check-in job ${job.id}`, {
      conversationId: job.data.conversationId,
    });

    try {
      // Load tenant policy to pass pulse cadence config to the use case
      const [tenantRow] = await this.db.client
        .select({ policy: tenants.proactiveMessagingPolicy })
        .from(tenants)
        .where(eq(tenants.id, job.data.tenantId))
        .limit(1);

      const policy = (tenantRow?.policy ?? {}) as Record<string, unknown>;
      const pulseConfig: ProactivePulseConfig = {
        engagementUnlockDays:
          typeof policy['engagementUnlockDays'] === 'number'
            ? policy['engagementUnlockDays']
            : DEFAULT_PULSE_CONFIG.engagementUnlockDays,
        ignoreWindowHours:
          typeof policy['ignoreWindowHours'] === 'number'
            ? policy['ignoreWindowHours']
            : DEFAULT_PULSE_CONFIG.ignoreWindowHours,
      };

      const result = await this.checkInUseCase.execute({ ...job.data, pulseConfig });
      this.logger.log(
        `Check-in job ${job.id} done — probe=${result.probeQuestionId ?? 'none'} text="${result.responseText.slice(0, 60)}"`,
      );
    } catch (err) {
      this.logger.error(`Check-in job ${job.id} failed: ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }
  }

  private async processInbound(job: Job<ConversationJob>): Promise<void> {
    this.logger.log(`Processing conversation job ${job.id}`, {
      messageId: job.data.messageId,
      conversationId: job.data.conversationId,
    });

    const start = Date.now();
    let status: 'success' | 'error' = 'success';

    try {
      const result = await this.orchestrator.orchestrate({
        messageId: job.data.messageId,
        conversationId: job.data.conversationId,
        userId: job.data.userId,
        tenantId: job.data.tenantId,
        externalWorkspaceId: job.data.externalWorkspaceId,
        externalConversationId: job.data.externalConversationId,
        traceId: job.data.traceId,
      });

      this.logger.log(
        `Job ${job.id} done — mode=${result.mode} intent=${result.classification.primaryIntent} risk=${result.risk.severity}`,
      );
    } catch (err) {
      status = 'error';
      this.logger.error(`Job ${job.id} failed (attempt ${job.attemptsMade}): ${(err as Error).message}`, (err as Error).stack);
      throw err;
    } finally {
      await this.llmRunRepo
        .record({
          tenantId: job.data.tenantId,
          userId: job.data.userId,
          taskType: 'conversation',
          model: 'gpt-4o',
          latencyMs: Date.now() - start,
          status,
          traceId: job.data.traceId,
        })
        .catch(() => {
          /* non-critical */
        });
    }
  }
}
```

- [ ] **Step 4: Typecheck worker**

```bash
pnpm --filter @entalent/worker typecheck 2>&1 | head -30
```

Expected: 0 errors.

- [ ] **Step 5: Boot the worker locally to confirm it starts**

```bash
pnpm --filter @entalent/worker dev 2>&1 | head -40
```

Expected: `Nest application successfully started` with no injection errors.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/survey/survey.module.ts apps/worker/src/conversation/conversation.module.ts apps/worker/src/conversation/conversation.processor.ts
git commit -m "feat(worker): wire PulseBacklogService into modules and load tenant pulse config"
```

---

### Task 9: Pulse Overview Backlog Data + Dashboard

**Files:**
- Modify: `apps/api/src/admin/pulse-overview.controller.ts`
- Modify: `apps/dashboard/src/app/types.ts`
- Modify: `apps/dashboard/src/app/pulse/page.tsx`

**Interfaces:**
- Consumes: `pulseBacklog` table (Task 1) — queried directly with `DatabaseService`.
- Produces: `PulseEmployeeRow.backlog` field in the API response; updated dashboard showing next question and progress.

- [ ] **Step 1: Update `PulseOverviewController` to include backlog data**

In `apps/api/src/admin/pulse-overview.controller.ts`:

Add import at top:
```typescript
import { pulseBacklog, surveyQuestions } from '@entalent/database';
```

In the `getOverview` method, after the existing three parallel queries, add a fourth query for backlog data. Replace the `Promise.all` block:

```typescript
    const [assessmentRows, groupStateRows, questionDefs, backlogRows] = await Promise.all([
      // ... existing three queries unchanged ...

      // 4th query: backlog summary per user/window
      this.db.client
        .select({
          userId: pulseBacklog.userId,
          surveyWindowId: pulseBacklog.surveyWindowId,
          surveyQuestionId: pulseBacklog.surveyQuestionId,
          status: pulseBacklog.status,
          position: pulseBacklog.position,
          ignoreCount: pulseBacklog.ignoreCount,
          questionGroup: surveyQuestions.questionGroup,
          stableKey: surveyQuestions.stableKey,
        })
        .from(pulseBacklog)
        .innerJoin(surveyQuestions, eq(pulseBacklog.surveyQuestionId, surveyQuestions.id))
        .where(
          and(
            eq(pulseBacklog.tenantId, tenantId),
          ),
        ),
    ]);
```

Then build a backlog index and add `backlog` to each employee row. After the existing `stateIndex` block, add:

```typescript
    // Backlog index: userId → summary
    const backlogIndex = new Map<string, {
      doneCount: number;
      pendingCount: number;
      totalIgnoreCount: number;
      nextQuestion: { stableKey: string; group: string } | null;
    }>();

    for (const u of teamUsers) {
      const userRows = backlogRows.filter((r) => r.userId === u.id);
      if (!userRows.length) {
        backlogIndex.set(u.id, { doneCount: 0, pendingCount: 0, totalIgnoreCount: 0, nextQuestion: null });
        continue;
      }
      const doneCount = userRows.filter((r) => r.status === 'done').length;
      const pendingRows = userRows.filter((r) => r.status === 'pending');
      const totalIgnoreCount = userRows.reduce((sum, r) => sum + r.ignoreCount, 0);
      const nextRow = pendingRows.sort((a, b) => a.position - b.position)[0] ?? null;
      backlogIndex.set(u.id, {
        doneCount,
        pendingCount: pendingRows.length,
        totalIgnoreCount,
        nextQuestion: nextRow
          ? { stableKey: nextRow.stableKey, group: nextRow.questionGroup }
          : null,
      });
    }
```

Update the employee mapping to include `backlog`:

```typescript
      return {
        userId: u.id,
        displayName: u.displayName,
        groups,
        backlog: backlogIndex.get(u.id) ?? { doneCount: 0, pendingCount: 0, totalIgnoreCount: 0, nextQuestion: null },
      };
```

Update the `PulseEmployeeRow` interface in the same file:

```typescript
export interface PulseEmployeeRow {
  userId: string;
  displayName: string | null;
  groups: PulseGroupRow[];
  backlog: {
    doneCount: number;
    pendingCount: number;
    totalIgnoreCount: number;
    nextQuestion: { stableKey: string; group: string } | null;
  };
}
```

- [ ] **Step 2: Update dashboard types**

In `apps/dashboard/src/app/types.ts`, update `PulseEmployeeRow`:

```typescript
export interface PulseEmployeeRow {
  userId: string;
  displayName: string | null;
  groups: PulseGroupRow[];
  backlog: {
    doneCount: number;
    pendingCount: number;
    totalIgnoreCount: number;
    nextQuestion: { stableKey: string; group: string } | null;
  };
}
```

- [ ] **Step 3: Update the Pulse dashboard page**

In `apps/dashboard/src/app/pulse/page.tsx`, add a backlog summary row inside each employee card. Find the employee card rendering and add after the groups section:

```tsx
{/* Backlog progress row */}
<div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--surface)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 16, alignItems: 'center' }}>
  <span>Backlog: <b style={{ color: 'var(--text)' }}>{emp.backlog.doneCount}</b> closed</span>
  <span><b style={{ color: 'var(--text)' }}>{emp.backlog.pendingCount}</b> pending</span>
  {emp.backlog.totalIgnoreCount > 0 && (
    <span style={{ color: '#f59e0b' }}>↩ {emp.backlog.totalIgnoreCount} ignored</span>
  )}
  {emp.backlog.nextQuestion && (
    <span>Next: <b style={{ color: 'var(--text)' }}>{emp.backlog.nextQuestion.stableKey}</b> ({emp.backlog.nextQuestion.group})</span>
  )}
  {!emp.backlog.nextQuestion && emp.backlog.doneCount > 0 && (
    <span style={{ color: '#10b981' }}>✓ All questions closed</span>
  )}
</div>
```

- [ ] **Step 4: Typecheck API and dashboard**

```bash
pnpm --filter @entalent/api typecheck 2>&1 | head -20
pnpm --filter @entalent/dashboard typecheck 2>&1 | head -20
```

Expected: 0 errors in both.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/admin/pulse-overview.controller.ts apps/dashboard/src/app/types.ts apps/dashboard/src/app/pulse/page.tsx
git commit -m "feat: add backlog state to pulse overview API and dashboard"
```

---

### Task 10: Dev `/simulate-proactive-cycle` Endpoint

**Files:**
- Modify: `apps/api/src/dev/dev-simulate.controller.ts`

**Interfaces:**
- Consumes: `pulseBacklog`, `surveyQuestions` tables (Task 1) — direct DB queries via `DatabaseService`.
- Produces: `POST /api/v1/dev/simulate-proactive-cycle` — used for manual testing of the backlog flow without waiting real time.

- [ ] **Step 1: Add the endpoint to `DevSimulateController`**

In `apps/api/src/dev/dev-simulate.controller.ts`, add at the top of the file with existing imports:

```typescript
import { pulseBacklog, surveyQuestions, surveyWindows } from '@entalent/database';
import { asc, max as sqlMax } from 'drizzle-orm';
```

Then add the new endpoint method inside the `DevSimulateController` class:

```typescript
  /**
   * Fast-forwards through the pulse backlog for a user by simulating N steps.
   * Each step:
   *   1. Force-marks any 'active' entry as ignored (simulates 48h timeout).
   *   2. Finds the next 'pending' non-engagement entry and marks it 'active'.
   * Returns the sequence of questions that would be probed.
   * Only works in development mode.
   */
  @Post('simulate-proactive-cycle')
  @HttpCode(200)
  async simulateProactiveCycle(
    @Body() body: { userId: string; tenantId: string; steps: number },
  ): Promise<{
    steps: Array<{
      stepIndex: number;
      questionId: string;
      stableKey: string;
      title: string;
      group: string;
      wasForceIgnored: boolean;
    }>;
  }> {
    const { userId, tenantId, steps } = body;

    // Find the active survey window for this user
    const [window] = await this.db.client
      .select({ id: surveyWindows.id })
      .from(surveyWindows)
      .where(and(eq(surveyWindows.userId, userId), eq(surveyWindows.status, 'active')))
      .limit(1);

    if (!window) {
      return { steps: [] };
    }

    const windowId = window.id;
    const result: Array<{
      stepIndex: number;
      questionId: string;
      stableKey: string;
      title: string;
      group: string;
      wasForceIgnored: boolean;
    }> = [];

    for (let i = 0; i < steps; i++) {
      // Step 1: force-ignore any active entry
      const [activeEntry] = await this.db.client
        .select({ id: pulseBacklog.id, surveyQuestionId: pulseBacklog.surveyQuestionId, ignoreCount: pulseBacklog.ignoreCount })
        .from(pulseBacklog)
        .where(and(eq(pulseBacklog.userId, userId), eq(pulseBacklog.surveyWindowId, windowId), eq(pulseBacklog.status, 'active')))
        .limit(1);

      let wasForceIgnored = false;
      if (activeEntry) {
        const [{ maxPos }] = await this.db.client
          .select({ maxPos: sqlMax(pulseBacklog.position) })
          .from(pulseBacklog)
          .where(and(eq(pulseBacklog.userId, userId), eq(pulseBacklog.surveyWindowId, windowId)));

        await this.db.client
          .update(pulseBacklog)
          .set({
            status: 'pending',
            position: (maxPos ?? 0) + 1,
            ignoreCount: activeEntry.ignoreCount + 1,
            resultedInCoverage: false,
            updatedAt: new Date(),
          })
          .where(eq(pulseBacklog.id, activeEntry.id));
        wasForceIgnored = true;
      }

      // Step 2: find next pending non-engagement entry
      const [nextEntry] = await this.db.client
        .select({
          id: pulseBacklog.id,
          surveyQuestionId: pulseBacklog.surveyQuestionId,
          stableKey: surveyQuestions.stableKey,
          title: surveyQuestions.title,
          questionGroup: surveyQuestions.questionGroup,
        })
        .from(pulseBacklog)
        .innerJoin(surveyQuestions, eq(pulseBacklog.surveyQuestionId, surveyQuestions.id))
        .where(
          and(
            eq(pulseBacklog.userId, userId),
            eq(pulseBacklog.surveyWindowId, windowId),
            eq(pulseBacklog.status, 'pending'),
            ne(surveyQuestions.questionGroup, 'engagement'),
          ),
        )
        .orderBy(asc(pulseBacklog.position))
        .limit(1);

      if (!nextEntry) break;

      // Mark it active with sentAt = now
      await this.db.client
        .update(pulseBacklog)
        .set({ status: 'active', proactiveSentAt: new Date(), updatedAt: new Date() })
        .where(eq(pulseBacklog.id, nextEntry.id));

      result.push({
        stepIndex: i + 1,
        questionId: nextEntry.surveyQuestionId,
        stableKey: nextEntry.stableKey,
        title: nextEntry.title,
        group: nextEntry.questionGroup,
        wasForceIgnored,
      });
    }

    this.logger.log(`Dev: simulated ${result.length}/${steps} proactive cycle steps for user=${userId}`);
    return { steps: result };
  }
```

Also add `ne` and `asc` to the drizzle imports at the top if not already present:

```typescript
import { eq, and, desc, isNull, ne, asc } from 'drizzle-orm';
```

- [ ] **Step 2: Typecheck API**

```bash
pnpm --filter @entalent/api typecheck 2>&1 | head -20
```

Expected: 0 errors.

- [ ] **Step 3: Boot API and verify the route is registered**

```bash
pnpm --filter @entalent/api dev 2>&1 | grep "simulate-proactive-cycle"
```

Expected: `Mapped {/api/v1/dev/simulate-proactive-cycle, POST} route`.

- [ ] **Step 4: Run a quick smoke test via curl**

First find a userId using the existing `/dev/find-conversation` endpoint, then:

```bash
curl -s -X POST http://localhost:3000/api/v1/dev/simulate-proactive-cycle \
  -H "Content-Type: application/json" \
  -d '{"userId":"<YOUR_USER_ID>","tenantId":"<YOUR_TENANT_ID>","steps":3}' | jq .
```

Expected: JSON with `steps` array showing 0–3 questions (0 if backlog not yet initialized — first run a `/dev/simulate-checkin` to trigger initialization).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/dev/dev-simulate.controller.ts
git commit -m "feat(dev): add simulate-proactive-cycle endpoint for backlog testing"
```

---

## Done

After Task 10 is complete, all tasks are done. Deploy to Railway:

```bash
railway up --service api --detach
railway up --service worker --detach
```

Verify backlog state in the dashboard at `/pulse` — employees who have had check-ins should show backlog progress.
