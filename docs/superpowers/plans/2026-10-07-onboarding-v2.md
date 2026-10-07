# Onboarding v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Role-based Slack onboarding for the six hierarchy roles. It covers approved two-message copy with real buttons, equivalent free-text replies interpreted by the classifier, participation state that drives proactive Pulse conversations and backlog analysis, and one calendar-aware reminder. It is configured per company by enTalent's team.

**Architecture:** A pure state machine in `packages/application/src/onboarding/` decides every transition and returns a list of effects. The API and worker adapters persist state in a new `onboarding_states` table and execute the effects. There are three event sources: Slack button interactions (a new channel-event variant and a dedicated queue), classifier signals on ordinary inbound turns (a new optional field on the existing per-turn classification, so there is no keyword gate), and system events (delivery, reminder, role change, deactivation). Participation is mirrored into `users.proactive_messaging_enabled` in the same transaction, so the existing proactive scheduler needs no second gate.

**Tech Stack:** TypeScript, NestJS (api/worker), Drizzle + PostgreSQL, BullMQ, Slack Web API / Socket Mode, Zod, Vitest.

**Spec:** `docs/onboarding-v2.md` (grill requirements) plus `docs/onboarding-v2-answers.md` (2026-10-07 decisions; later decisions win). Context: `_bmad-output/planning-artifacts/onboarding-v2/OPEN-QUESTIONS.md` and `PR-9-REVIEW-NOTES.md` (review of the reverted implementation `807c603`).

## Global Constraints

- Onboarding copy is English only, verbatim from `docs/onboarding-v2.md` §"Final onboarding messages". Do not write paraphrases or translations (G3).
- Each role gets two consecutive Slack messages. Split the copy before the first privacy paragraph ("Your conversations…" / "Reports use only…"). Buttons go under the second message only (Q23).
- Button labels by role:
  - Employee: `Let's Talk` · `Later` · `I Don't Want to Participate`
  - Team Lead: `Start My Conversation` · `Got It` · `Later` · `No Personal Check-ins`
  - Manager / HR / HRBP / Leadership: `Got It`
- Acknowledgement copy is verbatim from answers G2. Reminder copy is verbatim from Q14. The empty-backlog opener is verbatim from G1.
- At most one onboarding reminder per onboarding. It has no buttons. Employee and Team Lead only. Never sent after refusal (Q13, Q14).
- Reminder due time: the origin's local time on the 2nd following working date. The origin date never counts. If that time falls outside working hours, use the next working time (Q12).
- Rollout is blocked until enTalent has configured the company timezone, working days and working hours. There are no inferred defaults (Q18, G5).
- No onboarding action ever grants reporting consent. Do not touch `users.consent_state`, group confirmations or reporting-disclosure receipts (grill L20).
- Manager, HR, HRBP and Leadership never receive proactive conversations or reminders. Their messages are never analysed as Pulse evidence (Q11).
- Customers never see named participation decisions (Q20).
- Do not touch admin/debug/insights access controls. Do not rewrite the reporting-disclosure text (Q21, Q22 are a separate workstream).
- No regex or phrase list that changes onboarding state. Text intent comes only from the classifier. TypeScript decides (memory: no keyword gates).
- No model call inside a DB transaction or while holding a row lock.
- Button clicks are never persisted as inbound user messages.
- Do not modify `agent-service` or MAF paths.

## Working assumptions (agreed by Illia 2026-10-07)

Each assumption is isolated behind one function, so changing it is local.

| ID | Assumption (default implemented) | Owning task | Source of doubt |
|---|---|---|---|
| A1 | The calendar's working days and hours are read in the **user's** timezone (`users.timezone`). The company timezone is the fallback when the user's is unknown. | 1, 8 | Answers say "company timezone". The proactive scheduler already uses the user timezone. |
| A2 | A declined user resumes participation only on a **substantive** user-initiated turn. A greeting or thanks does not resume. | 4 | Q3/Q5 say "initiates a new conversation"; Q15 defines non-substantive only for undecided users. |
| A3 | The reminder is always the approved English copy (G3 wins over Q19 until approved translations exist). | 8 | Q19 vs G3 |
| A4 | The operator identity for settings changes is a required `--operator <email>` on an internal CLI script, recorded as `actorId` with `actorType: 'internal_operator'`. | 1 | Q17: dashboard has no login |
| A5 | Aggregate onboarding counts are shown to the customer only for groups of at least 5 people. Smaller groups are suppressed. Per-person delivery status stays as it is today. | 10 | Q20 threshold unspecified |
| A6 | Manager → Employee starts a fresh personal onboarding with a fresh one-reminder budget. | 9 | Q8 |
| A7 | Role-change introductions reuse the full approved copy of the new role. No new short copy is invented. | 9 | Q8 asks for a "short introduction" but no copy exists |
| A8 | If the user wrote in the last 30 minutes and has not completed onboarding (greeting or clarification only), the reminder is postponed by 30 minutes, clamped to working time. | 8 | Q15 "do not interrupt" |
| A9 | The first conversation after Let's Talk keeps today's reporting-disclosure append behaviour (no receipt changes). | 7 | Q22 separate workstream |

## Review Focus

1. **The same choice arrives twice** through different channels (button click plus a typed "let's talk" a second later, or a double click). There must be exactly one conversation start, one acknowledgement and one `chat.update`. Pinned in Task 5 (`action_ts` dedupe) and Task 3 (`start` while `active` returns no effects).
2. **An active participant writes "not now, I'm in a meeting".** This must not be treated as refusal or Later (bug 1.1 of the reverted code). The classifier returns `end_today_only` and TypeScript maps it to no state change. Pinned in Task 6.
3. **A user clicks a button on someone else's message, or an old message after a role change.** It must be rejected or treated as stale per Q6 and must never affect another person. Pinned in Task 5 (person ↔ Slack user ↔ intro ts check).
4. **One tenant's reminder processing throws** (bad timezone string, deleted user). Other reminders and the proactive scan must still run (bug 1.4). Pinned in Task 8 (per-row try/catch test).
5. **Calendar edge times:** a DST change between origin and due date, an origin exactly at closing time, an origin on a non-working day. Pinned in Task 1.

---

## File Structure

**Create**
- `packages/application/src/onboarding/working-calendar.ts`: pure calendar arithmetic (`nextWorkingTime`, `reminderDueAt`). No I/O.
- `packages/application/src/onboarding/onboarding-state.ts`: types, `initialOnboardingState`, `decideOnboarding` (pure transitions and effects).
- `packages/application/src/onboarding/onboarding-copy.ts`: approved copy, message split, button definitions, acknowledgement and reminder texts.
- `packages/application/src/onboarding/onboarding-signal.ts`: `interpretOnboardingSignal`, which maps the classifier signal plus state to an event or a clarify request.
- `packages/application/src/onboarding/index.ts`: barrel.
- `packages/application/src/ports/onboarding.port.ts`: `OnboardingStateRepositoryPort` and `OnboardingTurnPort` (orchestrator-facing).
- `packages/contracts/src/onboarding.ts`: `WorkCalendarSchema`, `OnboardingActionSchema`, `OnboardingSignalSchema`, the `OnboardingActionJob` queue payload, and the `OnboardingReminderJob` queue payload.
- `packages/database/src/schema/onboarding.ts`: tables `tenant_work_calendars` and `onboarding_states`.
- `packages/database/migrations/0026_*.sql`, generated.
- `apps/api/src/onboarding/company-calendar.service.ts`, plus its test.
- `apps/api/scripts/configure-company-calendar.ts`: internal operator CLI.
- `apps/api/src/channel/slack-interaction.ts`: validation and enqueue of `block_actions`.
- `apps/worker/src/onboarding/onboarding.module.ts`
- `apps/worker/src/onboarding/onboarding-state.repository.ts`
- `apps/worker/src/onboarding/onboarding.service.ts`: load → decide → persist → execute effects.
- `apps/worker/src/onboarding/onboarding-action.processor.ts`
- `apps/worker/src/onboarding/onboarding-reminder.processor.ts`
- `apps/worker/src/onboarding/onboarding-intro.service.ts`: sends the two intro messages (replaces the model-generated first contact).

**Modify (main touch points)**
- `packages/contracts/src/channel.ts`: `OutgoingMessage.actions?`, new `interaction` event variant.
- `packages/contracts/src/queue.ts`: queues `ONBOARDING_ACTION` and `ONBOARDING_REMINDER`.
- `packages/contracts/src/ai.ts`: `SituationClassificationSchema.onboardingSignal`.
- `packages/channel-core/src/ports/channel-adapter.port.ts`: `UpdateOutgoingMessage.externalChannelId`.
- `packages/channel-slack/src/slack.adapter.ts`: Block Kit buttons; fix the `chat.update` channel bug.
- `packages/channel-slack/src/slack.normalizer.ts`: `block_actions` becomes `interaction`.
- `packages/ai-openai/src/prompts/classify.ts`: onboarding section, only when context is provided.
- `packages/application/src/use-cases/conversation-orchestrator.ts`: call `OnboardingTurnPort` after classification; gate survey evidence.
- `packages/application/src/use-cases/proactive-check-in.use-case.ts`: `onboardingStart` mode.
- `apps/api/src/channel/slack-ingest.service.ts`, `slack-socket-mode.service.ts`, `slack-events.controller.ts`, `main.ts`
- `apps/api/src/hierarchy/hierarchy-rollout.service.ts`: calendar gate.
- `apps/api/src/hierarchy/hierarchy-mutation.service.ts`, `hierarchy-deactivation.service.ts`: emit role/deactivation events.
- `apps/worker/src/conversation/onboarding-dispatch.service.ts`: use `OnboardingIntroService`.
- `apps/worker/src/message-send/message-send.processor.ts`: pass `actions`, record intro ts.
- `apps/worker/src/proactive/proactive-scan.processor.ts`: reminder recovery sweep.

---

## Phase overview

| Phase | Tasks | Ships independently? | Depends on |
|---|---|---|---|
| A. Foundations | 1 Calendar math · 2 Schema + settings + rollout gate · 3 State machine + copy | Yes. Nothing user-visible changes except the rollout block. | — |
| B. Buttons path | 4 Persistence service · 5 Slack buttons in/out | Yes, behind dispatch switch in Task 7 | A |
| C. Text path | 6 Classifier signal + orchestrator hook | Yes | 4 |
| D. Runtime wiring | 7 Intro dispatch + start conversation + Pulse gating · 8 Reminder | Yes | 4, 5 |
| E. Lifecycle & visibility | 9 Role change / deactivation · 10 Customer aggregates | Yes | 4 |
| F. Release checks | 11 Simulations, harness, Slack interactivity check (Q26 owner) | — | all |

Each phase is one PR to `codex/onboarding-v2` or a stacked branch. Merge order follows the table.

---

### Task 1: Working-calendar arithmetic

**Files:**
- Create: `packages/application/src/onboarding/working-calendar.ts`
- Create: `packages/application/src/onboarding/working-calendar.test.ts`
- Create: `packages/contracts/src/onboarding.ts` (calendar part only)
- Modify: `packages/contracts/src/index.ts` (export)

**Interfaces:**
- Produces:
  - `WorkCalendar = { timezone: string; workingDays: number[] /* ISO 1=Mon..7=Sun */; workStart: string /* 'HH:MM' */; workEnd: string }`
  - `WorkCalendarSchema`
  - `nextWorkingTime(at: Date, calendar: WorkCalendar, timeZone: string): Date`
  - `reminderDueAt(origin: Date, calendar: WorkCalendar, timeZone: string): Date`
  - `timeZone` is a separate argument so that A1 is decided by the caller.

- [ ] **Step 1: Add the contract**

```ts
// packages/contracts/src/onboarding.ts
import { z } from 'zod';

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const WorkCalendarSchema = z.object({
  timezone: z.string().refine((tz) => {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
  }, 'invalid IANA timezone'),
  workingDays: z.array(z.number().int().min(1).max(7)).min(1)
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  workStart: HHMM,
  workEnd: HHMM,
}).refine((c) => c.workStart < c.workEnd, 'workStart must be before workEnd');
export type WorkCalendar = z.infer<typeof WorkCalendarSchema>;
```

Add `export * from './onboarding';` to `packages/contracts/src/index.ts`.

- [ ] **Step 2: Write the failing tests.** The Q12 worked examples are Monday–Friday 09:00–18:00 in `Europe/Kyiv`. Kyiv is UTC+3 until 2026-10-25 04:00 local, then UTC+2.

```ts
// packages/application/src/onboarding/working-calendar.test.ts
import { describe, expect, it } from 'vitest';
import { nextWorkingTime, reminderDueAt } from './working-calendar';

const cal = { timezone: 'Europe/Kyiv', workingDays: [1, 2, 3, 4, 5], workStart: '09:00', workEnd: '18:00' };
const tz = 'Europe/Kyiv';

describe('reminderDueAt (answers Q12)', () => {
  it('Monday 15:00 delivery -> Wednesday 15:00', () => {
    expect(reminderDueAt(new Date('2026-10-05T12:00:00Z'), cal, tz).toISOString()).toBe('2026-10-07T12:00:00.000Z');
  });
  it('Thursday 17:55 Later -> Monday 17:55', () => {
    expect(reminderDueAt(new Date('2026-10-08T14:55:00Z'), cal, tz).toISOString()).toBe('2026-10-12T14:55:00.000Z');
  });
  it('Saturday 12:00 delivery -> Tuesday 12:00 (origin day never counts)', () => {
    expect(reminderDueAt(new Date('2026-10-10T09:00:00Z'), cal, tz).toISOString()).toBe('2026-10-13T09:00:00.000Z');
  });
  it('origin after closing -> next working opening after the 2nd working date', () => {
    // Monday 20:00 local -> Wednesday 20:00 is outside hours -> Thursday 09:00
    expect(reminderDueAt(new Date('2026-10-05T17:00:00Z'), cal, tz).toISOString()).toBe('2026-10-08T06:00:00.000Z');
  });
  it('origin exactly at closing time counts as outside hours (end exclusive)', () => {
    // Monday 18:00 -> Wednesday 18:00 -> Thursday 09:00
    expect(reminderDueAt(new Date('2026-10-05T15:00:00Z'), cal, tz).toISOString()).toBe('2026-10-08T06:00:00.000Z');
  });
  it('keeps local wall time across the DST change', () => {
    // Friday 2026-10-23 15:00 (+03) -> Tuesday 2026-10-27 15:00 (+02)
    expect(reminderDueAt(new Date('2026-10-23T12:00:00Z'), cal, tz).toISOString()).toBe('2026-10-27T13:00:00.000Z');
  });
  it('the user timezone is applied independently of the calendar timezone', () => {
    // Lisbon user, Monday 15:00 Lisbon (+01) -> Wednesday 15:00 Lisbon
    expect(reminderDueAt(new Date('2026-10-05T14:00:00Z'), cal, 'Europe/Lisbon').toISOString()).toBe('2026-10-07T14:00:00.000Z');
  });
});

describe('nextWorkingTime', () => {
  it('returns the same instant inside working hours', () => {
    const at = new Date('2026-10-07T08:00:00Z'); // Wed 11:00 Kyiv
    expect(nextWorkingTime(at, cal, tz).toISOString()).toBe(at.toISOString());
  });
  it('moves an early-morning time to opening on the same day', () => {
    expect(nextWorkingTime(new Date('2026-10-07T03:00:00Z'), cal, tz).toISOString()).toBe('2026-10-07T06:00:00.000Z');
  });
  it('moves a weekend time to Monday opening', () => {
    expect(nextWorkingTime(new Date('2026-10-10T09:00:00Z'), cal, tz).toISOString()).toBe('2026-10-12T06:00:00.000Z');
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `pnpm --filter @entalent/application exec vitest run src/onboarding/working-calendar.test.ts`
Expected: FAIL, "Cannot find module './working-calendar'".

- [ ] **Step 4: Implement.** There is no date library in the repo. Use `Intl` with two-pass offset correction. No minute scanning (the reverted code scanned up to 3,240 minutes).

```ts
// packages/application/src/onboarding/working-calendar.ts
import type { WorkCalendar } from '@entalent/contracts';

interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; isoWeekday: number }

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function localParts(at: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(at).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), isoWeekday: WEEKDAY[parts.weekday!]!,
  };
}

/** UTC instant for a local wall-clock time; nonexistent DST times roll forward. */
function fromLocal(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wallAsUtc;
  for (let i = 0; i < 2; i += 1) {
    const p = localParts(new Date(guess), timeZone);
    const shownAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wallAsUtc - shownAsUtc;
  }
  return new Date(guess);
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

function addLocalDays(p: LocalParts, days: number): { year: number; month: number; day: number; isoWeekday: number } {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), isoWeekday: ((d.getUTCDay() + 6) % 7) + 1 };
}

export function nextWorkingTime(at: Date, calendar: WorkCalendar, timeZone: string): Date {
  const start = minutesOf(calendar.workStart);
  const end = minutesOf(calendar.workEnd);
  const p = localParts(at, timeZone);
  const minute = p.hour * 60 + p.minute;
  if (calendar.workingDays.includes(p.isoWeekday)) {
    if (minute >= start && minute < end) return at;
    if (minute < start) return fromLocal(p.year, p.month, p.day, Math.floor(start / 60), start % 60, timeZone);
  }
  for (let offset = 1; offset <= 7; offset += 1) {
    const d = addLocalDays(p, offset);
    if (calendar.workingDays.includes(d.isoWeekday)) {
      return fromLocal(d.year, d.month, d.day, Math.floor(start / 60), start % 60, timeZone);
    }
  }
  throw new Error('work calendar has no working days');
}

export function reminderDueAt(origin: Date, calendar: WorkCalendar, timeZone: string): Date {
  const p = localParts(origin, timeZone);
  let counted = 0;
  let offset = 0;
  let target = addLocalDays(p, 0);
  while (counted < 2) {
    offset += 1;
    target = addLocalDays(p, offset);
    if (calendar.workingDays.includes(target.isoWeekday)) counted += 1;
  }
  const candidate = fromLocal(target.year, target.month, target.day, p.hour, p.minute, timeZone);
  return nextWorkingTime(candidate, calendar, timeZone);
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm --filter @entalent/application exec vitest run src/onboarding/working-calendar.test.ts`
Expected: 10 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/onboarding.ts packages/contracts/src/index.ts packages/application/src/onboarding/working-calendar.ts packages/application/src/onboarding/working-calendar.test.ts
git commit -m "feat(onboarding): working-calendar reminder arithmetic"
```

---

### Task 2: Schema, company calendar settings, rollout gate

**Files:**
- Create: `packages/database/src/schema/onboarding.ts`
- Modify: `packages/database/src/schema/index.ts` (add `export * from './onboarding';`)
- Generate: `packages/database/migrations/0026_*.sql` plus meta
- Create: `packages/database/src/__tests__/onboarding.integration.test.ts`
- Create: `apps/api/src/onboarding/company-calendar.service.ts` and `.test.ts`
- Create: `apps/api/scripts/configure-company-calendar.ts`
- Modify: `apps/api/src/hierarchy/hierarchy-rollout.service.ts:~107` (gate inside the transaction) and `hierarchy-rollout.service.test.ts`
- Modify: `apps/api/src/hierarchy/company-setup-read.service.ts` (expose `calendarConfigured: boolean`, values read-only) and `company-setup-ui.controller.ts` (show the "calendar not configured by enTalent" blocker)

**Interfaces:**
- Produces:
  - Tables `tenant_work_calendars` and `onboarding_states` (columns below).
  - `CompanyCalendarService.get(tenantId): Promise<WorkCalendar & { language: 'en' } | null>`
  - `CompanyCalendarService.configure(tenantId, input: WorkCalendar, operator: string): Promise<void>`
  - `HierarchyRolloutError('work_calendar_not_configured')`

- [ ] **Step 1: Schema**

```ts
// packages/database/src/schema/onboarding.ts
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { people } from './people';

/** Company working calendar entered by enTalent staff. Absence means rollout is blocked (Q18). */
export const tenantWorkCalendars = pgTable('tenant_work_calendars', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  timezone: text('timezone').notNull(),
  workingDays: smallint('working_days').array().notNull(),
  workStart: text('work_start').notNull(),
  workEnd: text('work_end').notNull(),
  onboardingLanguage: text('onboarding_language').notNull().default('en'),
  updatedBy: text('updated_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hhmm: check('tenant_work_calendars_hours_valid', sql`${t.workStart} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ${t.workEnd} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ${t.workStart} < ${t.workEnd}`),
  days: check('tenant_work_calendars_days_valid', sql`cardinality(${t.workingDays}) > 0 AND ${t.workingDays} <@ ARRAY[1,2,3,4,5,6,7]::smallint[]`),
  language: check('tenant_work_calendars_language_valid', sql`${t.onboardingLanguage} = 'en'`),
}));

/** Per-person onboarding and personal-participation state. Never reporting consent. */
export const onboardingStates = pgTable('onboarding_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull(),
  track: text('track').notNull(),
  introStatus: text('intro_status').notNull().default('pending'),
  participation: text('participation').notNull(),
  managementAckAt: timestamp('management_ack_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  reminderStatus: text('reminder_status').notNull().default('none'),
  reminderOriginAt: timestamp('reminder_origin_at', { withTimezone: true }),
  reminderDueAt: timestamp('reminder_due_at', { withTimezone: true }),
  reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
  introChannelId: text('intro_channel_id'),
  introActionsMessageTs: text('intro_actions_message_ts'),
  buttonsActive: boolean('buttons_active').notNull().default(false),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  personTenant: foreignKey({ columns: [t.personId, t.tenantId], foreignColumns: [people.id, people.tenantId] }).onDelete('cascade'),
  onePerPerson: uniqueIndex('onboarding_states_tenant_person_idx').on(t.tenantId, t.personId),
  dueReminders: index('onboarding_states_due_reminder_idx').on(t.reminderStatus, t.reminderDueAt),
  track: check('onboarding_states_track_valid', sql`${t.track} IN ('employee', 'team_lead', 'management')`),
  intro: check('onboarding_states_intro_valid', sql`${t.introStatus} IN ('pending', 'delivered', 'completed')`),
  participation: check('onboarding_states_participation_valid', sql`${t.participation} IN ('undecided', 'deferred', 'active', 'declined', 'not_applicable')`),
  managementNoParticipation: check('onboarding_states_management_not_applicable', sql`(${t.track} = 'management') = (${t.participation} = 'not_applicable')`),
  reminder: check('onboarding_states_reminder_valid', sql`${t.reminderStatus} IN ('none', 'scheduled', 'sent', 'cancelled')`),
  scheduledHasDue: check('onboarding_states_scheduled_has_due', sql`${t.reminderStatus} <> 'scheduled' OR ${t.reminderDueAt} IS NOT NULL`),
  managementNoReminder: check('onboarding_states_management_no_reminder', sql`${t.track} <> 'management' OR ${t.reminderStatus} IN ('none', 'cancelled')`),
}));
```

- [ ] **Step 2: Generate the migration and review it**

Run: `pnpm db:generate`
Expected: a new `packages/database/migrations/0026_<name>.sql` creating both tables, the checks and the indexes, with no changes to other tables. Read the SQL. Then run `docker compose up -d postgres && pnpm db:migrate` (local DB only).

- [ ] **Step 3: Integration test for the constraints** (pattern: `packages/database/src/__tests__/people.integration.test.ts`)

```ts
// packages/database/src/__tests__/onboarding.integration.test.ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeTestDb, describeIntegration, getTestDb, runMigrationsOnce } from './integration-setup';
import { onboardingStates, people, tenantWorkCalendars, tenants, users } from '../schema';

describeIntegration('onboarding schema', () => {
  const tenantId = randomUUID();
  const personId = randomUUID();
  beforeAll(async () => {
    await runMigrationsOnce();
    const db = getTestDb();
    await db.insert(tenants).values({ id: tenantId, name: 'onb' });
    await db.insert(users).values({ id: personId, tenantId, status: 'active' } as never);
    await db.insert(people).values({ id: personId, tenantId, customerEmployeeId: 'e1', workEmail: 'e1@x.io',
      displayName: 'E1', primaryRole: 'manager', pulseParticipant: false, lifecycleStatus: 'active' });
  });
  afterAll(async () => { await getTestDb().delete(tenants).where(eq(tenants.id, tenantId)); await closeTestDb(); });

  it('rejects a calendar with start after end', async () => {
    await expect(getTestDb().insert(tenantWorkCalendars).values({ tenantId, timezone: 'Europe/Kyiv',
      workingDays: [1], workStart: '18:00', workEnd: '09:00', updatedBy: 'op@entalent' })).rejects.toThrow();
  });
  it('rejects a management track with a participation value', async () => {
    await expect(getTestDb().insert(onboardingStates).values({ tenantId, personId, track: 'management',
      participation: 'active' })).rejects.toThrow();
  });
  it('rejects a scheduled reminder for management', async () => {
    await expect(getTestDb().insert(onboardingStates).values({ tenantId, personId, track: 'management',
      participation: 'not_applicable', reminderStatus: 'scheduled', reminderDueAt: new Date() })).rejects.toThrow();
  });
  it('allows one state row per person', async () => {
    const db = getTestDb();
    await db.insert(onboardingStates).values({ tenantId, personId, track: 'management', participation: 'not_applicable' });
    await expect(db.insert(onboardingStates).values({ tenantId, personId, track: 'management',
      participation: 'not_applicable' })).rejects.toThrow();
  });
});
```

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5434/entalent pnpm --filter @entalent/database test:integration -- onboarding`
Expected: 4 passed.

- [ ] **Step 4: `CompanyCalendarService` unit test first** (`apps/api/src/onboarding/company-calendar.service.test.ts`). Use the fake `db.client.transaction` pattern from `hierarchy-rollout.service.test.ts`. Cases:
  - `configure` validates with `WorkCalendarSchema` and throws `CompanyCalendarError('invalid_calendar')` for `workingDays: []`.
  - `configure` upserts the row and inserts an `audit_logs` row `{ actorType: 'internal_operator', actorId: operator, action: 'org.work_calendar.configure', resourceType: 'tenant', resourceId: tenantId, metadata: { before, after } }` in the same transaction.
  - An empty `operator` throws `CompanyCalendarError('operator_required')` (A4).
  - After a successful `configure`, it calls `recalculateScheduledReminders(tenantId)` on an injected `OnboardingReminderRecalculator` port. Q16 is implemented in Task 8; until then use a no-op provider.

- [ ] **Step 5: Implement `CompanyCalendarService`**

```ts
// apps/api/src/onboarding/company-calendar.service.ts
import { Inject, Injectable, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { WorkCalendarSchema, type WorkCalendar } from '@entalent/contracts';
import { auditLogs, tenantWorkCalendars } from '@entalent/database';
import { DatabaseService } from '../database/database.service';

export class CompanyCalendarError extends Error {
  constructor(readonly code: 'invalid_calendar' | 'operator_required') { super(code); this.name = 'CompanyCalendarError'; }
}

export const ONBOARDING_REMINDER_RECALCULATOR = Symbol('ONBOARDING_REMINDER_RECALCULATOR');
export interface OnboardingReminderRecalculator { recalculateScheduledReminders(tenantId: string): Promise<void> }

@Injectable()
export class CompanyCalendarService {
  constructor(
    private readonly db: DatabaseService,
    @Optional() @Inject(ONBOARDING_REMINDER_RECALCULATOR) private readonly recalculator?: OnboardingReminderRecalculator,
  ) {}

  async get(tenantId: string): Promise<WorkCalendar | null> {
    const [row] = await this.db.client.select().from(tenantWorkCalendars).where(eq(tenantWorkCalendars.tenantId, tenantId));
    return row ? { timezone: row.timezone, workingDays: row.workingDays, workStart: row.workStart, workEnd: row.workEnd } : null;
  }

  async configure(tenantId: string, input: unknown, operator: string): Promise<WorkCalendar> {
    if (!operator.trim()) throw new CompanyCalendarError('operator_required');
    const parsed = WorkCalendarSchema.safeParse(input);
    if (!parsed.success) throw new CompanyCalendarError('invalid_calendar');
    const after = parsed.data;
    await this.db.client.transaction(async (tx) => {
      const [before] = await tx.select().from(tenantWorkCalendars).where(eq(tenantWorkCalendars.tenantId, tenantId)).for('update');
      await tx.insert(tenantWorkCalendars).values({ tenantId, ...after, updatedBy: operator })
        .onConflictDoUpdate({ target: tenantWorkCalendars.tenantId, set: { ...after, updatedBy: operator, updatedAt: new Date() } });
      await tx.insert(auditLogs).values({ tenantId, actorType: 'internal_operator', actorId: operator,
        action: 'org.work_calendar.configure', resourceType: 'tenant', resourceId: tenantId,
        metadata: { before: before ?? null, after } });
    });
    await this.recalculator?.recalculateScheduledReminders(tenantId);
    return after;
  }
}
```

Check the actual `DatabaseService` import path used by `hierarchy-rollout.service.ts` and match it.

- [ ] **Step 6: CLI script** `apps/api/scripts/configure-company-calendar.ts`. Model it on `apps/api/scripts/rollout-legacy-employee.ts` (bootstrap a Nest application context, parse args). Usage:

```bash
pnpm --filter @entalent/api exec tsx scripts/configure-company-calendar.ts --tenant <uuid> --timezone Europe/Kyiv --days 1,2,3,4,5 --start 09:00 --end 18:00 --operator illia@entalent
```

The script prints the stored calendar as JSON and exits non-zero on `CompanyCalendarError`.

- [ ] **Step 7: Rollout gate test first** (`hierarchy-rollout.service.test.ts`): `activateUnits` throws `HierarchyRolloutError('work_calendar_not_configured')` and writes `org.unit.rollout.rejected` when there is no `tenant_work_calendars` row. The existing happy-path tests insert a calendar row in their fixture. `previewUnits` returns `ready: false` with the issue `{ code: 'work_calendar_not_configured' }` so the UI can show it before the click.

- [ ] **Step 8: Implement the gate** inside the transaction, right after `assertWorkspace`:

```ts
const [calendar] = await tx.select({ tenantId: tenantWorkCalendars.tenantId })
  .from(tenantWorkCalendars).where(eq(tenantWorkCalendars.tenantId, tenantId));
if (!calendar) throw new HierarchyRolloutError('work_calendar_not_configured');
```

Map the code in `company-setup.controller.ts` to `UnprocessableEntityException` the same way as `unit_not_ready`.

- [ ] **Step 9: Run**

Run: `pnpm --filter @entalent/api test -- hierarchy-rollout company-calendar && pnpm --filter @entalent/api typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/database apps/api/src/onboarding apps/api/scripts/configure-company-calendar.ts apps/api/src/hierarchy
git commit -m "feat(onboarding): company work calendar, onboarding state schema, rollout gate"
```

---

### Task 3: Pure onboarding state machine and approved copy

**Files:**
- Create: `packages/application/src/onboarding/onboarding-state.ts` and `.test.ts`
- Create: `packages/application/src/onboarding/onboarding-copy.ts` and `.test.ts`
- Create: `packages/application/src/onboarding/index.ts`
- Modify: `packages/application/src/index.ts` (export)
- Modify: `packages/contracts/src/onboarding.ts` (add `OnboardingActionSchema`)

**Interfaces:**
- Produces:

```ts
export type OnboardingTrack = 'employee' | 'team_lead' | 'management';
export type Participation = 'undecided' | 'deferred' | 'active' | 'declined' | 'not_applicable';
export type OnboardingAction = 'start' | 'later' | 'decline' | 'got_it';
export type AckKey = 'later_before_reminder' | 'later_after_reminder' | 'decline' | 'got_it_team_lead'
  | 'got_it_management' | 'already_complete';

export interface OnboardingState {
  track: OnboardingTrack;
  introStatus: 'pending' | 'delivered' | 'completed';
  participation: Participation;
  managementAckAt: Date | null;
  completedAt: Date | null;
  reminderStatus: 'none' | 'scheduled' | 'sent' | 'cancelled';
  reminderOriginAt: Date | null;
  buttonsActive: boolean;
}

export type OnboardingEvent =
  | { type: 'intro_delivered'; at: Date }
  | { type: 'action'; action: OnboardingAction; source: 'button' | 'text'; at: Date }
  | { type: 'substantive_turn'; at: Date }
  | { type: 'stop_requested'; at: Date }
  | { type: 'reminder_sent'; at: Date }
  | { type: 'role_changed'; to: PrimaryOrgRole; at: Date }
  | { type: 'deactivated'; at: Date };

export type OnboardingEffect =
  | { type: 'start_conversation' }
  | { type: 'acknowledge'; key: AckKey }
  | { type: 'schedule_reminder'; originAt: Date }
  | { type: 'cancel_reminder' }
  | { type: 'remove_buttons'; replacement: AckKey | 'started' }
  | { type: 'set_proactive'; enabled: boolean }
  | { type: 'send_intro'; track: OnboardingTrack };

export function trackForRole(role: PrimaryOrgRole): OnboardingTrack;
export function initialOnboardingState(role: PrimaryOrgRole): OnboardingState;
export function decideOnboarding(state: OnboardingState, event: OnboardingEvent): { next: OnboardingState; effects: OnboardingEffect[] };
```

- `onboarding-copy.ts` produces:
  - `introMessages(role: PrimaryOrgRole): { intro: string; trust: string; actions: Array<{ action: OnboardingAction; label: string }> }`
  - `ACK_COPY: Record<AckKey, string>`
  - `reminderCopy(track: 'employee' | 'team_lead'): string`
  - `EMPTY_BACKLOG_OPENER`
  - `STARTED_REPLACEMENT = "Let's talk."`

- [ ] **Step 1: Write the transition tests.** One `it` per row; these rows are the executable spec of answers Q2–Q15.

```ts
// packages/application/src/onboarding/onboarding-state.test.ts
import { describe, expect, it } from 'vitest';
import { decideOnboarding, initialOnboardingState, type OnboardingState } from './onboarding-state';

const t0 = new Date('2026-10-05T12:00:00Z');
const t1 = new Date('2026-10-06T12:00:00Z');
const delivered = (role: Parameters<typeof initialOnboardingState>[0]): OnboardingState =>
  decideOnboarding(initialOnboardingState(role), { type: 'intro_delivered', at: t0 }).next;
const types = (e: { type: string }[]) => e.map((x) => x.type);

describe('employee', () => {
  it('delivery schedules the silence reminder from delivery time (Q12)', () => {
    const r = decideOnboarding(initialOnboardingState('employee'), { type: 'intro_delivered', at: t0 });
    expect(r.next).toMatchObject({ introStatus: 'delivered', participation: 'undecided', reminderStatus: 'scheduled', buttonsActive: true });
    expect(r.effects).toEqual([{ type: 'schedule_reminder', originAt: t0 }]);
  });
  it.each(['button', 'text'] as const)('start via %s activates, cancels reminder, starts conversation, removes buttons', (source) => {
    const r = decideOnboarding(delivered('employee'), { type: 'action', action: 'start', source, at: t1 });
    expect(r.next).toMatchObject({ introStatus: 'completed', participation: 'active', reminderStatus: 'cancelled', buttonsActive: false, completedAt: t1 });
    expect(types(r.effects)).toEqual(['cancel_reminder', 'set_proactive', 'remove_buttons', 'start_conversation']);
    expect(r.effects).toContainEqual({ type: 'set_proactive', enabled: true });
  });
  it('duplicate start while active has no effects (Q6)', () => {
    const active = decideOnboarding(delivered('employee'), { type: 'action', action: 'start', source: 'button', at: t1 }).next;
    expect(decideOnboarding(active, { type: 'action', action: 'start', source: 'button', at: t1 }).effects).toEqual([]);
  });
  it('later reschedules from the latest Later (Q13)', () => {
    const r = decideOnboarding(delivered('employee'), { type: 'action', action: 'later', source: 'text', at: t1 });
    expect(r.next).toMatchObject({ participation: 'deferred', reminderStatus: 'scheduled', reminderOriginAt: t1 });
    expect(r.effects).toEqual([
      { type: 'schedule_reminder', originAt: t1 },
      { type: 'remove_buttons', replacement: 'later_before_reminder' },
      { type: 'acknowledge', key: 'later_before_reminder' },
    ]);
  });
  it('later after the single reminder was sent does not schedule another (Q13, G2)', () => {
    const reminded = decideOnboarding(delivered('employee'), { type: 'reminder_sent', at: t1 }).next;
    const r = decideOnboarding(reminded, { type: 'action', action: 'later', source: 'text', at: t1 });
    expect(r.next.reminderStatus).toBe('sent');
    expect(types(r.effects)).not.toContain('schedule_reminder');
    expect(r.effects).toContainEqual({ type: 'acknowledge', key: 'later_after_reminder' });
  });
  it('later while active only explains the intro is complete (Q6)', () => {
    const active = decideOnboarding(delivered('employee'), { type: 'action', action: 'start', source: 'button', at: t1 }).next;
    const r = decideOnboarding(active, { type: 'action', action: 'later', source: 'button', at: t1 });
    expect(r.next).toEqual(active);
    expect(r.effects).toEqual([{ type: 'acknowledge', key: 'already_complete' }]);
  });
  it('decline cancels reminder and disables proactive contact (Q3)', () => {
    const r = decideOnboarding(delivered('employee'), { type: 'action', action: 'decline', source: 'button', at: t1 });
    expect(r.next).toMatchObject({ participation: 'declined', reminderStatus: 'cancelled', introStatus: 'delivered' });
    expect(r.effects).toContainEqual({ type: 'set_proactive', enabled: false });
    expect(r.effects).toContainEqual({ type: 'acknowledge', key: 'decline' });
  });
  it('decline while active stops participation (Q4, Q6)', () => {
    const active = decideOnboarding(delivered('employee'), { type: 'action', action: 'start', source: 'button', at: t1 }).next;
    const r = decideOnboarding(active, { type: 'stop_requested', at: t1 });
    expect(r.next.participation).toBe('declined');
    expect(r.effects).toContainEqual({ type: 'set_proactive', enabled: false });
  });
  it('a substantive turn from an undecided person completes onboarding without starting a backlog question (Q2b, Q25)', () => {
    const r = decideOnboarding(delivered('employee'), { type: 'substantive_turn', at: t1 });
    expect(r.next).toMatchObject({ participation: 'active', introStatus: 'completed', reminderStatus: 'cancelled' });
    expect(types(r.effects)).not.toContain('start_conversation');
    expect(r.effects).toContainEqual({ type: 'remove_buttons', replacement: 'started' });
  });
  it('a substantive turn after refusal resumes participation silently (Q3, Q5)', () => {
    const declined = decideOnboarding(delivered('employee'), { type: 'action', action: 'decline', source: 'button', at: t0 }).next;
    const r = decideOnboarding(declined, { type: 'substantive_turn', at: t1 });
    expect(r.next.participation).toBe('active');
    expect(r.effects).toEqual([{ type: 'set_proactive', enabled: true }]);
  });
  it("an old Let's Talk after refusal resumes and starts the conversation (Q6)", () => {
    const declined = decideOnboarding(delivered('employee'), { type: 'action', action: 'decline', source: 'button', at: t0 }).next;
    const r = decideOnboarding(declined, { type: 'action', action: 'start', source: 'button', at: t1 });
    expect(r.next.participation).toBe('active');
    expect(types(r.effects)).toContain('start_conversation');
    expect(types(r.effects)).not.toContain('schedule_reminder');
  });
  it('later after refusal never schedules a reminder', () => {
    const declined = decideOnboarding(delivered('employee'), { type: 'action', action: 'decline', source: 'button', at: t0 }).next;
    const r = decideOnboarding(declined, { type: 'action', action: 'later', source: 'button', at: t1 });
    expect(r.next.participation).toBe('declined');
    expect(types(r.effects)).not.toContain('schedule_reminder');
  });
});

describe('team lead', () => {
  it('got it completes and enables Pulse participation without starting a conversation (Q10)', () => {
    const r = decideOnboarding(delivered('team_lead'), { type: 'action', action: 'got_it', source: 'button', at: t1 });
    expect(r.next).toMatchObject({ participation: 'active', introStatus: 'completed', managementAckAt: t1, reminderStatus: 'cancelled' });
    expect(types(r.effects)).not.toContain('start_conversation');
    expect(r.effects).toContainEqual({ type: 'acknowledge', key: 'got_it_team_lead' });
  });
  it('no personal check-ins declines but acknowledges the management intro', () => {
    const r = decideOnboarding(delivered('team_lead'), { type: 'action', action: 'decline', source: 'button', at: t1 });
    expect(r.next).toMatchObject({ participation: 'declined', managementAckAt: t1 });
  });
});

describe('management roles', () => {
  it.each(['manager', 'hr', 'hrbp', 'leadership'] as const)('%s: delivery schedules no reminder (Q14)', (role) => {
    const r = decideOnboarding(initialOnboardingState(role), { type: 'intro_delivered', at: t0 });
    expect(r.next).toMatchObject({ participation: 'not_applicable', reminderStatus: 'none' });
    expect(r.effects).toEqual([]);
  });
  it('got it (button or acknowledging text) completes (Q2a)', () => {
    const r = decideOnboarding(delivered('manager'), { type: 'action', action: 'got_it', source: 'text', at: t1 });
    expect(r.next).toMatchObject({ introStatus: 'completed', managementAckAt: t1 });
    expect(r.effects).toContainEqual({ type: 'acknowledge', key: 'got_it_management' });
  });
  it('substantive turns never enable proactive contact (Q11)', () => {
    expect(decideOnboarding(delivered('manager'), { type: 'substantive_turn', at: t1 }).effects).toEqual([]);
  });
  it.each(['start', 'later', 'decline'] as const)('%s is not a valid management action and is ignored', (action) => {
    expect(decideOnboarding(delivered('manager'), { type: 'action', action, source: 'button', at: t1 }).effects).toEqual([]);
  });
});

describe('role changes (Q8) and deactivation (Q9)', () => {
  it('employee -> team lead keeps participation and sends the team-lead intro (A7)', () => {
    const active = decideOnboarding(delivered('employee'), { type: 'action', action: 'start', source: 'button', at: t1 }).next;
    const r = decideOnboarding(active, { type: 'role_changed', to: 'team_lead', at: t1 });
    expect(r.next).toMatchObject({ track: 'team_lead', participation: 'active', managementAckAt: null });
    expect(r.effects).toContainEqual({ type: 'send_intro', track: 'team_lead' });
  });
  it('team lead -> manager stops personal Pulse', () => {
    const tl = decideOnboarding(delivered('team_lead'), { type: 'action', action: 'got_it', source: 'button', at: t1 }).next;
    const r = decideOnboarding(tl, { type: 'role_changed', to: 'manager', at: t1 });
    expect(r.next).toMatchObject({ track: 'management', participation: 'not_applicable' });
    expect(r.effects).toContainEqual({ type: 'set_proactive', enabled: false });
    expect(r.effects).toContainEqual({ type: 'send_intro', track: 'management' });
  });
  it('manager -> employee starts a fresh personal onboarding, not enabled automatically (A6)', () => {
    const m = decideOnboarding(delivered('manager'), { type: 'action', action: 'got_it', source: 'button', at: t1 }).next;
    const r = decideOnboarding(m, { type: 'role_changed', to: 'employee', at: t1 });
    expect(r.next).toMatchObject({ track: 'employee', participation: 'undecided', introStatus: 'pending', reminderStatus: 'none' });
    expect(r.effects).toEqual([{ type: 'send_intro', track: 'employee' }]);
  });
  it('team lead -> employee keeps state and sends nothing', () => {
    const tl = decideOnboarding(delivered('team_lead'), { type: 'action', action: 'got_it', source: 'button', at: t1 }).next;
    expect(decideOnboarding(tl, { type: 'role_changed', to: 'employee', at: t1 }).effects).toEqual([]);
  });
  it('deactivation cancels a scheduled reminder and keeps the decision', () => {
    const r = decideOnboarding(delivered('employee'), { type: 'deactivated', at: t1 });
    expect(r.next).toMatchObject({ participation: 'undecided', reminderStatus: 'cancelled' });
    expect(r.effects).toEqual([{ type: 'cancel_reminder' }]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm --filter @entalent/application exec vitest run src/onboarding/onboarding-state.test.ts`
Expected: FAIL, the module is not found.

- [ ] **Step 3: Implement `onboarding-state.ts`**

```ts
// packages/application/src/onboarding/onboarding-state.ts
import type { PrimaryOrgRole } from '../hierarchy/draft-person';
// ...types from the Interfaces block above...

export function trackForRole(role: PrimaryOrgRole): OnboardingTrack {
  if (role === 'employee') return 'employee';
  if (role === 'team_lead') return 'team_lead';
  return 'management';
}

export function initialOnboardingState(role: PrimaryOrgRole): OnboardingState {
  const track = trackForRole(role);
  return {
    track, introStatus: 'pending', participation: track === 'management' ? 'not_applicable' : 'undecided',
    managementAckAt: null, completedAt: null, reminderStatus: 'none', reminderOriginAt: null, buttonsActive: false,
  };
}

const personal = (s: OnboardingState) => s.track !== 'management';
const reminderPending = (s: OnboardingState) => s.reminderStatus === 'scheduled';

function activate(s: OnboardingState, at: Date, replacement: 'started' | AckKey, start: boolean, ack?: AckKey): { next: OnboardingState; effects: OnboardingEffect[] } {
  const effects: OnboardingEffect[] = [];
  if (reminderPending(s)) effects.push({ type: 'cancel_reminder' });
  effects.push({ type: 'set_proactive', enabled: true });
  if (s.buttonsActive) effects.push({ type: 'remove_buttons', replacement });
  if (ack) effects.push({ type: 'acknowledge', key: ack });
  if (start) effects.push({ type: 'start_conversation' });
  return {
    next: { ...s, participation: 'active', introStatus: 'completed', completedAt: s.completedAt ?? at,
      reminderStatus: reminderPending(s) ? 'cancelled' : s.reminderStatus, buttonsActive: false,
      managementAckAt: s.track === 'team_lead' && ack === 'got_it_team_lead' ? at : s.managementAckAt },
    effects,
  };
}

function decline(s: OnboardingState, at: Date): { next: OnboardingState; effects: OnboardingEffect[] } {
  if (s.participation === 'declined') return { next: s, effects: [] };
  const effects: OnboardingEffect[] = [];
  if (reminderPending(s)) effects.push({ type: 'cancel_reminder' });
  effects.push({ type: 'set_proactive', enabled: false });
  if (s.buttonsActive) effects.push({ type: 'remove_buttons', replacement: 'decline' });
  effects.push({ type: 'acknowledge', key: 'decline' });
  return {
    next: { ...s, participation: 'declined', reminderStatus: reminderPending(s) ? 'cancelled' : s.reminderStatus,
      buttonsActive: false, managementAckAt: s.track === 'team_lead' ? s.managementAckAt ?? at : s.managementAckAt },
    effects,
  };
}

export function decideOnboarding(s: OnboardingState, e: OnboardingEvent): { next: OnboardingState; effects: OnboardingEffect[] } {
  switch (e.type) {
    case 'intro_delivered': {
      if (s.introStatus !== 'pending') return { next: s, effects: [] };
      if (!personal(s)) return { next: { ...s, introStatus: 'delivered', buttonsActive: true }, effects: [] };
      return {
        next: { ...s, introStatus: 'delivered', buttonsActive: true, reminderStatus: 'scheduled', reminderOriginAt: e.at },
        effects: [{ type: 'schedule_reminder', originAt: e.at }],
      };
    }
    case 'reminder_sent':
      return { next: { ...s, reminderStatus: 'sent' }, effects: [] };
    case 'deactivated':
      return reminderPending(s)
        ? { next: { ...s, reminderStatus: 'cancelled' }, effects: [{ type: 'cancel_reminder' }] }
        : { next: s, effects: [] };
    case 'stop_requested':
      return personal(s) ? decline(s, e.at) : { next: s, effects: [] };
    case 'substantive_turn': {
      if (!personal(s) || s.participation === 'active') return { next: s, effects: [] };
      if (s.participation === 'declined') {
        return { next: { ...s, participation: 'active' }, effects: [{ type: 'set_proactive', enabled: true }] };
      }
      return activate(s, e.at, 'started', false);
    }
    case 'action':
      return decideAction(s, e.action, e.at);
    case 'role_changed':
      return decideRoleChange(s, e.to);
  }
}

function decideAction(s: OnboardingState, action: OnboardingAction, at: Date) {
  if (s.track === 'management') {
    if (action !== 'got_it') return { next: s, effects: [] as OnboardingEffect[] };
    if (s.introStatus === 'completed') return { next: s, effects: [] as OnboardingEffect[] };
    const effects: OnboardingEffect[] = [];
    if (s.buttonsActive) effects.push({ type: 'remove_buttons', replacement: 'got_it_management' });
    effects.push({ type: 'acknowledge', key: 'got_it_management' });
    return { next: { ...s, introStatus: 'completed' as const, completedAt: at, managementAckAt: at, buttonsActive: false }, effects };
  }
  switch (action) {
    case 'start':
      return s.participation === 'active' ? { next: s, effects: [] as OnboardingEffect[] } : activate(s, at, 'started', true);
    case 'got_it':
      if (s.track !== 'team_lead') return { next: s, effects: [] as OnboardingEffect[] };
      if (s.participation === 'active') return { next: s, effects: [] as OnboardingEffect[] };
      if (s.participation === 'declined') {
        return { next: { ...s, managementAckAt: s.managementAckAt ?? at }, effects: [] as OnboardingEffect[] };
      }
      return activate(s, at, 'got_it_team_lead', false, 'got_it_team_lead');
    case 'decline':
      return decline(s, at);
    case 'later': {
      if (s.participation === 'active') return { next: s, effects: [{ type: 'acknowledge', key: 'already_complete' }] as OnboardingEffect[] };
      if (s.participation === 'declined' || s.reminderStatus === 'sent') {
        return { next: s.participation === 'declined' ? s : { ...s, participation: 'deferred' as const },
          effects: [{ type: 'acknowledge', key: 'later_after_reminder' }] as OnboardingEffect[] };
      }
      const effects: OnboardingEffect[] = [{ type: 'schedule_reminder', originAt: at }];
      if (s.buttonsActive) effects.push({ type: 'remove_buttons', replacement: 'later_before_reminder' });
      effects.push({ type: 'acknowledge', key: 'later_before_reminder' });
      return { next: { ...s, participation: 'deferred' as const, reminderStatus: 'scheduled' as const, reminderOriginAt: at, buttonsActive: false }, effects };
    }
  }
}

function decideRoleChange(s: OnboardingState, to: PrimaryOrgRole) {
  const track = trackForRole(to);
  if (track === s.track) return { next: s, effects: [] as OnboardingEffect[] };
  if (track === 'management') {
    const effects: OnboardingEffect[] = [];
    if (reminderPending(s)) effects.push({ type: 'cancel_reminder' });
    if (s.participation === 'active') effects.push({ type: 'set_proactive', enabled: false });
    effects.push({ type: 'send_intro', track });
    return { next: { ...initialOnboardingState(to), reminderStatus: reminderPending(s) ? 'cancelled' as const : s.reminderStatus }, effects };
  }
  if (s.track === 'management') {
    return { next: initialOnboardingState(to), effects: [{ type: 'send_intro', track }] as OnboardingEffect[] };
  }
  if (track === 'team_lead') {
    return { next: { ...s, track, managementAckAt: null }, effects: [{ type: 'send_intro', track }] as OnboardingEffect[] };
  }
  return { next: { ...s, track }, effects: [] as OnboardingEffect[] };
}
```

The role-change intro (`send_intro`) re-enters `intro_delivered` through the dispatch path in Task 9. For the employee → team_lead case, the new intro must not re-schedule a reminder when the person is already `active`. `intro_delivered` returns early if `introStatus !== 'pending'`, and `completed` stays, which covers it.

- [ ] **Step 4: Copy module and its test.** The test asserts the exact strings and the split boundary:
  - `introMessages('employee').trust.startsWith('Your conversations and individual responses are not shown to anyone.')`
  - `introMessages('hr').intro` differs from `introMessages('manager').intro`; their `trust` blocks are identical.
  - `ACK_COPY.decline === "Understood. I won’t start conversations unless you message me first. You’re welcome to come back anytime."`, and so on, verbatim from G2. `already_complete` is not in G2. Use Q24's "Introduction complete." (approved in discussion).
  - `reminderCopy('employee')` and `reminderCopy('team_lead')` are verbatim from Q14. `EMPTY_BACKLOG_OPENER` is verbatim from G1.
  - The copy file is a straight transcription. Copy every paragraph from `docs/onboarding-v2.md` lines 49–137, keeping the curly apostrophes exactly as in the source.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @entalent/application exec vitest run src/onboarding`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/application/src/onboarding packages/application/src/index.ts packages/contracts/src/onboarding.ts
git commit -m "feat(onboarding): pure state machine and approved copy"
```

---

### Task 4: Onboarding persistence service (worker)

**Files:**
- Create: `apps/worker/src/onboarding/onboarding-state.repository.ts`
- Create: `apps/worker/src/onboarding/onboarding.service.ts` and `.test.ts`
- Create: `apps/worker/src/onboarding/onboarding.module.ts`
- Create: `packages/application/src/ports/onboarding.port.ts`
- Create: `apps/worker/src/onboarding/onboarding.service.integration.test.ts` (local DB, pattern from `onboarding-flow.integration.test.ts`)

**Interfaces:**
- Consumes: `decideOnboarding`, `reminderDueAt`, `ACK_COPY`, `STARTED_REPLACEMENT` (Task 3, Task 1).
- Produces:

```ts
export interface OnboardingApplyResult { changed: boolean; effects: OnboardingEffect[]; state: OnboardingState }
export class OnboardingService {
  apply(tenantId: string, personId: string, event: OnboardingEvent): Promise<OnboardingApplyResult>;
  // executes effects other than start_conversation/acknowledge-as-reply; see below
}
export interface OnboardingTurnPort {   // consumed by the orchestrator in Task 6
  contextFor(tenantId: string, userId: string): Promise<{ state: OnboardingState } | null>;
  applyTurnEvent(tenantId: string, userId: string, event: OnboardingEvent): Promise<OnboardingApplyResult>;
}
```

**Behaviour to implement and test:**
1. **Transaction:** `SELECT … FOR UPDATE` on `onboarding_states` → `decideOnboarding` → `UPDATE … SET version = version + 1`. In the same transaction:
   - for `set_proactive`, `UPDATE users SET proactive_messaging_enabled = $enabled`;
   - for `schedule_reminder`, compute `reminderDueAt(originAt, calendar, userTz ?? calendar.timezone)` (A1) and store `reminder_due_at`;
   - insert an `audit_logs` row `{ actorType: 'user' | 'system', action: 'onboarding.<event>', metadata: { from, to } }`. The metadata holds state names only, never message text.
   - The transaction contains no network calls.
2. **After commit:**
   - `schedule_reminder` → `onboardingReminderQueue.add('remind', { tenantId, personId, dueAt }, { delay, jobId: \`onb-rem:${personId}:${dueAt.getTime()}\` })`.
   - `remove_buttons` → `SlackAdapter.updateMessage({ externalChannelId: introChannelId, externalMessageId: introActionsMessageTs, text: trustText + '\n\n_' + replacementCopy + '_' })` with no actions.
   - A Slack failure is logged and never rethrown, because the state is already committed.
   - `acknowledge` with `source: 'button'` → persist an outbound message (`messageType: 'onboarding_ack'`) and enqueue `message-send`.
   - With `source: 'text'`, the ack is returned to the orchestrator as the reply (Task 6).
   - `start_conversation` → enqueue a `check-in` job with `{ onboardingStart: true }` (Task 7).
3. **No state row** (legacy user, or person not rolled out) → return `{ changed: false, effects: [] }`. The caller continues normally.

Test cases in `onboarding.service.test.ts`, with fake repo/tx/queue/adapter:
- `set_proactive` updates `users` in the same tx (assert call order: lock, update state, update users, audit, commit).
- `schedule_reminder` uses the user timezone, falling back to the calendar timezone (A1).
- A Slack `updateMessage` rejection does not throw and the state stays committed.
- Two concurrent `apply` calls for `start`: the second sees `active` and gets no effects. In the integration test, use two parallel calls against the local DB and assert exactly one `check-in` job.
- `remove_buttons` with `introActionsMessageTs = null` skips the Slack call.

- [ ] Steps: write the tests → see them fail → implement the repository (Drizzle, `for('update')`) and the service → see them pass → run `pnpm --filter @entalent/worker test -- onboarding` and `typecheck` → commit `feat(onboarding): transactional state service with post-commit effects`.

---

### Task 5: Slack buttons out and interactions in

**Files:**
- Modify: `packages/contracts/src/channel.ts`
  - `OutgoingMessageSchema.actions: z.array(z.object({ actionId: z.string(), label: z.string(), value: z.string() })).max(5).optional()`
  - a new `interaction` variant in `NormalizedChannelEventSchema`: `{ type: 'interaction', payload: { externalWorkspaceId, externalUserId, externalChannelId, messageTs, actionId, value, actionTs } }`.
- Modify: `packages/channel-core/src/ports/channel-adapter.port.ts`: `UpdateOutgoingMessage.externalChannelId: string` and `actions?`.
- Modify: `packages/channel-slack/src/slack.adapter.ts`
  - One `buildBlocks(text, actions)` shared by `sendMessage` and `updateMessage`: section blocks split on `\n\n`, plus an `actions` block with `action_id = actionId` and `value`.
  - `updateMessage` uses `channel: message.externalChannelId`. This fixes the existing ts-as-channel bug.
- Modify: `packages/channel-slack/src/slack.normalizer.ts`: `type === 'block_actions'` becomes `interaction`. Accept only DM channels (`channel.id` starts with `D`) and exactly one action; otherwise return `[]`.
- Create: `apps/api/src/channel/slack-interaction.ts`, `handleSlackInteraction(event, deps)`:
  - resolve workspace → user by `(slack, workspace, externalUserId)` → person;
  - load `onboarding_states` and require `introActionsMessageTs === messageTs && introChannelId === externalChannelId`, otherwise drop (Review Focus 3);
  - parse `actionId` as `onboarding:<action>` with `OnboardingActionSchema`;
  - enqueue `ONBOARDING_ACTION` with `jobId: \`onb-act:${externalUserId}:${actionTs}\`` (Review Focus 1).
- Modify: `apps/api/src/channel/slack-ingest.service.ts`
  - Workspace id comes from `body.team_id ?? body.team?.id`.
  - The `event_id` idempotency check is skipped for interactions; dedupe is the jobId.
  - Route `interaction` events to `handleSlackInteraction` before the message path.
- Modify: `apps/api/src/channel/slack-socket-mode.service.ts`: also handle the `interactive` envelope. The `slack_event` listener already receives it; add a test proving `block_actions` reaches `processBody` and is acked within 3s.
- Modify: `apps/api/src/channel/slack-events.controller.ts` + `apps/api/src/main.ts`: `POST channel/slack/interactions` with a form-urlencoded parser storing `rawBody`. The signature is verified against the raw body, and a missing raw body or signature returns 401. Reuse the shape of `807c603:apps/api/src/channel/slack-events.controller.ts` `handleAction`.
- Create: `apps/worker/src/onboarding/onboarding-action.processor.ts`: `OnboardingService.apply(tenantId, personId, { type: 'action', action, source: 'button', at: new Date(actionTs * 1000) })`.
- Modify: `apps/worker/src/message-send/message-send.processor.ts:95-103`: pass `actions` from `persisted.metadata.onboardingActions`. After a successful send of a message whose metadata has `onboardingIntroPart: 'trust'`, store `introChannelId` / `introActionsMessageTs` and apply `{ type: 'intro_delivered' }` through `OnboardingService`.

**Tests (write first):**
- `slack.adapter.test.ts`:
  - blocks contain the 4 Team Lead buttons in order, with `action_id` values like `onboarding:start`;
  - `updateMessage` calls `chat.update` with `channel = externalChannelId`.
- `slack.normalizer.test.ts`:
  - a DM `block_actions` with one action becomes `interaction`;
  - a channel `C…`, or two actions, becomes `[]`.
- `slack-interaction.test.ts`:
  - mismatched message ts is dropped, nothing enqueued;
  - a different Slack user than the person is dropped;
  - the same `action_ts` twice gives one job with an identical jobId.
- `slack-events.controller.test.ts`:
  - `/interactions` returns 401 without a signature;
  - with a valid signature it calls the ingest with the parsed payload.
- `message-send.processor.test.ts`:
  - the trust message is sent with actions;
  - `intro_delivered` is applied only after `sendMessage` resolves.

- [ ] Steps: tests → fail → implement per file list → `pnpm --filter @entalent/channel-slack test && pnpm --filter @entalent/api test -- slack && pnpm --filter @entalent/worker test -- message-send onboarding` → commit `feat(onboarding): Slack buttons and interaction ingest`.

---

### Task 6: Text replies via the classifier (no keyword gate)

**Files:**
- Modify: `packages/contracts/src/ai.ts`: add to `SituationClassificationSchema`:

```ts
onboardingSignal: z.object({
  intent: z.enum(['start', 'later', 'decline', 'acknowledge', 'stop_participation', 'end_today_only', 'ambiguous', 'none']),
  substantive: z.boolean(),
}).nullish().catch(null),
```

- Modify: `packages/application/src/ports/ai-provider.port.ts`: the `classifySituation` context gets `onboarding?: { track: OnboardingTrack; participation: Participation; introStatus: string }`.
- Modify: `packages/ai-openai/src/prompts/classify.ts`: when `context.onboarding` is present, append a section describing the user's onboarding status and the label definitions. Without that context, the classifier is told to emit `onboardingSignal: null`.
  - `substantive` = the user shares a real situation, topic or feeling.
  - Not substantive: a greeting, thanks, or a question about Emma/onboarding/privacy (Q15).
  - `stop_participation` = an explicit wish to stop being invited.
  - `end_today_only` = ending this conversation only (Q4).
  - `acknowledge` = acknowledges the introduction (Q2a).
  - `ambiguous` = could be a participation choice but is unclear.
- Create: `packages/application/src/onboarding/onboarding-signal.ts`:

```ts
export type SignalOutcome =
  | { kind: 'event'; event: OnboardingEvent }
  | { kind: 'clarify' }
  | { kind: 'none' };
export function interpretOnboardingSignal(state: OnboardingState, signal: OnboardingSignal | null | undefined, at: Date): SignalOutcome;
```

Mapping (each line is a test):

| State | Signal | Outcome |
|---|---|---|
| any | `null` / `none` with `substantive: false` | `none` |
| undecided / deferred | `start` | action `start` (text) |
| undecided / deferred | `later` | action `later` |
| undecided / deferred | `decline` / `stop_participation` | action `decline` |
| team_lead, undecided / deferred | `acknowledge` | action `got_it` |
| management, delivered | `acknowledge` | action `got_it` |
| undecided / deferred / declined | `none` + `substantive: true` | `substantive_turn` |
| declined | `none` + `substantive: false` (greeting) | `none` (A2) |
| active | `stop_participation` | `stop_requested` |
| active | `end_today_only`, `later`, `none` | `none` (Review Focus 2) |
| not active | `ambiguous`, or `end_today_only` while undecided | `clarify` |
| any personal state | `start`/`later`/`decline` together with `substantive: true` | the explicit choice wins, except `later`/`decline` + substantive → `clarify` |

- Modify: `packages/application/src/use-cases/conversation-orchestrator.ts`
  - Before the `Promise.all` at L147, `const onboarding = await this.onboardingTurn?.contextFor(tenantId, userId)`. Pass `onboarding?.state` into `classifySituation`. No extra model call.
  - After classification and the safety override (around L180, before any reply generation): `interpretOnboardingSignal`.
    - `event` → `this.onboardingTurn.applyTurnEvent(...)`.
    - If the result's effects contain `acknowledge` and the signal was not substantive: the reply text is `ACK_COPY[key]` (persisted as outbound with `messageType: 'onboarding_ack'`), and generation is skipped.
    - Otherwise generation continues as normal. For `start` via text, the reply strategy gets `onboardingStart: true` so the agent opens with the first backlog topic or continues the user's topic (Q25).
    - `clarify` → pass `strategy.onboardingClarify = true`. The respond prompt asks one short question to tell "pause today" from "stop invitations" (Q2, Q4). The state does not change.
  - Safety precedence: if the risk path triggers, onboarding handling runs only after the safety reply is chosen and never replaces it.
- Modify: survey-evidence enqueue at orchestrator ~L822. Enqueue only when `surveyEnabled && (onboarding === null || onboarding.state.participation === 'active')`, and the person's track is not `management`. Read the post-apply state, so a substantive first message is analysed (Q2b).

**Tests (write first):**
- `onboarding-signal.test.ts`: the table above.
- `classify.test.ts`: the prompt includes the onboarding section only when context is given; the schema parses a missing or invalid `onboardingSignal` as `null`.
- `conversation-orchestrator.test.ts`, with fakes from `baseMocks()` L18. Use the PR-9-REVIEW-NOTES §1 regressions as fixtures:
  - an active user's "not now" → no `applyTurnEvent`, normal reply (bug 1.1);
  - a declined user's "давай" with signal `{ intent: 'none', substantive: false }` → no state change (bug 1.2);
  - a declined user's "later" → no `deferred` (bug 1.3);
  - an undecided user's "I'm swamped, let's do it later" → action `later`, reply equals `ACK_COPY.later_before_reminder`, `generateResponse` not called;
  - an undecided user's "my lead keeps changing priorities" → `substantive_turn` applied, normal generation, survey evidence enqueued;
  - a manager's "ok thanks" → `got_it`;
  - a manager's substantive message → no survey evidence enqueued;
  - a risk turn plus a `decline` signal → the safety reply wins and decline is still applied.

- [ ] Steps: tests → fail → implement → `pnpm --filter @entalent/contracts test; pnpm --filter @entalent/ai-openai test; pnpm --filter @entalent/application test` → commit `feat(onboarding): classifier-driven text equivalents of onboarding actions`.

---

### Task 7: Intro dispatch, first conversation, runtime eligibility and Pulse gating

**Files:**
- Create: `apps/worker/src/onboarding/onboarding-intro.service.ts`, `sendIntro(tenantId, personId, track, conversation)`:
  - Persist two outbound messages with deterministic ids `stableId('onb-intro', personId, version, 'intro' | 'trust')`, `messageType: 'onboarding_intro'`.
  - The trust message metadata is `{ onboardingIntroPart: 'trust', onboardingActions: [...] }`.
  - Enqueue `message-send` in order: the trust message is enqueued only after the intro's delivery is recorded, chained in `message-send.processor` via metadata `next`.
  - Creates the `onboarding_states` row with `initialOnboardingState(role)` if it is missing.
- Modify: `apps/worker/src/conversation/onboarding-dispatch.service.ts:55-107`: replace the `ProactiveCheckInUseCase.execute({ onboardingMessageId … })` call with `OnboardingIntroService.sendIntro`. Keep the delivery claim/complete logic, now keyed to the trust message id.
- Modify: `packages/application/src/use-cases/proactive-check-in.use-case.ts`: new input `onboardingStart?: boolean`. When true:
  - skip the first-contact rule (L118) and the disclosure-precondition for probing;
  - `getNextProbeQuestion`. If it returns `null`, the reply is exactly `EMPTY_BACKLOG_OPENER` with no model call (G1).
  - The disclosure append behaviour is unchanged (A9).
  - Not idempotent on `onboardingMessageId`; idempotent on `stableId('onb-start', personId, completedAt)`.
- Modify: `apps/worker/src/conversation/conversation.processor.ts`: `processCheckIn` passes `onboardingStart`.
- Do **not** change `runtime-eligibility.ts`. Conversation eligibility for management roles is outside onboarding scope (follow-up task). Consequence: the Q2a text path for management roles is unit-tested in Task 6 but only reachable once that follow-up lands; their Got It button works regardless, because the interaction path (Task 5) does not use `isRuntimeEligibleUser`.
- Modify: `apps/worker/src/proactive/proactive-scheduler.repository.ts:58-59`: add `AND (p.id IS NULL OR p.pulse_participant = true)` as defence in depth. Q11 must hold even if `proactive_messaging_enabled` drifts.

**Tests (write first):**
- `onboarding-intro.service.test.ts`:
  - two messages, buttons only on the second;
  - the copy equals `introMessages(role)`;
  - re-running is idempotent (same ids, no duplicates).
- `proactive-check-in.use-case.test.ts`:
  - `onboardingStart` with a backlog item → probe with `probeQuestion` set;
  - an empty backlog → the reply equals `EMPTY_BACKLOG_OPENER` and `generateResponse` is not called.
- `proactive-scheduler.repository` (integration, local DB): a manager with `proactive_messaging_enabled=true` is still excluded.
- A worker regression proving no MAF/agent-service call path is used (AGENTS.md rule): reuse the existing runtime-disconnection test and extend it to the check-in with `onboardingStart`.

- [ ] Steps: tests → fail → implement → `pnpm --filter @entalent/application test && pnpm --filter @entalent/worker test ` → commit `feat(onboarding): approved intro dispatch, backlog-first start, Pulse gating`.

---

### Task 8: The single reminder

**Files:**
- Create: `apps/worker/src/onboarding/onboarding-reminder.processor.ts`. The job is `{ tenantId, personId, dueAt }`. Order of checks, each one a test:
  1. Load the state. If `reminderStatus !== 'scheduled'` or `reminderDueAt.getTime() !== dueAt`, no-op (stale or rescheduled job, Q13).
  2. If the user is inactive, or the person is not `active`, no-op.
  3. If participation is not in (`undecided`, `deferred`), no-op (never after refusal).
  4. If the last inbound message was less than 30 minutes ago, re-enqueue at `nextWorkingTime(now + 30min)` with the same dueAt key and an attempt counter of at most 6, then send anyway (A8).
  5. If outside working time now (calendar changed), re-enqueue at `nextWorkingTime(now)`.
  6. In one transaction, persist an outbound message with `reminderCopy(track)`, no actions, `messageType: 'onboarding_reminder'`, and a deterministic id `stableId('onb-reminder', personId)`, which enforces one reminder per onboarding. Then `apply({ type: 'reminder_sent' })`.
  7. After commit, enqueue `message-send`.
- Modify: `apps/worker/src/message-send/message-send.processor.ts`: a send-time re-check for `onboarding_reminder` (participation still undecided or deferred; the user is active). This is the pattern worth keeping from `807c603`.
- Create: `OnboardingReminderRecalculator` implementation in the worker. The API calls it via a queue job `recalculate` on `ONBOARDING_REMINDER`. For every `scheduled` row of the tenant, recompute `reminderDueAt(reminderOriginAt, newCalendar, tz)`; if it is in the past, use `nextWorkingTime(now)` (Q16). Then update and enqueue.
- Modify: `apps/worker/src/proactive/proactive-scan.processor.ts:48`: after `dispatchPending`, run the recovery sweep. Select `reminder_status = 'scheduled' AND reminder_due_at <= now() - interval '5 minutes'` (limit 100) and enqueue with the same jobId. Each row is in its own try/catch, and the sweep is in its own try/catch before `scheduler.scan` (Review Focus 4).

**Tests (write first):** one per numbered check above, plus:
- the stale job after a second Later is a no-op and the newer job sends;
- a sweep where row 1 throws (an invalid timezone in the user row) → row 2 still enqueued and `scheduler.scan` still called;
- a calendar change moves a Wednesday-due reminder to Thursday when Wednesday becomes non-working;
- the reminder copy has no actions in the outgoing message.

- [ ] Steps: tests → fail → implement → `pnpm --filter @entalent/worker test -- onboarding proactive-scan message-send` → commit `feat(onboarding): single calendar-aware reminder with recovery sweep`.

---

### Task 9: Role changes and deactivation hooks

**Files:**
- Modify: `apps/api/src/hierarchy/hierarchy-mutation.service.ts`:
  - `promoteManager` (L20-120) covers the new manager (any → manager) and the previous manager with `become_employee` (manager → employee);
  - `promoteTeamLead` (L122-220) covers employee → team_lead and the previous lead with `become_employee`.
- Modify: `apps/api/src/hierarchy/hierarchy-deactivation.service.ts`: `deactivatePerson` (L271-347), `deactivateTeam` (`become_employee` / `deactivate`), and `transferAndDeactivateUnit`.
- Pattern: after the existing serializable transaction commits, enqueue `ONBOARDING_ACTION` jobs `{ kind: 'system', personId, event: { type: 'role_changed', to } | { type: 'deactivated' } }`, with `jobId: \`onb-sys:${auditLogId}\``. Using the audit id keeps the jobId unique and replay-safe.
- Risk: a crash between commit and enqueue loses the event. Mitigation: the worker's recovery sweep (Task 8) also reconciles `people.primary_role` vs `onboarding_states.track` for active people, and applies `role_changed` when they disagree. Add that query to the sweep with its own test.
- `send_intro` effect → `OnboardingIntroService.sendIntro` (Task 7) with a new version suffix, so the ids differ from the first intro. Old buttons from the previous intro are stale: Task 5's check rejects them because `introActionsMessageTs` changed.

**Tests:**
- mutation service tests: the job is enqueued after commit with the correct `to` role for each of the four paths;
- no job is enqueued when the transaction is rejected;
- sweep: the mismatch is reconciled once.

- [ ] Steps: tests → fail → implement → `pnpm --filter @entalent/api test -- hierarchy-mutation hierarchy-deactivation && pnpm --filter @entalent/worker test -- onboarding` → commit `feat(onboarding): role-change and deactivation events`.

---

### Task 10: Customer-visible onboarding aggregates (Q20)

**Files:**
- Modify: `apps/api/src/hierarchy/company-setup-read.service.ts`: add `onboardingSummary: Array<{ unitId; delivered; completed; inProgress } | { unitId; suppressed: true }>`.
  - Counts come from `onboarding_states` joined to placements.
  - Groups with fewer than 5 people are suppressed (A5).
  - Declined and deferred are folded into `inProgress`. The customer must not be able to tell refusal from deferral in small groups, so do not show a declined count.
  - Do not add any participation field to `persons` or `deliveries`.
- Modify: `apps/api/src/hierarchy/company-setup-ui.controller.ts`: render the summary.

**Tests:**
- the snapshot JSON for a 3-person unit has `suppressed: true`;
- a 6-person unit has numbers;
- no key named `participation` or `declined` appears anywhere in the snapshot (deep key scan).

- [ ] Steps: tests → fail → implement → `pnpm --filter @entalent/api test -- company-setup` → commit `feat(onboarding): aggregate-only onboarding visibility for customers`.

---

### Task 11: Release verification

- [ ] Add conversation-sim scenarios under `packages/conversation-sim/src/scenarios/onboarding-v2/`. Each uses the scripted AI fake with an `onboardingSignal`:
  - employee types "later" → ack copy;
  - undecided employee vents → normal support reply and participation active;
  - active employee says "not now" → normal reply;
  - manager "ok thanks" → management ack.
- [ ] `pnpm typecheck && pnpm test && pnpm test:integration` (local DB).
- [ ] `SIM_GATE_RUNS=1 pnpm sim:gate` if model credentials are available. Otherwise record in the report that it was not run.
- [ ] Local manual run: `pnpm dev` and a dev Slack app if tokens exist. Per `memory/local-dev-environment`, there are no Slack tokens locally, so state this as not verified.
- [ ] Q26 hand-off checklist for the owning developer:
  - interactivity is enabled in the Slack app;
  - Socket Mode delivers `interactive` envelopes;
  - double-click produces one action;
  - buttons are replaced after a choice.
  - No Railway or Slack config change without explicit approval.
- [ ] Before the release gate: the Q21/Q22 privacy workstream is merged. Onboarding copy promises "not shown to anyone"; release is blocked until that is true.
- [ ] `pnpm harness:check -- --base main` and report the receipt path. Add a row to `docs/agent-task-log.md`.

---

## Self-review notes

- **Spec coverage:**
  - Q1, G3 → Global Constraints and Task 3.
  - Q2, Q2a, Q2b, Q4, Q15 → Task 6.
  - Q3, Q5, Q6 → Task 3 and Task 6.
  - Q8 → Task 3 and Task 9.
  - Q9 → Task 3 and Task 9. Reactivation does not exist in the code; the state is preserved for when it is added.
  - Q10, Q11 → Task 3 and Task 7.
  - Q12, Q13, Q14, Q16 → Task 1 and Task 8.
  - Q17, Q18, G5 → Task 2.
  - Q19 → A3.
  - Q20 → Task 10.
  - Q23, Q24 → Task 5 and Task 7.
  - Q25, G1 → Task 7.
  - G2 → Task 3.
  - Q21, Q22, Q26, G4 → explicitly out of scope, release gate in Task 11.
- **Q9:** Eugenia's answer defines behaviour on reactivation (keep completed onboarding and the last decision, keep the one-reminder budget). Reactivation itself does not exist in code, so onboarding covers it by never deleting or resetting state on deactivation (Task 3 `deactivated`, Task 9). Nothing more to build here.
