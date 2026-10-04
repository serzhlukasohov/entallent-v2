import { describe, expect, it } from 'vitest';
import { CompanyOnboardingSettingsSchema } from '@entalent/contracts';
import { applyOnboardingAction, initialOnboardingState, onboardingButtons, onboardingCompleted,
  onboardingReminderDueAt, withinCompanyWorkingHours, defaultOnboardingSettings, recognizeOnboardingAction } from './onboarding';
import { onboardingCopy } from './onboarding-copy';
import type { PrimaryOrgRole } from '../hierarchy/draft-person';

const roles: PrimaryOrgRole[] = ['employee', 'team_lead', 'manager', 'hr', 'hrbp', 'leadership'];
describe('onboarding participation boundaries', () => {
  it.each(roles)('uses %s copy without unavailable report examples or personalization', (role) => {
    const text = onboardingCopy(role);
    expect(text).toContain('not shown to anyone');
    expect(text).not.toMatch(/sample report|view.*report|choose.*style|icebreaker/i);
    expect(onboardingButtons(role).map((b) => b.action)).not.toContain('view_sample');
  });
  it('employee participation is explicit and never grants insight approval', () => {
    const initial = initialOnboardingState();
    expect(onboardingCompleted(initial, 'employee')).toBe(false);
    const deferred = applyOnboardingAction(initial, 'employee', 'later', new Date());
    expect(onboardingCompleted(deferred, 'employee')).toBe(false);
    const active = applyOnboardingAction(deferred, 'employee', 'start', new Date());
    expect(onboardingCompleted(active, 'employee')).toBe(true);
    expect(active).not.toHaveProperty('insightConsent');
  });
  it('Team Lead can finish management onboarding and decline personal invitations', () => {
    const state = applyOnboardingAction(initialOnboardingState(), 'team_lead', 'decline', new Date());
    expect(onboardingCompleted(state, 'team_lead')).toBe(true);
    expect(state.personalParticipation).toBe('declined');
    expect(state.reminderQueued).toBe(true);
    const returned = applyOnboardingAction(state, 'team_lead', 'start', new Date());
    expect(returned.personalParticipation).toBe('active');
    expect(returned.managementCompleted).toBe(true);
  });
  it.each(['manager', 'hr', 'hrbp', 'leadership'] as PrimaryOrgRole[])('%s cannot enter personal Pulse via an action', (role) => {
    expect(() => applyOnboardingAction(initialOnboardingState(), role, 'start', new Date())).toThrow('onboarding_action_not_allowed');
    const ready = applyOnboardingAction(initialOnboardingState(), role, 'got_it', new Date());
    expect(ready.managementCompleted).toBe(true);
    expect(ready.personalParticipation).toBe('undecided');
  });
  it('a stale Later does not restart reminders for an active participant', () => {
    const state = applyOnboardingAction(initialOnboardingState(), 'employee', 'start', new Date());
    expect(applyOnboardingAction(state, 'employee', 'later', new Date())).toEqual(state);
  });
  it('does not infer participation from a question or an ambiguous yes', () => {
    expect(recognizeOnboardingAction('yes')).toBeNull();
    expect(recognizeOnboardingAction('Can I start later?')).toBeNull();
    expect(recognizeOnboardingAction("Let's Talk")).toBe('start');
  });
});
describe('company working calendar', () => {
  const settings = defaultOnboardingSettings('Europe/Warsaw');
  it('Friday deferral becomes Tuesday opening, crossing the DST change', () => {
    expect(onboardingReminderDueAt(new Date('2026-10-23T13:00:00Z'), settings).toISOString()).toBe('2026-10-27T08:00:00.000Z');
  });
  it('uses configured working days rather than Monday-Friday assumptions', () => {
    expect(onboardingReminderDueAt(new Date('2026-10-02T10:00:00Z'), { ...settings, workingDays: [1, 3, 6], workdayStart: '10:30' }).toISOString())
      .toBe('2026-10-05T08:30:00.000Z');
  });
  it('does not send during weekends or outside the local workday', () => {
    expect(withinCompanyWorkingHours(new Date('2026-10-04T10:00:00Z'), settings)).toBe(false);
    expect(withinCompanyWorkingHours(new Date('2026-10-05T06:00:00Z'), settings)).toBe(false);
    expect(withinCompanyWorkingHours(new Date('2026-10-05T07:00:00Z'), settings)).toBe(true);
    expect(withinCompanyWorkingHours(new Date('2026-10-05T16:00:00Z'), settings)).toBe(false);
  });
  it('rejects invalid timezones, empty calendars, duplicates, and inverted hours', () => {
    for (const invalid of [{ timezone: 'invalid' }, { workingDays: [] }, { workingDays: [1, 1] }, { workdayStart: '19:00' }]) {
      expect(CompanyOnboardingSettingsSchema.safeParse({ ...settings, ...invalid }).success).toBe(false);
    }
  });
});
