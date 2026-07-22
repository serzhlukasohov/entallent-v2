# Proactive Pulse Check Cadence System — Design Spec

## Goal

Per-user, per-quarter question backlog that drives structured proactive outreach: one topic every N days (configurable per-tenant), strict group order (autonomy → belonging → growth → purpose), engagement questions reserved for the final 14 days of the quarter. Full feedback loop tracking whether each probe actually generated evidence.

## Architecture Overview

New domain concept: `PulseBacklog` — a per-user, per-window ordered queue of survey questions with explicit state per entry. Owned by a dedicated service that sits between the messaging use cases and the data layer.

```
pulse_backlog table
       │
PulseBacklogRepositoryPort  (new port in application package)
       │
PulseBacklogService         (new service — owns entire state machine)
      / \
ProactiveCheckInUseCase    SurveyEvidenceExtractionUseCase
(asks: what's next?)       (notifies: question covered)
```

**Key architectural decision:** `findPendingProbeQuestion` is removed from `SurveyRepositoryPort`. All probe question selection logic moves into `PulseBacklogService`. Repositories remain pure data-access.

## Database Schema

### New table: `pulse_backlog`

```sql
CREATE TABLE pulse_backlog (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_window_id        UUID NOT NULL REFERENCES survey_windows(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  survey_question_id      UUID NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  position                INTEGER NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending',  -- pending | active | done
  ignore_count            INTEGER NOT NULL DEFAULT 0,
  proactive_sent_at       TIMESTAMPTZ,
  evidence_captured_count INTEGER NOT NULL DEFAULT 0,
  resulted_in_coverage    BOOLEAN,
  done_at                 TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (survey_window_id, user_id, survey_question_id)
);

CREATE INDEX pulse_backlog_user_window_idx ON pulse_backlog (user_id, survey_window_id);
CREATE INDEX pulse_backlog_status_idx ON pulse_backlog (survey_window_id, user_id, status, position);
```

**`position`:** integer queue position; lower = picked first. Ignored questions get `position = MAX(position) + 1` when moved to end.

**`status` values:**
- `pending` — not yet probed (or previously ignored and moved to end of queue)
- `active` — probe was sent, awaiting response within ignore window
- `done` — question reached `scored` or `covered` assessment status

**`ignore_count`:** how many times the 48h window expired without an inbound for this question. Useful for analytics.

**`evidence_captured_count`:** count of evidence records captured after `proactive_sent_at` (updated when `markQuestionCovered` is called). Measures probe effectiveness.

**`resulted_in_coverage`:** `true` if the question reached `scored`/`covered` via a probe-triggered conversation; `false` if the probe was ignored (moved back to pending); `null` for questions covered via organic cross-pollination before a probe was ever sent.

### Updated: `tenants.proactiveMessagingPolicy` (jsonb)

Add three new fields with defaults. Existing fields unchanged — backwards compatible:

```json
{
  "enabled": true,
  "checkInGapDays": 3,
  "engagementUnlockDays": 14,
  "ignoreWindowHours": 48,
  "maxPerWeek": 3,
  "allowedDays": [1, 2, 3, 4, 5],
  "allowedHoursStart": 9,
  "allowedHoursEnd": 18
}
```

- `checkInGapDays` — minimum calendar days between proactive contacts per user (default 3)
- `engagementUnlockDays` — days before quarter end when engagement questions unlock (default 14)
- `ignoreWindowHours` — hours after probe sent before no-response is treated as ignore (default 48)

## State Machine

Each `pulse_backlog` entry transitions through the following states:

```
                ┌── on backlog init (already scored/covered)
                ▼
pending ──────────────────────────────────────────► done
   ▲                                                  ▲
   │  (proactive sent)                                │
   │        │                                         │
   │        ▼                                         │
   │      active ──── inbound arrives + assessment ───┘
   │                  reaches scored/covered
   │
   └── 48h no inbound:
       ignore_count++
       position = MAX(position) + 1
       status → pending  (back in queue, at the end)
```

## Backlog Initialization

**Triggered:** lazily, on first call to `getNextProbeQuestion` for a given user/window combination.

**Question order:** canonical group order `autonomy → belonging → growth → purpose` (4 groups × 3 questions = 12 entries). Within each group: sorted by `displayOrder` ascending.

Current question mapping (by `questionGroup` and `displayOrder`):
- autonomy: `q12_expectations` (10), `q12_strengths_opportunity` (11), `q12_opinions_count` (14)
- belonging: `wellbeing_at_work` (1), `q12_supervisor_cares` (13), `belonging_psychological_safety` (22)
- growth: `role_clarity` (0), `professional_growth` (2), `q12_progress_discussion` (15)
- purpose: `q12_recognition` (12), `purpose_meaning` (20), `purpose_contribution` (21)

**At init time:** load current `surveyAssessments` for the window. Questions already at `scored` or `covered` are created as `done` immediately (cross-pollination may have already closed them). The remaining questions get `status = 'pending'` with positions 1–N (skipping done entries in the count).

**Engagement questions** (`engagement_nps`, `engagement_motivation`, `engagement_current`) are NOT included at initialization. They are added with positions 13–15 only when end-of-quarter mode activates.

**Idempotent:** if entries already exist for the window/user pair, `initializeIfNeeded` is a no-op.

## End-of-Quarter Mode

When `surveyWindow.periodEnd - now ≤ engagementUnlockDays` (default 14 days):

1. Regular 12-question backlog is **frozen** — `findNextPending` with `engagementOnly = false` returns `null`
2. `unlockEngagementIfNeeded` is called — adds 3 engagement entries at positions 13, 14, 15 if not present
3. `findNextPending` with `engagementOnly = true` returns the first pending engagement entry

This is a hard mode switch at the 14-day boundary. No mixing of regular and engagement questions.

## New Components

### `PulseBacklogRepositoryPort`

Location: `packages/application/src/ports/pulse-backlog.repository.port.ts`

```typescript
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

export interface PulseBacklogRepositoryPort {
  initializeIfNeeded(
    userId: string,
    tenantId: string,
    windowId: string,
    questions: SurveyQuestionRecord[],
    coveredQuestionIds: Set<string>,
  ): Promise<void>;

  resolveIgnoredEntries(
    userId: string,
    windowId: string,
    ignoreAfterHours: number,
  ): Promise<ResolvedIgnore[]>;

  findNextPending(
    userId: string,
    windowId: string,
    engagementOnly: boolean,
  ): Promise<PulseBacklogRecord | null>;

  markActive(
    userId: string,
    windowId: string,
    questionId: string,
    sentAt: Date,
  ): Promise<void>;

  markDone(
    userId: string,
    windowId: string,
    questionId: string,
    evidenceCapturedCount: number,
    resultedInCoverage: boolean,
  ): Promise<void>;

  unlockEngagementIfNeeded(
    userId: string,
    tenantId: string,
    windowId: string,
    engagementQuestions: SurveyQuestionRecord[],
  ): Promise<void>;

  findBacklogSummary(
    userIds: string[],
    windowIds: string[],
  ): Promise<PulseBacklogSummary[]>;
}

export interface PulseBacklogSummary {
  userId: string;
  surveyWindowId: string;
  totalEntries: number;
  doneCount: number;
  activeCount: number;
  pendingCount: number;
  totalIgnoreCount: number;
  nextPendingQuestion: { questionId: string; position: number; stableKey: string } | null;
}
```

### `PulseBacklogService`

Location: `packages/application/src/services/pulse-backlog.service.ts`

```typescript
export class PulseBacklogService {
  constructor(
    private readonly backlogRepo: PulseBacklogRepositoryPort,
    private readonly surveyRepo: SurveyRepositoryPort,
  ) {}

  async getNextProbeQuestion(
    userId: string,
    tenantId: string,
    tenantConfig: ProactivePulseConfig,
  ): Promise<{ question: SurveyQuestionRecord; windowId: string } | null>

  async recordProbeSent(
    userId: string,
    windowId: string,
    questionId: string,
    sentAt: Date,
  ): Promise<void>

  async markQuestionCovered(
    userId: string,
    windowId: string,
    questionId: string,
    evidenceCount: number,
  ): Promise<void>
}

export interface ProactivePulseConfig {
  engagementUnlockDays: number;  // default 14
  ignoreWindowHours: number;     // default 48
}
```

**`getNextProbeQuestion` — internal steps:**
1. `surveyRepo.findOrCreateActiveWindow(userId, tenantId)` → get window; return `null` if none
2. Load all questions for window
3. Load current assessments for window → build `coveredQuestionIds` set (`scored` | `covered`)
4. `backlogRepo.initializeIfNeeded(userId, tenantId, windowId, nonEngagementQuestions, coveredQuestionIds)`
5. `backlogRepo.resolveIgnoredEntries(userId, windowId, tenantConfig.ignoreWindowHours)` → log resolved ignores
6. Determine `isEndOfQuarter = (window.periodEnd.getTime() - Date.now()) / 86400000 <= tenantConfig.engagementUnlockDays`
7. If `isEndOfQuarter`: `backlogRepo.unlockEngagementIfNeeded(userId, tenantId, windowId, engagementQuestions)`
8. `backlogRepo.findNextPending(userId, windowId, engagementOnly: isEndOfQuarter)`
9. If no entry found: return `null`
10. Return `{ question: fullQuestionRecord, windowId }`

### `PulseBacklogRepository`

Location: `apps/worker/src/survey/repositories/pulse-backlog.repository.ts`

Implements `PulseBacklogRepositoryPort`. Key implementation note for `resolveIgnoredEntries`:

```sql
-- Find active entries where proactive_sent_at is older than ignoreWindowHours
-- AND no inbound message exists in the messages table after proactive_sent_at
SELECT pb.*
FROM pulse_backlog pb
WHERE pb.user_id = $userId
  AND pb.survey_window_id = $windowId
  AND pb.status = 'active'
  AND pb.proactive_sent_at < now() - interval '$ignoreAfterHours hours'
  AND NOT EXISTS (
    SELECT 1 FROM messages m
    WHERE m.conversation_id IN (
      SELECT id FROM conversations WHERE user_id = $userId
    )
    AND m.direction = 'inbound'
    AND m.occurred_at > pb.proactive_sent_at
  )
```

For each found entry: set `status = 'pending'`, `position = MAX(position) + 1`, `ignore_count = ignore_count + 1`, `resulted_in_coverage = false`.

## Modified Components

### `ProactiveCheckInUseCase`

Inject `PulseBacklogService` (replacing `SurveyRepositoryPort` direct survey probe logic).

**How tenant config reaches the use case:** `ProactiveCheckInInput` gains an optional field `pulseConfig?: ProactivePulseConfig`. The worker's `ConversationProcessor` reads `tenant.proactiveMessagingPolicy` from the DB before calling the use case, and populates `pulseConfig`. The use case falls back to `PulseBacklogService` defaults if not present (so existing tests require no changes to their input fixtures).

```typescript
// ProactiveCheckInInput — add optional field:
export interface ProactiveCheckInInput {
  // ... existing fields ...
  pulseConfig?: ProactivePulseConfig  // resolved by processor from tenant policy
}

// Replace:
const probeQuestion = await this.surveyRepo.findPendingProbeQuestion(...)

// With:
const pulseConfig: ProactivePulseConfig = input.pulseConfig ?? DEFAULT_PULSE_CONFIG
const probeResult = await this.pulseBacklogService.getNextProbeQuestion(userId, tenantId, pulseConfig)
const probeQuestion = probeResult?.question ?? null

// After message save, if probe was included:
if (generated.containsSurveyProbe && generated.surveyProbeQuestionId && probeResult) {
  await this.pulseBacklogService.recordProbeSent(
    userId, probeResult.windowId, generated.surveyProbeQuestionId, new Date()
  )
}
```

### `SurveyEvidenceExtractionUseCase`

After `upsertAssessment`, when the new status is `scored` or `covered`:

```typescript
if ((newStatus === 'scored' || newStatus === 'covered') && this.pulseBacklogService) {
  // evidenceCount = total non-superseded evidence records for this question in this window
  const evidenceCount = await this.surveyRepo.findEvidenceForQuestion(input.userId, questionId, windowId)
    .then(rows => rows.length)
  await this.pulseBacklogService.markQuestionCovered(
    input.userId, windowId, questionId, evidenceCount
  )
}
```

`pulseBacklogService` is an optional constructor param (same pattern as other optional ports in this use case) so that existing tests don't break.

### `ProactiveSchedulerUseCase`

- Default `minCheckInGapDays` changes from `5` to `3`
- Read `checkInGapDays` from tenant's `proactiveMessagingPolicy` when available (passed in from processor)

### `SurveyRepositoryPort`

Remove `findPendingProbeQuestion` method entirely. Update implementation in `SurveyRepository` accordingly.

### `PulseOverviewController`

Add `backlogSummary` to the per-employee response using `backlogRepo.findBacklogSummary(userIds, windowIds)`:

```typescript
// Added to PulseEmployeeRow response:
backlog: {
  doneCount: number
  pendingCount: number
  totalIgnoreCount: number
  nextQuestion: { stableKey: string; group: string } | null
}
```

### Dev Simulate Endpoint

`POST /api/v1/dev/simulate-proactive-cycle`

```typescript
body: { userId: string; tenantId: string; steps: number }

// For each step:
// 1. Find any 'active' backlog entry → force-resolve as ignored (simulate 48h timeout)
// 2. Call pulseBacklogService.getNextProbeQuestion()
// 3. If found, call pulseBacklogService.recordProbeSent() with sentAt = now
// Returns the sequence of questions that would be probed

response: {
  steps: Array<{
    stepIndex: number
    questionId: string
    stableKey: string
    title: string
    group: string
    wasForceIgnored: boolean  // true if step 1 resolved an active entry
  }>
}
```

## Files Changed

| Action | Path |
|--------|------|
| Create | `packages/database/src/schema/pulse-backlog.ts` |
| Create | `packages/database/migrations/0003_pulse_backlog.sql` |
| Create | `packages/application/src/ports/pulse-backlog.repository.port.ts` |
| Create | `packages/application/src/services/pulse-backlog.service.ts` |
| Create | `packages/application/src/services/pulse-backlog.service.test.ts` |
| Create | `apps/worker/src/survey/repositories/pulse-backlog.repository.ts` |
| Modify | `packages/application/src/use-cases/proactive-check-in.use-case.ts` |
| Modify | `packages/application/src/use-cases/proactive-check-in.use-case.test.ts` |
| Modify | `packages/application/src/use-cases/survey-evidence.use-case.ts` |
| Modify | `packages/application/src/use-cases/proactive-scheduler.use-case.ts` |
| Modify | `packages/application/src/ports/survey.repository.port.ts` |
| Modify | `apps/worker/src/survey/repositories/survey.repository.ts` |
| Modify | `apps/worker/src/survey/survey.module.ts` |
| Modify | `apps/worker/src/proactive/proactive-scheduler.module.ts` |
| Modify | `apps/api/src/admin/pulse-overview.controller.ts` |
| Modify | `apps/api/src/dev/dev-simulate.controller.ts` |
| Modify | `apps/dashboard/src/app/pulse/page.tsx` |
| Modify | `apps/dashboard/src/app/types.ts` |

## Testing Strategy

### Unit tests — `PulseBacklogService` (mock `PulseBacklogRepositoryPort`)

```
✓ getNextProbeQuestion — returns first pending by position
✓ getNextProbeQuestion — skips done entries
✓ getNextProbeQuestion — in end-of-quarter mode returns engagement only
✓ getNextProbeQuestion — in regular mode never returns engagement
✓ getNextProbeQuestion — after resolveIgnoredEntries, ignored question moves to end
✓ getNextProbeQuestion — returns null when all entries are done
✓ getNextProbeQuestion — initializes backlog on first call, idempotent on second
✓ getNextProbeQuestion — questions already covered at init are created as done
✓ recordProbeSent — sets status = active, proactive_sent_at
✓ markQuestionCovered — sets done, resulted_in_coverage = true, evidence_captured_count
```

### Integration tests — `PulseBacklogRepository` (real test DB)

```
✓ initializeIfNeeded — creates 12 entries in correct group order
✓ initializeIfNeeded — already-covered questions created as done
✓ initializeIfNeeded — idempotent on second call
✓ resolveIgnoredEntries — finds active entries older than N hours without inbound
✓ resolveIgnoredEntries — does NOT touch active entries that have an inbound after proactive_sent_at
✓ resolveIgnoredEntries — moves resolved entries to end, increments ignore_count
✓ findNextPending — returns entry with lowest position
✓ unlockEngagementIfNeeded — adds 3 entries at positions 13-15
✓ unlockEngagementIfNeeded — idempotent on second call
```

### Updated existing tests

- `proactive-check-in.use-case.test.ts` — mock `PulseBacklogService` instead of `surveyRepo.findPendingProbeQuestion`
- `survey-evidence.use-case.test.ts` — add case: when assessment reaches `scored`, `markQuestionCovered` is called

## Observability

Log lines emitted by `PulseBacklogService`:

```
[PulseBacklog] Initialized backlog userId=X windowId=Y — 12 questions (3 already done)
[PulseBacklog] Resolved ignore: userId=X questionId=role_clarity ignoreCount=1 → position=15
[PulseBacklog] Next probe: userId=X question=q12_expectations position=1 group=autonomy
[PulseBacklog] End-of-quarter mode: unlocked engagement questions for userId=X
[PulseBacklog] Question covered: userId=X question=role_clarity evidenceCount=2 resultedInCoverage=true
[PulseBacklog] Backlog exhausted (all done or no pending): userId=X windowId=Y
```

## Global Constraints

- Engagement questions (`questionGroup = 'engagement'`) are never included in regular rotation
- Group order for initialization is fixed: autonomy → belonging → growth → purpose
- Within each group, order by `displayOrder` ascending
- End-of-quarter threshold default: 14 days; configurable per tenant via `proactiveMessagingPolicy.engagementUnlockDays`
- Ignore window default: 48 hours; configurable per tenant via `proactiveMessagingPolicy.ignoreWindowHours`
- Check-in gap default: 3 calendar days; configurable per tenant via `proactiveMessagingPolicy.checkInGapDays`
- `initializeIfNeeded` and `unlockEngagementIfNeeded` must be idempotent (safe to call multiple times)
- `PulseBacklogService` is injected as optional into `SurveyEvidenceExtractionUseCase` to preserve existing tests
- `findPendingProbeQuestion` is fully removed from `SurveyRepositoryPort` — no backwards-compat shim
- All new DB columns have NOT NULL with defaults where appropriate; no nullable columns unless semantically meaningful
