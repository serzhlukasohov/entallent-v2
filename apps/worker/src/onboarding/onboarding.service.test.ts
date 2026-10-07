import { describe, expect, it, vi } from 'vitest';
import { initialOnboardingState, ACK_COPY, STARTED_REPLACEMENT, introMessages, type OnboardingState } from '@entalent/application';
import { OnboardingService } from './onboarding.service';
import type { OnboardingStateRow } from './onboarding-state.repository';

const T = 't1';
const P = 'p1';
const at = new Date('2026-10-07T10:00:00Z');
const calendar = { timezone: 'Europe/Kyiv', workingDays: [1, 2, 3, 4, 5], workStart: '09:00', workEnd: '18:00' };

function harness(opts: { state?: Partial<OnboardingState>; row?: Partial<OnboardingStateRow>; role?: string; userTz?: string | null; calendar?: typeof calendar | null; noRow?: boolean } = {}) {
  const calls: string[] = [];
  let row: OnboardingStateRow | null = opts.noRow ? null : {
    id: 'row1', version: 3, introChannelId: 'D1', introActionsMessageTs: '1.2',
    state: { ...initialOnboardingState('employee'), ...opts.state },
    ...opts.row,
  };
  const tx = {
    lockState: vi.fn(async () => { calls.push('lock'); return row; }),
    getPerson: vi.fn(async () => ({ role: (opts.role ?? 'employee') as never, timezone: opts.userTz ?? null })),
    getCalendar: vi.fn(async () => (opts.calendar === undefined ? calendar : opts.calendar)),
    updateState: vi.fn(async (_id: string, next: OnboardingState, extra: Record<string, unknown>) => {
      calls.push('updateState'); row = { ...row!, state: next, version: row!.version + 1 }; void extra;
    }),
    setProactive: vi.fn(async () => { calls.push('setProactive'); }),
    insertAudit: vi.fn(async (_a: Record<string, unknown>) => { calls.push('audit'); }),
  };
  const repo = {
    transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => { const r = await fn(tx); calls.push('commit'); return r; }),
    readState: vi.fn(),
  };
  const effects = {
    scheduleReminder: vi.fn().mockResolvedValue(undefined),
    replaceIntroActions: vi.fn().mockResolvedValue(undefined),
    sendAcknowledgement: vi.fn().mockResolvedValue(undefined),
    startConversation: vi.fn().mockResolvedValue(undefined),
  };
  const service = new OnboardingService(repo as never, effects);
  return { service, tx, repo, effects, calls };
}

describe('OnboardingService.apply', () => {
  it('does nothing when there is no state row', async () => {
    const h = harness({ noRow: true });
    const r = await h.service.apply(T, P, { type: 'action', action: 'start', source: 'button', at });
    expect(r).toEqual({ changed: false, effects: [], state: null });
    expect(h.tx.updateState).not.toHaveBeenCalled();
  });

  it('does not write when nothing changes', async () => {
    const h = harness({ state: { participation: 'active', introStatus: 'completed', buttonsActive: false } });
    const r = await h.service.apply(T, P, { type: 'action', action: 'start', source: 'button', at });
    expect(r.changed).toBe(false);
    expect(h.tx.updateState).not.toHaveBeenCalled();
    expect(h.tx.insertAudit).not.toHaveBeenCalled();
  });

  it('set_proactive updates users in the same tx, in order', async () => {
    const h = harness({ state: { buttonsActive: true, introStatus: 'delivered' } });
    await h.service.apply(T, P, { type: 'action', action: 'start', source: 'button', at });
    expect(h.calls).toEqual(['lock', 'updateState', 'setProactive', 'audit', 'commit']);
    expect(h.tx.setProactive).toHaveBeenCalledWith(T, P, true);
  });

  it('schedule_reminder uses the user timezone, then the calendar timezone', async () => {
    const a = harness({ state: { introStatus: 'pending' }, userTz: 'America/New_York' });
    await a.service.apply(T, P, { type: 'intro_delivered', at });
    const b = harness({ state: { introStatus: 'pending' }, userTz: null });
    await b.service.apply(T, P, { type: 'intro_delivered', at });
    const dueA = (a.tx.updateState.mock.calls[0]![2] as { reminderDueAt: Date }).reminderDueAt;
    const dueB = (b.tx.updateState.mock.calls[0]![2] as { reminderDueAt: Date }).reminderDueAt;
    expect(dueA).toBeInstanceOf(Date);
    expect(dueA.getTime()).not.toBe(dueB.getTime());
    expect(a.effects.scheduleReminder).toHaveBeenCalledWith({ tenantId: T, personId: P, dueAt: dueA });
  });

  it('throws without a calendar and writes nothing', async () => {
    const h = harness({ state: { introStatus: 'pending' }, calendar: null });
    await expect(h.service.apply(T, P, { type: 'intro_delivered', at })).rejects.toThrow(/calendar/);
    expect(h.effects.scheduleReminder).not.toHaveBeenCalled();
  });

  it('survives a replaceIntroActions failure', async () => {
    const h = harness({ state: { buttonsActive: true, introStatus: 'delivered' } });
    h.effects.replaceIntroActions.mockRejectedValue(new Error('slack down'));
    const r = await h.service.apply(T, P, { type: 'action', action: 'start', source: 'button', at });
    expect(r.changed).toBe(true);
    expect(h.effects.startConversation).toHaveBeenCalledTimes(1);
  });

  it('builds replacement text from the role trust copy', async () => {
    const h = harness({ state: { buttonsActive: true, introStatus: 'delivered' } });
    await h.service.apply(T, P, { type: 'action', action: 'start', source: 'button', at });
    expect(h.effects.replaceIntroActions).toHaveBeenCalledWith({
      tenantId: T, personId: P, channelId: 'D1', messageTs: '1.2',
      text: `${introMessages('employee').trust}\n\n_${STARTED_REPLACEMENT}_`,
    });
  });

  it('skips Slack replacement when the message ts is missing', async () => {
    const h = harness({ state: { buttonsActive: true, introStatus: 'delivered' }, row: { introActionsMessageTs: null } });
    await h.service.apply(T, P, { type: 'action', action: 'start', source: 'button', at });
    expect(h.effects.replaceIntroActions).not.toHaveBeenCalled();
  });

  it('sends acknowledgements for button actions but returns (not sends) them for text actions', async () => {
    const b = harness({ state: { buttonsActive: true, introStatus: 'delivered' } });
    await b.service.apply(T, P, { type: 'action', action: 'decline', source: 'button', at });
    expect(b.effects.sendAcknowledgement).toHaveBeenCalledWith(expect.objectContaining({ tenantId: T, personId: P, text: ACK_COPY.decline }));
    const t = harness({ state: { buttonsActive: true, introStatus: 'delivered' } });
    const r = await t.service.apply(T, P, { type: 'action', action: 'decline', source: 'text', at });
    expect(t.effects.sendAcknowledgement).not.toHaveBeenCalled();
    expect(r.effects).toContainEqual({ type: 'acknowledge', key: 'decline' });
  });

  it('audit metadata holds state names only', async () => {
    const h = harness({ state: { buttonsActive: true, introStatus: 'delivered' } });
    await h.service.apply(T, P, { type: 'action', action: 'start', source: 'button', at });
    const a = h.tx.insertAudit.mock.calls[0]![0];
    expect(a).toMatchObject({ actorType: 'user', actorId: P, action: 'onboarding.action', resourceType: 'person', resourceId: P });
    expect(a['metadata']).toEqual({
      from: { introStatus: 'delivered', participation: 'undecided', reminderStatus: 'none' },
      to: { introStatus: 'completed', participation: 'active', reminderStatus: 'none' },
      source: 'button',
    });
  });

  it('uses a system actor for system events', async () => {
    const h = harness({ state: { introStatus: 'delivered', reminderStatus: 'scheduled' } });
    await h.service.apply(T, P, { type: 'reminder_sent', at });
    expect(h.tx.insertAudit).toHaveBeenCalledWith(expect.objectContaining({ actorType: 'system', actorId: 'onboarding' }));
    expect(h.tx.updateState.mock.calls[0]![2]).toMatchObject({ reminderSentAt: at });
  });
});
