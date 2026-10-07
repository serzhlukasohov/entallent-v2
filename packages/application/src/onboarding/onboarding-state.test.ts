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
