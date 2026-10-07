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
    const r = decideOnboarding(active, { type: 'role_changed', from: 'employee', to: 'team_lead', at: t1 });
    expect(r.next).toMatchObject({ track: 'team_lead', participation: 'active', managementAckAt: null });
    expect(r.effects).toContainEqual({ type: 'send_intro', track: 'team_lead' });
  });
  it('team lead -> manager stops personal Pulse', () => {
    const tl = decideOnboarding(delivered('team_lead'), { type: 'action', action: 'got_it', source: 'button', at: t1 }).next;
    const r = decideOnboarding(tl, { type: 'role_changed', from: 'team_lead', to: 'manager', at: t1 });
    expect(r.next).toMatchObject({ track: 'management', participation: 'not_applicable' });
    expect(r.effects).toContainEqual({ type: 'set_proactive', enabled: false });
    expect(r.effects).toContainEqual({ type: 'send_intro', track: 'management' });
  });
  it('manager -> employee starts a fresh personal onboarding, not enabled automatically (A6)', () => {
    const m = decideOnboarding(delivered('manager'), { type: 'action', action: 'got_it', source: 'button', at: t1 }).next;
    const r = decideOnboarding(m, { type: 'role_changed', from: 'manager', to: 'employee', at: t1 });
    expect(r.next).toMatchObject({ track: 'employee', participation: 'undecided', introStatus: 'pending', reminderStatus: 'none' });
    expect(r.effects).toEqual([{ type: 'send_intro', track: 'employee' }]);
  });
  it('team lead -> employee keeps state and sends nothing', () => {
    const tl = decideOnboarding(delivered('team_lead'), { type: 'action', action: 'got_it', source: 'button', at: t1 }).next;
    expect(decideOnboarding(tl, { type: 'role_changed', from: 'team_lead', to: 'employee', at: t1 }).effects).toEqual([]);
  });
  it('deactivation cancels a scheduled reminder and keeps the decision', () => {
    const r = decideOnboarding(delivered('employee'), { type: 'deactivated', at: t1 });
    expect(r.next).toMatchObject({ participation: 'undecided', reminderStatus: 'cancelled' });
    expect(r.effects).toEqual([{ type: 'cancel_reminder' }]);
  });
});

describe('stale clicks and button lifecycle (Q6, Q24, Q8)', () => {
  const act = (st: OnboardingState, action: 'start' | 'later' | 'decline' | 'got_it', source: 'button' | 'text' = 'button') =>
    decideOnboarding(st, { type: 'action', action, source, at: t1 });

  it('duplicate button Later before the reminder has no effects (Q6)', () => {
    const deferred = act(delivered('employee'), 'later').next;
    expect(deferred.buttonsActive).toBe(false);
    const r = act(deferred, 'later');
    expect(r.effects).toEqual([]);
    expect(r.next).toEqual(deferred);
  });
  it('text Later while deferred still reschedules and acknowledges (Q13)', () => {
    const deferred = act(delivered('employee'), 'later').next;
    const r = decideOnboarding(deferred, { type: 'action', action: 'later', source: 'text', at: new Date('2026-10-07T12:00:00Z') });
    expect(types(r.effects)).toEqual(['schedule_reminder', 'acknowledge']);
    expect(r.next.reminderOriginAt).toEqual(new Date('2026-10-07T12:00:00Z'));
  });
  it('Later after the reminder with buttons active removes buttons once (Q24)', () => {
    const reminded = decideOnboarding(delivered('employee'), { type: 'reminder_sent', at: t1 }).next;
    const r = act(reminded, 'later');
    expect(r.effects).toEqual([
      { type: 'remove_buttons', replacement: 'later_after_reminder' },
      { type: 'acknowledge', key: 'later_after_reminder' },
    ]);
    expect(r.next.buttonsActive).toBe(false);
  });
  it('button Later after reminder with buttons already removed has no effects', () => {
    const reminded = decideOnboarding(delivered('employee'), { type: 'reminder_sent', at: t1 }).next;
    const once = act(reminded, 'later').next;
    expect(act(once, 'later').effects).toEqual([]);
  });
  it('stale button got_it has no effects', () => {
    const tl = act(delivered('team_lead'), 'got_it').next;
    expect(act(tl, 'got_it').effects).toEqual([]);
    const deferred = act(delivered('team_lead'), 'later').next;
    expect(act(deferred, 'got_it').effects).toEqual([]);
  });
  it('stale button decline while declined has no effects; decline while active still applies (Q6)', () => {
    const declined = act(delivered('employee'), 'decline').next;
    expect(act(declined, 'decline').effects).toEqual([]);
    const active = act(delivered('employee'), 'start').next;
    expect(act(active, 'decline').effects).toContainEqual({ type: 'set_proactive', enabled: false });
  });
  it('a substantive turn resuming a declined user completes onboarding', () => {
    const declined = decideOnboarding(delivered('employee'), { type: 'action', action: 'decline', source: 'button', at: t0 }).next;
    const r = decideOnboarding(declined, { type: 'substantive_turn', at: t1 });
    expect(r.next).toMatchObject({ participation: 'active', introStatus: 'completed', completedAt: t1 });
  });
  it('management got it with completed intro but fresh buttons acknowledges once (Q8)', () => {
    const done = act(delivered('hr'), 'got_it').next;
    const redelivered = decideOnboarding(done, { type: 'intro_delivered', at: t1 }).next;
    expect(redelivered.buttonsActive).toBe(true);
    const r = act(redelivered, 'got_it');
    expect(r.effects).toEqual([
      { type: 'remove_buttons', replacement: 'got_it_management' },
      { type: 'acknowledge', key: 'got_it_management' },
    ]);
    expect(act(r.next, 'got_it').effects).toEqual([]);
  });
  it('hr -> manager emits send_intro management without changing state otherwise', () => {
    const done = act(delivered('hr'), 'got_it').next;
    const r = decideOnboarding(done, { type: 'role_changed', from: 'hr', to: 'manager', at: t1 });
    expect(r.effects).toEqual([{ type: 'send_intro', track: 'management' }]);
    expect(r.next).toEqual(done);
  });
  it('same role change is a no-op', () => {
    const done = act(delivered('hr'), 'got_it').next;
    expect(decideOnboarding(done, { type: 'role_changed', from: 'hr', to: 'hr', at: t1 }).effects).toEqual([]);
  });
  it('active employee -> team lead -> intro_delivered -> got_it acknowledges once and sets managementAckAt (Q8)', () => {
    const active = act(delivered('employee'), 'start').next;
    const changed = decideOnboarding(active, { type: 'role_changed', from: 'employee', to: 'team_lead', at: t1 }).next;
    const redelivered = decideOnboarding(changed, { type: 'intro_delivered', at: t1 });
    expect(redelivered.effects).toEqual([]);
    expect(redelivered.next).toMatchObject({ buttonsActive: true, reminderStatus: active.reminderStatus });
    const r = act(redelivered.next, 'got_it');
    expect(r.next).toMatchObject({ managementAckAt: t1, buttonsActive: false, participation: 'active' });
    expect(r.effects).toEqual([
      { type: 'remove_buttons', replacement: 'got_it_team_lead' },
      { type: 'acknowledge', key: 'got_it_team_lead' },
    ]);
    expect(act(r.next, 'got_it').effects).toEqual([]);
  });
  it('active team lead with fresh intro buttons: start removes buttons and starts conversation', () => {
    const active = act(delivered('employee'), 'start').next;
    const changed = decideOnboarding(active, { type: 'role_changed', from: 'employee', to: 'team_lead', at: t1 }).next;
    const fresh = decideOnboarding(changed, { type: 'intro_delivered', at: t1 }).next;
    const r = act(fresh, 'start');
    expect(r.effects).toEqual([
      { type: 'remove_buttons', replacement: 'started' },
      { type: 'start_conversation' },
    ]);
    expect(r.next.buttonsActive).toBe(false);
    expect(act(r.next, 'start').effects).toEqual([]);
  });
});
