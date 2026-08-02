# Time Intelligence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reliably know each employee's local time (from Slack), greet/sign off only when it fits (session-aware), never message proactively at night (quiet-hours default + dev toggle), and degrade gracefully when the timezone is unknown.

**Architecture:** A worker `profile-hydration` job fetches the Slack `tz` (via the existing `SlackAdapter.getUserProfile`) and stores it on `users.timezone` (+ `timezone_updated_at`); the orchestrator enqueues it when the tz is missing/stale and never blocks on it. Greetings are gated on a computed `isSessionStart` and a known local time (unknown tz → no greeting). Quiet hours apply a default 22:00–08:00 window (per-user tz), with an env toggle to disable in dev.

**Tech Stack:** TypeScript, NestJS, BullMQ, Drizzle ORM, Zod, Vitest, Slack Web API via `@entalent/channel-slack`.

## Global Constraints

- pnpm workspace filters for tests/builds; never `npx vitest`.
- Constants (verbatim): `SESSION_GAP_HOURS = 5`, `TZ_REFRESH_DAYS = 30`, `DEFAULT_QUIET_HOURS = { enabled: true, startHour: 22, endHour: 8 }`.
- Timezone is stored as an IANA name (e.g. `Europe/Berlin`); local time is computed with `Intl` (DST-safe). Never store a numeric offset.
- Unknown timezone → NEVER guess a greeting (omit `localTime`), and the proactive quiet-hours guard cannot run for that user until hydrated.
- Slack calls live only in the worker (hydration adapter); the orchestrator stays provider-agnostic (enqueues a job, reads `users.timezone`).
- New env: `QUIET_HOURS_ENABLED` (default `true`; set `false` in dev to disable the guard).
- New DB column needs a generated Drizzle migration: `pnpm --filter @entalent/database db:generate`.

---

## File Structure

- `packages/database/src/schema/users.ts` — add `timezone_updated_at`.
- `packages/database/migrations/*_users_timezone_updated_at.sql` — generated.
- `apps/worker/src/conversation/repositories/conversation.repository.ts` + `packages/application/src/types/records.ts` — expose `userTimezoneUpdatedAt` on `ConversationRecord`.
- `packages/application/src/utils/quiet-hours.ts` — default window.
- `packages/application/src/utils/session.ts` — NEW: `isSessionStart`.
- `packages/config/src/env.ts` — `QUIET_HOURS_ENABLED`.
- `packages/application/src/use-cases/proactive-scheduler.use-case.ts` — `quietHoursEnabled` config gate.
- `apps/worker/src/proactive/proactive-scheduler.module.ts` — pass the flag from env.
- `packages/application/src/use-cases/conversation-orchestrator.ts` — graceful-unknown localTime, `isSessionStart`, enqueue hydration on missing/stale tz.
- `packages/ai-openai/src/prompts/respond.ts` — gate greeting on `isSessionStart`.
- `packages/application/src/ports/ai-provider.port.ts` — `ResponseContext.isSessionStart`.
- `packages/application/src/ports/external-profile.port.ts` — NEW `ExternalProfilePort`.
- `packages/application/src/ports/user-profile.repository.port.ts` — NEW `UserProfileRepositoryPort`.
- `packages/application/src/use-cases/profile-hydration.use-case.ts` — NEW.
- `packages/application/src/ports/outbox.port.ts` — `ProfileHydrationPayload` + `enqueueProfileHydration`.
- `apps/worker/src/queue/queue.module.ts`, `apps/worker/src/conversation/outbox.service.ts` — queue + enqueue.
- `apps/worker/src/profile/slack-external-profile.adapter.ts`, `user-profile.repository.ts`, `profile-hydration.processor.ts`, `profile.module.ts` — NEW worker module.
- `apps/worker/src/app.module.ts` — register `ProfileModule`.

---

### Task 1: DB — `users.timezone_updated_at` + expose on conversation record

**Files:**
- Modify: `packages/database/src/schema/users.ts`, `apps/worker/src/conversation/repositories/conversation.repository.ts`, `packages/application/src/types/records.ts`
- Generate: `packages/database/migrations/*.sql`

**Interfaces:**
- Produces: `users.timezoneUpdatedAt` column; `ConversationRecord.userTimezoneUpdatedAt?: Date`.

- [ ] **Step 1: Add the column**

In `packages/database/src/schema/users.ts`, next to `timezone`:

```typescript
  timezoneUpdatedAt: timestamp('timezone_updated_at', { withTimezone: true }),
```
(Ensure `timestamp` is imported in that file — it already imports from `drizzle-orm/pg-core`.)

- [ ] **Step 2: Generate migration**

Run: `pnpm --filter @entalent/database db:generate`
Expected: a new `migrations/000X_*.sql` with `ALTER TABLE "users" ADD COLUMN "timezone_updated_at" timestamp with time zone;`. Verify it exists.

- [ ] **Step 3: Expose on ConversationRecord**

In `packages/application/src/types/records.ts`, add to `ConversationRecord`:

```typescript
  userTimezoneUpdatedAt?: Date;
```

In `apps/worker/src/conversation/repositories/conversation.repository.ts` `findById`, add to the `.select({...})`: `userTimezoneUpdatedAt: users.timezoneUpdatedAt,` and to the returned object: `userTimezoneUpdatedAt: row.userTimezoneUpdatedAt ?? undefined,`.

- [ ] **Step 4: Build**

Run: `pnpm --filter @entalent/database build && pnpm --filter @entalent/application build && pnpm --filter @entalent/worker build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/schema/users.ts packages/database/migrations/ packages/application/src/types/records.ts apps/worker/src/conversation/repositories/conversation.repository.ts
git commit -m "feat(db): users.timezone_updated_at + expose on conversation record

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Quiet hours — default window + dev toggle

**Files:**
- Modify: `packages/application/src/utils/quiet-hours.ts`, `packages/config/src/env.ts`, `packages/application/src/use-cases/proactive-scheduler.use-case.ts`, `apps/worker/src/proactive/proactive-scheduler.module.ts`
- Test: `packages/application/src/utils/quiet-hours.test.ts`

**Interfaces:**
- Produces: `isInQuietHours` applies `DEFAULT_QUIET_HOURS` when the user hasn't explicitly enabled quiet hours; `ProactiveScanConfig.quietHoursEnabled: boolean`.

- [ ] **Step 1: Write the failing test**

Create/extend `packages/application/src/utils/quiet-hours.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isInQuietHours, DEFAULT_QUIET_HOURS } from './quiet-hours';

// Force a deterministic "now" via a fixed UTC hour by picking a tz offset.
// 02:00 UTC → in Europe/Berlin (UTC+1/+2) it's 03:00/04:00 → night.
describe('isInQuietHours default window', () => {
  it('exports a 22–08 default window', () => {
    expect(DEFAULT_QUIET_HOURS).toEqual({ enabled: true, startHour: 22, endHour: 8 });
  });
  it('applies the default window when the user has not enabled quiet hours', () => {
    // At 03:00 UTC, UTC user is inside 22–08 default.
    const orig = Date.now;
    Date.now = () => Date.parse('2026-08-02T03:00:00Z');
    try {
      expect(isInQuietHours('UTC', { enabled: false })).toBe(true);   // default applied
      expect(isInQuietHours('UTC', { enabled: false } as never)).toBe(true);
    } finally { Date.now = orig; }
  });
  it('is not quiet at midday under the default window', () => {
    const orig = Date.now;
    Date.now = () => Date.parse('2026-08-02T12:00:00Z');
    try {
      expect(isInQuietHours('UTC', { enabled: false })).toBe(false);
    } finally { Date.now = orig; }
  });
  it('respects an explicit user window', () => {
    const orig = Date.now;
    Date.now = () => Date.parse('2026-08-02T12:00:00Z');
    try {
      expect(isInQuietHours('UTC', { enabled: true, startHour: 11, endHour: 13 })).toBe(true);
    } finally { Date.now = orig; }
  });
});
```

Note: `getLocalHour` uses `new Date()`; the tests override `Date.now`. If `getLocalHour` calls `new Date()` with no args it uses `Date.now()` internally — verify; if it uses `new Date()` (which does honor `Date.now`), the override works.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @entalent/application test -- --run quiet-hours.test.ts`
Expected: FAIL — `DEFAULT_QUIET_HOURS` not exported; default not applied.

- [ ] **Step 3: Implement the default window**

In `packages/application/src/utils/quiet-hours.ts`, add and use the default:

```typescript
export const DEFAULT_QUIET_HOURS: Required<QuietHours> = { enabled: true, startHour: 22, endHour: 8 };

export function isInQuietHours(timezone: string, quietHours: QuietHours): boolean {
  const effective =
    quietHours && quietHours.enabled && quietHours.startHour != null && quietHours.endHour != null
      ? quietHours
      : DEFAULT_QUIET_HOURS;
  const localHour = getLocalHour(timezone);
  const { startHour, endHour } = effective;
  if (startHour <= endHour) return localHour >= startHour && localHour < endHour;
  return localHour >= startHour || localHour < endHour;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @entalent/application test -- --run quiet-hours.test.ts`
Expected: PASS

- [ ] **Step 5: Add the env flag + config gate**

In `packages/config/src/env.ts` (after the PROACTIVE_ block):

```typescript
  QUIET_HOURS_ENABLED: z.coerce.boolean().default(true), // false disables the quiet-hours guard (dev)
```

In `packages/application/src/use-cases/proactive-scheduler.use-case.ts`: add `quietHoursEnabled: boolean` to `ProactiveScanConfig`, default `true` in `DEFAULT_CONFIG`, and change the guard:

```typescript
      if (this.config.quietHoursEnabled && isInQuietHours(c.timezone, c.quietHours)) {
        skippedQuietHours++;
        continue;
      }
```

In `apps/worker/src/proactive/proactive-scheduler.module.ts`, where the config is built from env (alongside `minSilenceDays`, etc.), add:

```typescript
          quietHoursEnabled: config.get('QUIET_HOURS_ENABLED', { infer: true }),
```

- [ ] **Step 6: Build + commit**

Run: `pnpm --filter @entalent/config build && pnpm --filter @entalent/application build && pnpm --filter @entalent/worker build`

```bash
git add packages/application/src/utils/quiet-hours.ts packages/application/src/utils/quiet-hours.test.ts packages/config/src/env.ts packages/application/src/use-cases/proactive-scheduler.use-case.ts apps/worker/src/proactive/proactive-scheduler.module.ts
git commit -m "feat(proactive): default 22-08 quiet hours + QUIET_HOURS_ENABLED dev toggle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Session-aware greetings + graceful-unknown local time

**Files:**
- Create: `packages/application/src/utils/session.ts` + `session.test.ts`
- Modify: `packages/application/src/ports/ai-provider.port.ts` (ResponseContext), `packages/ai-openai/src/prompts/respond.ts`, `packages/application/src/use-cases/conversation-orchestrator.ts`
- Test: `packages/ai-openai/src/prompts/respond.test.ts`, `packages/application/src/use-cases/conversation-orchestrator.test.ts`

**Interfaces:**
- Produces: `isSessionStart(lastPriorMessageAt: Date | undefined, now: Date): boolean`; `ResponseContext.isSessionStart?: boolean`; `describeLocalTime` returns `undefined` for unknown tz.
- Consumes: existing `ResponseContext.localTime`.

- [ ] **Step 1: session util test**

`packages/application/src/utils/session.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isSessionStart, SESSION_GAP_HOURS } from './session';

const now = new Date('2026-08-02T12:00:00Z');
describe('isSessionStart', () => {
  it('true when there is no prior message', () => {
    expect(isSessionStart(undefined, now)).toBe(true);
  });
  it('true when the gap exceeds SESSION_GAP_HOURS', () => {
    const prior = new Date(now.getTime() - (SESSION_GAP_HOURS + 1) * 3600_000);
    expect(isSessionStart(prior, now)).toBe(true);
  });
  it('false within the gap', () => {
    const prior = new Date(now.getTime() - 60 * 60_000); // 1h ago
    expect(isSessionStart(prior, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run (fail), implement, pass**

Run: `pnpm --filter @entalent/application test -- --run session.test.ts` → FAIL.

Create `packages/application/src/utils/session.ts`:

```typescript
export const SESSION_GAP_HOURS = 5;

/** A new "session" starts when there's no prior message or a long silence precedes this one. */
export function isSessionStart(lastPriorMessageAt: Date | undefined, now: Date): boolean {
  if (!lastPriorMessageAt) return true;
  return now.getTime() - lastPriorMessageAt.getTime() > SESSION_GAP_HOURS * 3600_000;
}
```

Run again → PASS.

- [ ] **Step 3: ResponseContext + graceful-unknown localTime**

In `packages/application/src/ports/ai-provider.port.ts` `ResponseContext`, add:

```typescript
  /** True on the first message of a session (long gap) — greetings/sign-offs fit here. */
  isSessionStart?: boolean;
```

In `packages/application/src/use-cases/conversation-orchestrator.ts`, change `describeLocalTime` to accept an optional/nullable tz and return `undefined` for a falsy value:

```typescript
function describeLocalTime(timezone: string | undefined | null): string | undefined {
  if (!timezone) return undefined;
  // ... existing body unchanged ...
}
```

- [ ] **Step 4: Orchestrator wiring**

In `orchestrate`, compute session start from `dbMessages` (exclude the current inbound) and pass both fields; pass the RAW conversation tz (not `?? 'UTC'`) to `describeLocalTime`:

```typescript
    const priorMessages = dbMessages.filter((mm) => mm.id !== input.messageId);
    const lastPriorAt = priorMessages.length ? priorMessages[priorMessages.length - 1].occurredAt : undefined;
    const sessionStart = isSessionStart(lastPriorAt, new Date());
```

In the `generateResponse` context object, replace `localTime: describeLocalTime(userTimezone)` with:

```typescript
      localTime: describeLocalTime(conversation.userTimezone),
      isSessionStart: sessionStart,
```

Add the import at the top: `import { isSessionStart } from '../utils/session';`

- [ ] **Step 5: respond.ts gate greeting on session start**

In `packages/ai-openai/src/prompts/respond.ts`, change the `timeHint` condition so a greeting is only offered at session start:

```typescript
  const timeHint = context.localTime && context.isSessionStart
    ? `\nEmployee's current local time: ${context.localTime}. This looks like the start of a session — a brief time-appropriate greeting (доброе утро / добрый вечер) or, if they're wrapping up, a sign-off fits. Only when natural, never as filler; at night keep it low-key, not a chirpy "доброе утро".`
    : context.localTime
      ? `\nEmployee's current local time: ${context.localTime}. Mid-conversation — do NOT open with a greeting.`
      : '';
```

- [ ] **Step 6: Tests (respond + orchestrator)**

Add to `packages/ai-openai/src/prompts/respond.test.ts`:

```typescript
describe('buildRespondSystemPrompt session-aware greeting', () => {
  const s = (): ReplyStrategy => ({ mode: 'normal', tone: 'warm', includeFollowUpQuestion: true, maxResponseLength: 'medium', forbiddenPatterns: [] });
  it('offers a greeting at session start with known time', () => {
    const p = buildRespondSystemPrompt(s(), { userName: 'T', localTime: 'суббота, 09:00 (утро)', isSessionStart: true });
    expect(p).toMatch(/start of a session/i);
    expect(p).toContain('суббота, 09:00 (утро)');
  });
  it('suppresses greeting mid-session', () => {
    const p = buildRespondSystemPrompt(s(), { userName: 'T', localTime: 'суббота, 09:00 (утро)', isSessionStart: false });
    expect(p).toMatch(/do NOT open with a greeting/i);
  });
  it('no time hint when tz unknown', () => {
    const p = buildRespondSystemPrompt(s(), { userName: 'T', isSessionStart: true });
    expect(p).not.toMatch(/current local time/i);
  });
});
```

Add to `packages/application/src/use-cases/conversation-orchestrator.test.ts` (in the local-time describe): assert `ctxArg.isSessionStart === true` when only the current inbound exists (baseMocks returns one message with `id: 'm-1'` = `INPUT.messageId`, so priorMessages is empty → sessionStart true). Also assert `ctxArg.localTime` is undefined when `findById` returns no `userTimezone` (baseMocks returns `userTimezone: 'UTC'`, so localTime is defined — for the unknown case, override `findById` to return `userTimezone: undefined` and assert `ctxArg.localTime` is undefined).

```typescript
  it('marks session start and omits localTime when tz is unknown', async () => {
    const m = baseMocks();
    m.conversationRepo.findById.mockResolvedValue({ id: 'c-1', channelType: 'slack', userDisplayName: 'Sam', userTimezone: undefined });
    const orch = new ConversationOrchestrator(
      m.conversationRepo, m.aiProvider, m.outbox, undefined, m.surveyRepo,
      undefined, undefined, m.featureFlags, undefined, undefined,
    );
    await orch.orchestrate(INPUT);
    const ctxArg = m.aiProvider.generateResponse.mock.calls[0][2];
    expect(ctxArg.isSessionStart).toBe(true);
    expect(ctxArg.localTime).toBeUndefined();
  });
```

- [ ] **Step 7: Build + test + commit**

Run: `pnpm --filter @entalent/application build && pnpm --filter @entalent/ai-openai build && pnpm --filter @entalent/application test && pnpm --filter @entalent/ai-openai test`
Expected: all pass.

```bash
git add packages/application/src/utils/session.ts packages/application/src/utils/session.test.ts packages/application/src/ports/ai-provider.port.ts packages/ai-openai/src/prompts/respond.ts packages/ai-openai/src/prompts/respond.test.ts packages/application/src/use-cases/conversation-orchestrator.ts packages/application/src/use-cases/conversation-orchestrator.test.ts
git commit -m "feat(response): session-aware greetings; no greeting when tz unknown

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Profile hydration (fetch + store Slack timezone, lazy refresh)

**Files:**
- Create: `packages/application/src/ports/external-profile.port.ts`, `packages/application/src/ports/user-profile.repository.port.ts`, `packages/application/src/use-cases/profile-hydration.use-case.ts` (+ test)
- Modify: `packages/application/src/ports/outbox.port.ts`, `packages/application/src/index.ts`, `packages/application/src/use-cases/conversation-orchestrator.ts`
- Create (worker): `apps/worker/src/profile/slack-external-profile.adapter.ts`, `apps/worker/src/profile/user-profile.repository.ts`, `apps/worker/src/profile/profile-hydration.processor.ts`, `apps/worker/src/profile/profile.module.ts`
- Modify (worker): `apps/worker/src/queue/queue.module.ts`, `apps/worker/src/conversation/outbox.service.ts`, `apps/worker/src/app.module.ts`

**Interfaces:**
- Consumes: `SlackAdapter.getUserProfile(externalWorkspaceId, externalUserId)` (returns `{ timezone?: string, ... }`); `ConversationRecord.userTimezone`/`userTimezoneUpdatedAt`; `TZ_REFRESH_DAYS`.
- Produces:
  - `ExternalProfilePort.fetchTimezone(userId: string, tenantId: string, channelType: string): Promise<string | null>`
  - `UserProfileRepositoryPort.updateTimezone(userId: string, tenantId: string, timezone: string): Promise<void>`
  - `ProfileHydrationUseCase.execute(input: { userId: string; tenantId: string; channelType: string }): Promise<void>`
  - `OutboxPort.enqueueProfileHydration(payload: ProfileHydrationPayload): Promise<void>`; `ProfileHydrationPayload = { userId; tenantId; channelType; traceId }`.

- [ ] **Step 1: Ports**

`packages/application/src/ports/external-profile.port.ts`:

```typescript
/** Fetches profile facts from the external channel (e.g. Slack users.info). */
export interface ExternalProfilePort {
  /** IANA timezone for the user on the given channel, or null if unavailable. */
  fetchTimezone(userId: string, tenantId: string, channelType: string): Promise<string | null>;
}
```

`packages/application/src/ports/user-profile.repository.port.ts`:

```typescript
export interface UserProfileRepositoryPort {
  updateTimezone(userId: string, tenantId: string, timezone: string): Promise<void>;
}
```

Export both from `packages/application/src/index.ts`.

- [ ] **Step 2: Use case + failing test**

`packages/application/src/use-cases/profile-hydration.use-case.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ProfileHydrationUseCase } from './profile-hydration.use-case';

const INPUT = { userId: 'u-1', tenantId: 't-1', channelType: 'slack' };

describe('ProfileHydrationUseCase', () => {
  it('stores the timezone when the channel returns one', async () => {
    const ext = { fetchTimezone: vi.fn().mockResolvedValue('Europe/Berlin') } as any;
    const repo = { updateTimezone: vi.fn().mockResolvedValue(undefined) } as any;
    await new ProfileHydrationUseCase(ext, repo).execute(INPUT);
    expect(repo.updateTimezone).toHaveBeenCalledWith('u-1', 't-1', 'Europe/Berlin');
  });
  it('does nothing when the channel returns no timezone', async () => {
    const ext = { fetchTimezone: vi.fn().mockResolvedValue(null) } as any;
    const repo = { updateTimezone: vi.fn() } as any;
    await new ProfileHydrationUseCase(ext, repo).execute(INPUT);
    expect(repo.updateTimezone).not.toHaveBeenCalled();
  });
});
```

`packages/application/src/use-cases/profile-hydration.use-case.ts`:

```typescript
import type { ExternalProfilePort } from '../ports/external-profile.port';
import type { UserProfileRepositoryPort } from '../ports/user-profile.repository.port';

export interface ProfileHydrationInput {
  userId: string;
  tenantId: string;
  channelType: string;
}

export class ProfileHydrationUseCase {
  constructor(
    private readonly externalProfile: ExternalProfilePort,
    private readonly userProfileRepo: UserProfileRepositoryPort,
  ) {}

  async execute(input: ProfileHydrationInput): Promise<void> {
    const tz = await this.externalProfile.fetchTimezone(input.userId, input.tenantId, input.channelType);
    if (!tz) return;
    await this.userProfileRepo.updateTimezone(input.userId, input.tenantId, tz);
  }
}
```

Export the use case + input type from `packages/application/src/index.ts`. Run the test RED→GREEN: `pnpm --filter @entalent/application test -- --run profile-hydration`.

- [ ] **Step 3: Outbox payload + method**

In `packages/application/src/ports/outbox.port.ts` add:

```typescript
export interface ProfileHydrationPayload {
  userId: string;
  tenantId: string;
  channelType: string;
  traceId: string;
}
```
and to `OutboxPort`: `enqueueProfileHydration(payload: ProfileHydrationPayload): Promise<void>;`. Export `ProfileHydrationPayload` from the index.

- [ ] **Step 4: Orchestrator — enqueue on missing/stale tz**

In `conversation-orchestrator.ts`, after loading `conversation`, decide hydration and enqueue (fire-and-forget, gated so it doesn't block):

```typescript
    const tzMissing = !conversation.userTimezone;
    const tzStale = !!conversation.userTimezoneUpdatedAt &&
      Date.now() - conversation.userTimezoneUpdatedAt.getTime() > TZ_REFRESH_DAYS * 86_400_000;
    if (tzMissing || tzStale) {
      await this.outbox.enqueueProfileHydration({
        userId, tenantId, channelType: conversation.channelType, traceId: input.traceId,
      });
    }
```
Add `const TZ_REFRESH_DAYS = 30;` near the other module constants (or import from a shared const). Place the enqueue after `conversation` is loaded and before/around the other enqueues — it only needs `conversation`.

- [ ] **Step 5: Worker — adapter, repo, processor, module**

`apps/worker/src/profile/user-profile.repository.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { users } from '@entalent/database';
import type { UserProfileRepositoryPort } from '@entalent/application';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class UserProfileRepository implements UserProfileRepositoryPort {
  constructor(private readonly db: DatabaseService) {}
  async updateTimezone(userId: string, tenantId: string, timezone: string): Promise<void> {
    await this.db.client.update(users)
      .set({ timezone, timezoneUpdatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
  }
}
```

`apps/worker/src/profile/slack-external-profile.adapter.ts` — resolve the Slack account + bot token, then call `getUserProfile`. Follow `group-confirmation.processor.ts`'s use of `WorkspaceConnectionRepository.findSlackAccountByUserId` + `findByExternalWorkspace`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { SlackAdapter } from '@entalent/channel-slack';
import type { ExternalProfilePort } from '@entalent/application';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';

@Injectable()
export class SlackExternalProfileAdapter implements ExternalProfilePort {
  private readonly logger = new Logger(SlackExternalProfileAdapter.name);
  constructor(private readonly wsRepo: WorkspaceConnectionRepository) {}

  async fetchTimezone(userId: string, tenantId: string, channelType: string): Promise<string | null> {
    if (channelType !== 'slack') return null;
    const account = await this.wsRepo.findSlackAccountByUserId(userId, tenantId);
    if (!account) return null;
    const wsConn = await this.wsRepo.findByExternalWorkspace('slack', account.externalWorkspaceId);
    if (!wsConn) return null;
    try {
      const adapter = new SlackAdapter({ botToken: wsConn.botToken });
      const profile = await adapter.getUserProfile(account.externalWorkspaceId, account.externalUserId);
      return profile.timezone ?? null;
    } catch (err) {
      this.logger.warn(`fetchTimezone failed for user=${userId}: ${(err as Error).message}`);
      return null;
    }
  }
}
```
(Confirm `WorkspaceConnectionRepository.findSlackAccountByUserId` returns `{ externalWorkspaceId, externalUserId }` — it is used the same way in `group-confirmation.processor.ts`. If the exact fields differ, adapt.)

`apps/worker/src/profile/profile-hydration.processor.ts`:

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ProfileHydrationUseCase } from '@entalent/application';
import type { ProfileHydrationPayload } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';

@Processor(QUEUE_NAMES.PROFILE_HYDRATION)
export class ProfileHydrationProcessor extends WorkerHost {
  private readonly logger = new Logger(ProfileHydrationProcessor.name);
  constructor(private readonly useCase: ProfileHydrationUseCase) { super(); }
  async process(job: Job<ProfileHydrationPayload>): Promise<void> {
    const { userId, tenantId, channelType, traceId } = job.data;
    try {
      await this.useCase.execute({ userId, tenantId, channelType });
    } catch (err) {
      this.logger.error(`Profile hydration failed [${traceId}]: ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }
  }
}
```

`apps/worker/src/profile/profile.module.ts` — register the queue, provide `WorkspaceConnectionRepository`, `SlackExternalProfileAdapter`, `UserProfileRepository`, a `ProfileHydrationUseCase` factory, and the processor. Follow `survey.module.ts` shape:

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProfileHydrationUseCase } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';
import { DatabaseModule } from '../database/database.module';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';
import { SlackExternalProfileAdapter } from './slack-external-profile.adapter';
import { UserProfileRepository } from './user-profile.repository';
import { ProfileHydrationProcessor } from './profile-hydration.processor';

@Module({
  imports: [DatabaseModule, BullModule.registerQueue({ name: QUEUE_NAMES.PROFILE_HYDRATION })],
  providers: [
    WorkspaceConnectionRepository,
    SlackExternalProfileAdapter,
    UserProfileRepository,
    {
      provide: ProfileHydrationUseCase,
      useFactory: (ext: SlackExternalProfileAdapter, repo: UserProfileRepository) =>
        new ProfileHydrationUseCase(ext, repo),
      inject: [SlackExternalProfileAdapter, UserProfileRepository],
    },
    ProfileHydrationProcessor,
  ],
})
export class ProfileModule {}
```
(Match `DatabaseModule`/`WorkspaceConnectionRepository` import paths to how `survey.module.ts` imports them.)

- [ ] **Step 6: Queue name + outbox impl + app.module**

In `apps/worker/src/queue/queue.module.ts`: add `PROFILE_HYDRATION: 'profile-hydration',` to `QUEUE_NAMES` and `{ name: QUEUE_NAMES.PROFILE_HYDRATION }` to `registerQueue(...)`.

In `apps/worker/src/conversation/outbox.service.ts`: inject `@InjectQueue(QUEUE_NAMES.PROFILE_HYDRATION) private readonly profileHydrationQueue: Queue<ProfileHydrationPayload>` (import the type) and add:

```typescript
  async enqueueProfileHydration(payload: ProfileHydrationPayload): Promise<void> {
    await this.profileHydrationQueue.add('hydrate', payload);
  }
```

In `apps/worker/src/app.module.ts`: add `ProfileModule` to imports.

- [ ] **Step 7: Build everything + run suites**

Run:
```bash
pnpm --filter @entalent/application build && pnpm --filter @entalent/worker build
pnpm --filter @entalent/application test
```
Expected: builds succeed; app tests pass (orchestrator test mocks need `enqueueProfileHydration: vi.fn()` on the outbox mock — add it in `baseMocks`).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(profile): hydrate user timezone from Slack (async job, lazy refresh)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Deployment (after all tasks)

Runs in the worker (hydration + reply generation + proactive scheduler). Deploy: `railway up --service worker --detach`. The new `timezone_updated_at` column needs `db:migrate` against the target DB before deploy (additive, nullable — safe). For dev testing, set `QUIET_HOURS_ENABLED=false` on the worker so the night guard doesn't block testing.

## Self-Review Notes (spec coverage)

- Tz acquisition from Slack (async job) + graceful unknown → Tasks 1 (column) + 4 (hydration) + 3 (describeLocalTime undefined). Session-aware greetings → Task 3. Quiet-hours default + dev toggle + tone → Task 2 (default+toggle; tone already via part-of-day in describeLocalTime). Tz refresh (lazy) → Task 4 (orchestrator stale check using `timezone_updated_at`, `TZ_REFRESH_DAYS`).
- Types consistent: `ExternalProfilePort.fetchTimezone(userId,tenantId,channelType)`, `UserProfileRepositoryPort.updateTimezone(userId,tenantId,timezone)`, `ProfileHydrationPayload{userId,tenantId,channelType,traceId}`, `ResponseContext.isSessionStart`, `isSessionStart(lastPriorMessageAt, now)`, `DEFAULT_QUIET_HOURS`, `SESSION_GAP_HOURS`, `TZ_REFRESH_DAYS`.
- Out of scope (per spec): Slack `user_change` events, `dnd.info`, activity-based tz inference.
- Executor note: unit tests are the CI-safe gate; the Slack hydration path is exercised live after deploy.
