import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { reminderCopy } from '@entalent/application';
import { OnboardingReminderProcessor } from './onboarding-reminder.processor';
import { stableId } from './stable-id';

const NOW = new Date('2026-10-07T10:00:00.000Z'); // Wednesday 12:00/13:00 Kyiv, inside working hours
const DUE = new Date('2026-10-07T09:00:00.000Z');
const calendar = { timezone: 'Europe/Kyiv', workingDays: [1, 2, 3, 4, 5], workStart: '09:00', workEnd: '18:00' };

function ctx(over: Record<string, unknown> = {}) {
  return {
    stateId: 's1', track: 'employee', participation: 'undecided', reminderStatus: 'scheduled',
    reminderDueAt: DUE, reminderOriginAt: new Date('2026-10-05T09:00:00Z'), introActionsMessageTs: '1.2',
    userStatus: 'active', deletedAt: null, personLifecycle: 'active', userTimezone: null,
    calendar, lastInboundAt: null, ...over,
  };
}

function build(context: unknown, opts: { target?: unknown; hookRow?: Record<string, unknown> } = {}) {
  const repo = { loadContext: vi.fn().mockResolvedValue(context), listScheduled: vi.fn(), updateScheduledDue: vi.fn().mockResolvedValue(true) };
  const inserted: unknown[] = [];
  const row = { state: { reminderStatus: 'scheduled', participation: 'undecided', track: 'employee' }, reminderDueAt: DUE,
    introActionsMessageTs: '1.2', ...opts.hookRow };
  const apply = vi.fn(async (_t: string, _p: string, _e: unknown, hook: (tx: unknown, r: unknown) => Promise<boolean>) => {
    const tx = { insertOutboundMessage: vi.fn(async (v: unknown) => { inserted.push(v); }) };
    return { changed: await hook(tx, row), effects: [], state: null };
  });
  const target = opts.target === undefined
    ? { conversationId: 'c1', channelType: 'slack', externalConversationId: 'D1', externalWorkspaceId: 'W1' } : opts.target;
  const effects = { findDeliveryTarget: vi.fn().mockResolvedValue(target), enqueueMessageSend: vi.fn().mockResolvedValue(undefined) };
  const queue = { add: vi.fn().mockResolvedValue(undefined) };
  const processor = new OnboardingReminderProcessor(repo as never, { apply } as never, effects as never, queue as never);
  return { processor, repo, apply, effects, queue, inserted };
}

const job = (data: Record<string, unknown> = {}, name = 'remind') =>
  ({ name, data: { tenantId: 't1', personId: 'p1', dueAt: DUE.toISOString(), ...data } }) as Job<never>;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('OnboardingReminderProcessor remind', () => {
  it('sends: persists the exact copy without actions, applies reminder_sent, enqueues message-send', async () => {
    const { processor, apply, inserted, effects } = build(ctx());
    await processor.process(job());
    const id = stableId('onb-reminder', 'p1', '1.2');
    expect(inserted).toEqual([expect.objectContaining({
      id, tenantId: 't1', userId: 'p1', conversationId: 'c1',
      messageType: 'onboarding_reminder', text: reminderCopy('employee'),
    })]);
    expect(inserted[0]).not.toHaveProperty('metadata');
    expect(apply).toHaveBeenCalledWith('t1', 'p1', { type: 'reminder_sent', at: NOW }, expect.any(Function));
    expect(effects.enqueueMessageSend).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'c1' }), id, reminderCopy('employee'));
  });

  it('uses team lead copy and a fresh id when the intro changed', async () => {
    const { processor, inserted } = build(ctx({ track: 'team_lead' }), { hookRow: { introActionsMessageTs: null } });
    await processor.process(job());
    expect(inserted[0]).toMatchObject({ id: stableId('onb-reminder', 'p1', 'none'), text: reminderCopy('team_lead') });
  });

  it('1. stale: status not scheduled, rescheduled dueAt, or missing state is a no-op', async () => {
    for (const c of [ctx({ reminderStatus: 'sent' }), ctx({ reminderStatus: 'cancelled' }),
      ctx({ reminderDueAt: new Date('2026-10-09T09:00:00Z') }), null]) {
      const { processor, apply, queue } = build(c);
      await processor.process(job());
      expect(apply).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    }
  });

  it('stale job after a second Later is a no-op and the newer job sends', async () => {
    const newer = new Date('2026-10-09T09:00:00Z');
    const { processor, apply } = build(ctx({ reminderDueAt: newer }));
    await processor.process(job()); // old
    expect(apply).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));
    await processor.process(job({ dueAt: newer.toISOString() }));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('2. inactive user, deleted user, or non-active person is a no-op', async () => {
    for (const c of [ctx({ userStatus: 'inactive' }), ctx({ deletedAt: NOW }), ctx({ personLifecycle: 'offboarded' })]) {
      const { processor, apply } = build(c);
      await processor.process(job());
      expect(apply).not.toHaveBeenCalled();
    }
  });

  it('3. never after refusal or for management/active participation', async () => {
    for (const c of [ctx({ participation: 'declined' }), ctx({ participation: 'active' }),
      ctx({ participation: 'not_applicable', track: 'management' })]) {
      const { processor, apply } = build(c);
      await processor.process(job());
      expect(apply).not.toHaveBeenCalled();
    }
    const { processor, apply } = build(ctx({ participation: 'deferred' }));
    await processor.process(job());
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('4. recent inbound postpones 30 minutes: persists the new due (CAS) and enqueues the canonical id for it', async () => {
    const { processor, apply, queue, repo } = build(ctx({ lastInboundAt: new Date(NOW.getTime() - 10 * 60_000) }));
    await processor.process(job());
    expect(apply).not.toHaveBeenCalled();
    const runAt = new Date(NOW.getTime() + 30 * 60_000);
    expect(repo.updateScheduledDue).toHaveBeenCalledWith('s1', runAt, DUE);
    expect(queue.add).toHaveBeenCalledWith('remind',
      { tenantId: 't1', personId: 'p1', dueAt: runAt.toISOString(), postponeCount: 1 },
      { delay: 30 * 60_000, jobId: `onb-rem:p1:${runAt.getTime()}` });
  });

  it('4. postponement is clamped to working time', async () => {
    vi.setSystemTime(new Date('2026-10-07T14:50:00Z')); // 17:50 Kyiv, +30min is after hours
    const { processor, queue, repo } = build(ctx({ lastInboundAt: new Date('2026-10-07T14:45:00Z') }));
    await processor.process(job());
    const next = new Date('2026-10-08T06:00:00.000Z'); // Thursday 09:00 Kyiv (UTC+3)
    expect(repo.updateScheduledDue).toHaveBeenCalledWith('s1', next, DUE);
    expect(queue.add.mock.calls[0]![2].jobId).toBe(`onb-rem:p1:${next.getTime()}`);
    expect(queue.add.mock.calls[0]![2].delay).toBe(next.getTime() - Date.now());
  });

  it('the postponed job passes the stale check against the persisted new due; the old job no longer does', async () => {
    const runAt = new Date(NOW.getTime() + 30 * 60_000);
    // state after the CAS: due moved to runAt
    const moved = build(ctx({ reminderDueAt: runAt, lastInboundAt: null }));
    vi.setSystemTime(runAt);
    await moved.processor.process(job({ dueAt: runAt.toISOString(), postponeCount: 1 }));
    expect(moved.apply).toHaveBeenCalledTimes(1);
    const old = build(ctx({ reminderDueAt: runAt }));
    await old.processor.process(job()); // original dueAt
    expect(old.apply).not.toHaveBeenCalled();
  });

  it('does nothing when the CAS lost (someone else moved the reminder)', async () => {
    const { processor, queue, repo } = build(ctx({ lastInboundAt: new Date(NOW.getTime() - 60_000) }));
    repo.updateScheduledDue.mockResolvedValue(false);
    await processor.process(job());
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('4. sends after six postponements even if the user keeps writing', async () => {
    const { processor, apply, queue } = build(ctx({ lastInboundAt: new Date(NOW.getTime() - 60_000) }));
    await processor.process(job({ postponeCount: 6 }));
    expect(queue.add).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('5. outside working time moves the due to the next working time via CAS and re-enqueues', async () => {
    vi.setSystemTime(new Date('2026-10-10T10:00:00Z')); // Saturday
    const { processor, apply, queue, repo } = build(ctx());
    await processor.process(job());
    expect(apply).not.toHaveBeenCalled();
    const next = new Date('2026-10-12T06:00:00.000Z'); // Monday 09:00 Kyiv
    expect(repo.updateScheduledDue).toHaveBeenCalledWith('s1', next, DUE);
    expect(queue.add).toHaveBeenCalledWith('remind',
      { tenantId: 't1', personId: 'p1', dueAt: next.toISOString(), postponeCount: 0 },
      { delay: next.getTime() - Date.now(), jobId: `onb-rem:p1:${next.getTime()}` });
  });

  it('reads working time in the user timezone, falling back to the company timezone', async () => {
    vi.setSystemTime(new Date('2026-10-07T15:30:00Z')); // 18:30 Kyiv (closed), 08:30 Los Angeles (closed), 11:30 New York (open)
    const ny = build(ctx({ userTimezone: 'America/New_York' }));
    await ny.processor.process(job());
    expect(ny.apply).toHaveBeenCalledTimes(1);
    const company = build(ctx({ userTimezone: null }));
    await company.processor.process(job());
    expect(company.apply).not.toHaveBeenCalled();
  });

  it('6. guards re-checked under the row lock: nothing persisted or enqueued when state moved', async () => {
    for (const hookRow of [
      { state: { reminderStatus: 'sent', participation: 'undecided', track: 'employee' } },
      { state: { reminderStatus: 'scheduled', participation: 'declined', track: 'employee' } },
      { reminderDueAt: new Date('2026-10-09T09:00:00Z') },
    ]) {
      const { processor, inserted, effects } = build(ctx(), { hookRow });
      await processor.process(job());
      expect(inserted).toHaveLength(0);
      expect(effects.enqueueMessageSend).not.toHaveBeenCalled();
    }
  });

  it('does nothing when there is no active conversation to deliver into', async () => {
    const { processor, apply, effects } = build(ctx(), { target: null });
    await processor.process(job());
    expect(apply).not.toHaveBeenCalled();
    expect(effects.enqueueMessageSend).not.toHaveBeenCalled();
  });
});

describe('OnboardingReminderProcessor recalculate (Q16)', () => {
  const TUE = new Date('2026-10-06T07:00:00Z');
  const WED_DUE = new Date('2026-10-07T09:00:00Z'); // origin Mon 12:00 Kyiv + 2 working days
  const THU_DUE = new Date('2026-10-08T09:00:00Z');
  const noWednesday = { ...calendar, workingDays: [1, 2, 4, 5] };

  function recalc(rows: unknown[], cal: unknown = calendar) {
    const b = build(ctx());
    b.repo.listScheduled.mockResolvedValue({ calendar: cal, rows });
    b.repo.updateScheduledDue.mockResolvedValue(true);
    return b;
  }
  const row = (over: Record<string, unknown> = {}) => ({
    stateId: 's1', personId: 'p1', reminderOriginAt: new Date('2026-10-05T09:00:00Z'),
    reminderDueAt: WED_DUE, userTimezone: null, ...over,
  });
  const recalcJob = () => ({ name: 'recalculate', data: { tenantId: 't1' } }) as Job<never>;

  beforeEach(() => { vi.setSystemTime(TUE); });

  it('moves a Wednesday-due reminder to Thursday when Wednesday stops being a working day', async () => {
    const { processor, repo, queue } = recalc([row()], noWednesday);
    await processor.process(recalcJob());
    expect(repo.updateScheduledDue).toHaveBeenCalledWith('s1', THU_DUE, WED_DUE);
    expect(queue.add).toHaveBeenCalledWith('remind', { tenantId: 't1', personId: 'p1', dueAt: THU_DUE.toISOString() },
      { delay: THU_DUE.getTime() - TUE.getTime(), jobId: `onb-rem:p1:${THU_DUE.getTime()}` });
  });

  it('uses nextWorkingTime(now) when the recomputed time is already past', async () => {
    vi.setSystemTime(new Date('2026-10-08T03:00:00Z')); // Thursday 06:00 Kyiv, before opening
    const { processor, repo, queue } = recalc([row()]);
    await processor.process(recalcJob());
    expect(repo.updateScheduledDue).toHaveBeenCalledWith('s1', new Date('2026-10-08T06:00:00Z'), WED_DUE);
    expect(queue.add.mock.calls[0]![2].delay).toBe(3 * 3600_000);
  });

  it('skips unchanged rows, and one failing row does not stop the next', async () => {
    const same = row({ stateId: 's1' });
    const bad = row({ stateId: 's2', personId: 'p2', userTimezone: 'Not/AZone' });
    const { processor, repo, queue } = recalc([same]);
    await processor.process(recalcJob());
    expect(repo.updateScheduledDue).not.toHaveBeenCalled(); // already matches the calendar
    expect(queue.add).not.toHaveBeenCalled();
    const second = recalc([bad, row({ stateId: 's3', personId: 'p3' })], noWednesday);
    await second.processor.process(recalcJob());
    expect(second.repo.updateScheduledDue).toHaveBeenCalledTimes(1);
    expect(second.repo.updateScheduledDue.mock.calls[0]![0]).toBe('s3');
    expect(second.queue.add).toHaveBeenCalledTimes(1);
  });

  it('does not enqueue when the guarded update lost a race', async () => {
    const { processor, repo, queue } = recalc([row()], noWednesday);
    repo.updateScheduledDue.mockResolvedValue(false);
    await processor.process(recalcJob());
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does nothing without a calendar', async () => {
    const { processor, repo, queue } = recalc([row()], null);
    await processor.process(recalcJob());
    expect(repo.updateScheduledDue).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
