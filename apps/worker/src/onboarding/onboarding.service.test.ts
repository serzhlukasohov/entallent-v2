import { describe, expect, it, vi } from 'vitest';
import { initialOnboardingState, ACK_COPY, BUTTON_REPLACEMENT_SHORT, STARTED_REPLACEMENT, introMessages, type OnboardingState } from '@entalent/application';
import { OnboardingService } from './onboarding.service';
import type { OnboardingStateRow } from './onboarding-state.repository';

const T = 't1';
const P = 'p1';
const at = new Date('2026-10-07T10:00:00Z');
const calendar = { timezone: 'Europe/Kyiv', workingDays: [1, 2, 3, 4, 5], workStart: '09:00', workEnd: '18:00' };

function harness(opts: { state?: Partial<OnboardingState>; row?: Partial<OnboardingStateRow>; role?: string; userTz?: string | null; calendar?: typeof calendar | null; noRow?: boolean } = {}) {
  const calls: string[] = [];
  let row: OnboardingStateRow | null = opts.noRow ? null : {
    id: 'row1', version: 3, introChannelId: 'D1', introActionsMessageTs: '1.2', reminderDueAt: null,
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
    setIntroLocation: vi.fn(async () => { calls.push('setIntroLocation'); }),
    insertAudit: vi.fn(async (_a: Record<string, unknown>) => { calls.push('audit'); }),
  };
  const repo = {
    transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => { const r = await fn(tx); calls.push('commit'); return r; }),
    readState: vi.fn(),
  };
  const effects = {
    scheduleReminder: vi.fn().mockResolvedValue(undefined),
    replaceIntroActions: vi.fn().mockResolvedValue(true),
    sendAcknowledgement: vi.fn().mockResolvedValue(undefined),
    startConversation: vi.fn().mockResolvedValue(undefined),
    sendRoleIntro: vi.fn().mockResolvedValue(undefined),
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

  it('without a calendar logs, schedules nothing, and still advances the state with reminderStatus none (Q18)', async () => {
    const h = harness({ state: { introStatus: 'pending' }, calendar: null });
    const error = vi.spyOn((h.service as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
      .mockImplementation(() => undefined);
    const r = await h.service.apply(T, P, { type: 'intro_delivered', at });
    expect(r.changed).toBe(true);
    expect(r.state).toMatchObject({ introStatus: 'delivered', buttonsActive: true, reminderStatus: 'none' });
    expect(h.tx.updateState).toHaveBeenCalledWith('row1', expect.objectContaining({ reminderStatus: 'none' }), {});
    expect(h.effects.scheduleReminder).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('onboarding_work_calendar_missing'));
  });

  it('a Later without a calendar is still accepted but leaves no scheduled reminder', async () => {
    const h = harness({ state: { introStatus: 'delivered', buttonsActive: true }, calendar: null });
    vi.spyOn((h.service as unknown as { logger: { error: (m: string) => void } }).logger, 'error').mockImplementation(() => undefined);
    const r = await h.service.apply(T, P, { type: 'action', action: 'later', source: 'button', at });
    expect(r.state).toMatchObject({ participation: 'deferred', reminderStatus: 'none' });
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

  it('a button click replaces the buttons with the G2 acknowledgement and sends no separate message (Q24)', async () => {
    const b = harness({ state: { buttonsActive: true, introStatus: 'delivered' } });
    await b.service.apply(T, P, { type: 'action', action: 'decline', source: 'button', at });
    expect(b.effects.replaceIntroActions).toHaveBeenCalledWith(expect.objectContaining({
      text: `${introMessages('employee').trust}\n\n_${ACK_COPY.decline}_`,
    }));
    expect(b.effects.sendAcknowledgement).not.toHaveBeenCalled();
  });

  it('a text choice replaces the buttons with the short Q24 phrase; the reply carries the G2 acknowledgement', async () => {
    const t = harness({ state: { buttonsActive: true, introStatus: 'delivered' } });
    const r = await t.service.apply(T, P, { type: 'action', action: 'decline', source: 'text', at });
    expect(t.effects.replaceIntroActions).toHaveBeenCalledWith(expect.objectContaining({
      text: `${introMessages('employee').trust}\n\n_${BUTTON_REPLACEMENT_SHORT.decline}_`,
    }));
    expect(t.effects.sendAcknowledgement).not.toHaveBeenCalled();
    expect(r.replyAck).toBe(ACK_COPY.decline);
  });

  it('a button click still gets an acknowledgement message when the buttons cannot be edited', async () => {
    const noTs = harness({ state: { buttonsActive: true, introStatus: 'delivered' }, row: { introActionsMessageTs: null } });
    await noTs.service.apply(T, P, { type: 'action', action: 'later', source: 'button', at });
    expect(noTs.effects.sendAcknowledgement).toHaveBeenCalledWith(expect.objectContaining({ text: ACK_COPY.later_before_reminder }));
    const failed = harness({ state: { buttonsActive: true, introStatus: 'delivered' } });
    failed.effects.replaceIntroActions.mockResolvedValue(false);
    await failed.service.apply(T, P, { type: 'action', action: 'later', source: 'button', at });
    expect(failed.effects.sendAcknowledgement).toHaveBeenCalledWith(expect.objectContaining({ text: ACK_COPY.later_before_reminder }));
  });

  it('a button Later while active without armed buttons is answered with a message (already_complete)', async () => {
    const h = harness({ state: { participation: 'active', introStatus: 'completed', buttonsActive: false } });
    await h.service.apply(T, P, { type: 'action', action: 'later', source: 'button', at });
    expect(h.effects.replaceIntroActions).not.toHaveBeenCalled();
    expect(h.effects.sendAcknowledgement).toHaveBeenCalledWith(expect.objectContaining({ text: ACK_COPY.already_complete }));
  });

  it('a button start replaces the buttons with "Let\'s talk." and starts the conversation', async () => {
    const h = harness({ state: { buttonsActive: true, introStatus: 'delivered' } });
    await h.service.apply(T, P, { type: 'action', action: 'start', source: 'button', at });
    expect(h.effects.replaceIntroActions).toHaveBeenCalledWith(expect.objectContaining({
      text: `${introMessages('employee').trust}\n\n_${STARTED_REPLACEMENT}_`,
    }));
    expect(h.effects.sendAcknowledgement).not.toHaveBeenCalled();
  });

  it('stop_requested returns the ack as replyAck and does not send it', async () => {
    const h = harness({ state: { buttonsActive: true, introStatus: 'delivered' } });
    const r = await h.service.apply(T, P, { type: 'stop_requested', at });
    expect(h.effects.sendAcknowledgement).not.toHaveBeenCalled();
    expect(r.replyAck).toBe(ACK_COPY.decline);
  });

  it('text actions return replyAck; button actions omit it', async () => {
    const t = harness({ state: { buttonsActive: true, introStatus: 'delivered' } });
    expect((await t.service.apply(T, P, { type: 'action', action: 'decline', source: 'text', at })).replyAck).toBe(ACK_COPY.decline);
    const b = harness({ state: { buttonsActive: true, introStatus: 'delivered' } });
    expect((await b.service.apply(T, P, { type: 'action', action: 'decline', source: 'button', at })).replyAck).toBeUndefined();
  });

  it('a text start returns replyStart and does not start a separate conversation', async () => {
    const h = harness({ state: { buttonsActive: true, introStatus: 'delivered' } });
    const r = await h.service.apply(T, P, { type: 'action', action: 'start', source: 'text', at });
    expect(r.replyStart).toBe(true);
    expect(r.state?.participation).toBe('active');
    expect(h.effects.startConversation).not.toHaveBeenCalled();
    expect(h.effects.replaceIntroActions).toHaveBeenCalledTimes(1);
  });

  it('a button start starts the conversation and omits replyStart', async () => {
    const h = harness({ state: { buttonsActive: true, introStatus: 'delivered' } });
    const r = await h.service.apply(T, P, { type: 'action', action: 'start', source: 'button', at });
    expect(r.replyStart).toBeUndefined();
    expect(h.effects.startConversation).toHaveBeenCalledTimes(1);
  });

  it('start dedupeKey uses the post-commit version', async () => {
    const h = harness({ state: { buttonsActive: true, introStatus: 'delivered' } });
    await h.service.apply(T, P, { type: 'action', action: 'start', source: 'button', at });
    expect(h.effects.startConversation).toHaveBeenCalledWith({ tenantId: T, personId: P, dedupeKey: `${P}:4` });
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

  describe('recordIntroDelivered', () => {
    it('stores the location and applies intro_delivered in one transaction on first delivery', async () => {
      const h = harness({ row: { introChannelId: null, introActionsMessageTs: null } });
      const r = await h.service.recordIntroDelivered(T, P, 'D9', '20.5', at);
      expect(h.tx.setIntroLocation).toHaveBeenCalledWith('row1', 'D9', '20.5');
      expect(r.changed).toBe(true);
      expect(r.state?.buttonsActive).toBe(true);
      expect(h.calls.slice(0, 3)).toEqual(['lock', 'setIntroLocation', 'updateState']);
      expect(h.calls.filter((c) => c === 'commit')).toHaveLength(1);
    });

    it('is a no-op when a retried job replays the recorded message after a choice was made', async () => {
      const h = harness({
        row: { introChannelId: 'D1', introActionsMessageTs: '10.5' },
        state: { introStatus: 'completed', participation: 'active', buttonsActive: false },
      });
      const r = await h.service.recordIntroDelivered(T, P, 'D1', '10.5', at);
      expect(r.changed).toBe(false);
      expect(r.state?.buttonsActive).toBe(false);
      expect(h.tx.setIntroLocation).not.toHaveBeenCalled();
      expect(h.tx.updateState).not.toHaveBeenCalled();
      expect(h.tx.insertAudit).not.toHaveBeenCalled();
    });

    it('a first-intro trust delivered after a text start records the location but does not re-arm buttons', async () => {
      const h = harness({
        row: { introChannelId: null, introActionsMessageTs: null },
        state: { introStatus: 'completed', participation: 'active', buttonsActive: false },
      });
      const r = await h.service.recordIntroDelivered(T, P, 'D1', '11.0', at);
      expect(r.changed).toBe(false);
      expect(r.state?.buttonsActive).toBe(false);
      expect(h.tx.updateState).not.toHaveBeenCalled();
    });

    it('a role-change trust arms the buttons on a non-pending state', async () => {
      const h = harness({
        row: { introChannelId: 'D1', introActionsMessageTs: '10.5' },
        state: { track: 'team_lead', introStatus: 'completed', participation: 'active', buttonsActive: false },
      });
      const r = await h.service.recordIntroDelivered(T, P, 'D1', '12.0', at, true);
      expect(r.changed).toBe(true);
      expect(r.state?.buttonsActive).toBe(true);
      expect(h.tx.setIntroLocation).toHaveBeenCalledWith('row1', 'D1', '12.0');
    });

    it('ignores an older trust message after a newer intro was recorded', async () => {
      const h = harness({ row: { introChannelId: 'D1', introActionsMessageTs: '30.0' }, state: { introStatus: 'delivered', buttonsActive: true } });
      const r = await h.service.recordIntroDelivered(T, P, 'D1', '9.5', at);
      expect(r.changed).toBe(false);
      expect(h.tx.setIntroLocation).not.toHaveBeenCalled();
      expect(h.tx.updateState).not.toHaveBeenCalled();
    });
  });
});

describe('OnboardingService role changes and deactivation', () => {
  it('sends the new role intro post-commit with the current role and the new state version', async () => {
    const h = harness({ state: initialOnboardingState('manager'), role: 'employee' });
    const r = await h.service.apply(T, P, { type: 'role_changed', from: 'manager', to: 'employee', at });
    expect(r.changed).toBe(true);
    expect(h.effects.sendRoleIntro).toHaveBeenCalledWith({ tenantId: T, personId: P, role: 'employee', version: 4 });
    expect(h.calls.indexOf('commit')).toBeLessThan(h.effects.sendRoleIntro.mock.invocationCallOrder[0]!);
  });

  it('sends no intro for team lead to employee', async () => {
    const h = harness({ role: 'employee' });
    await h.service.apply(T, P, { type: 'role_changed', from: 'team_lead', to: 'employee', at });
    expect(h.effects.sendRoleIntro).not.toHaveBeenCalled();
  });

  it('keeps going when the intro cannot be sent', async () => {
    const h = harness({ state: initialOnboardingState('manager'), role: 'employee' });
    h.effects.sendRoleIntro.mockRejectedValue(new Error('slack down'));
    await expect(h.service.apply(T, P, { type: 'role_changed', from: 'manager', to: 'employee', at }))
      .resolves.toMatchObject({ changed: true });
  });

  it('deactivation cancels a scheduled reminder and sends nothing', async () => {
    const h = harness({ state: { reminderStatus: 'scheduled', reminderOriginAt: at, introStatus: 'delivered', buttonsActive: true } });
    const r = await h.service.apply(T, P, { type: 'deactivated', at });
    expect(r.changed).toBe(true);
    expect(h.tx.updateState).toHaveBeenCalledWith('row1', expect.objectContaining({ reminderStatus: 'cancelled' }), expect.anything());
    expect(h.effects.sendRoleIntro).not.toHaveBeenCalled();
    expect(h.effects.sendAcknowledgement).not.toHaveBeenCalled();
  });

  it('skips a role_changed whose track change was already applied (sweep/job race)', async () => {
    const h = harness({ state: initialOnboardingState('manager'), role: 'manager' });
    const r = await h.service.apply(T, P, { type: 'role_changed', from: 'employee', to: 'manager', at });
    expect(r.changed).toBe(false);
    expect(h.tx.updateState).not.toHaveBeenCalled();
    expect(h.effects.sendRoleIntro).not.toHaveBeenCalled();
  });

  it('still sends the intro for a genuine same-track change (hr to manager)', async () => {
    const h = harness({ state: initialOnboardingState('hr'), role: 'manager' });
    const r = await h.service.apply(T, P, { type: 'role_changed', from: 'hr', to: 'manager', at });
    expect(r.changed).toBe(true);
    expect(h.effects.sendRoleIntro).toHaveBeenCalledWith({ tenantId: T, personId: P, role: 'manager', version: 4 });
  });
});
