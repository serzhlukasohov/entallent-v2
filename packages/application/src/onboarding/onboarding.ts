import type { CompanyOnboardingSettings, OnboardingAction, OnboardingButton } from '@entalent/contracts';
import type { PrimaryOrgRole } from '../hierarchy/draft-person';

export const ONBOARDING_VERSION = 'v2.1';
export interface OnboardingState {
  version: string;
  personalParticipation: 'undecided' | 'active' | 'declined';
  managementCompleted: boolean;
  deferredAt?: string;
  reminderQueued: boolean;
}
export function initialOnboardingState(): OnboardingState {
  return { version: ONBOARDING_VERSION, personalParticipation: 'undecided', managementCompleted: false, reminderQueued: false };
}
export function onboardingButtons(role: PrimaryOrgRole, language = 'en'): OnboardingButton[] {
  const labels = language === 'ru'
    ? { start: 'Давай поговорим', later: 'Позже', decline: 'Не хочу участвовать', got_it: 'Всё понятно' }
    : language === 'uk'
      ? { start: 'Поговорімо', later: 'Пізніше', decline: 'Не хочу брати участь', got_it: 'Усе зрозуміло' }
      : { start: role === 'team_lead' ? 'Start My Conversation' : "Let's Talk", later: 'Later',
        decline: role === 'team_lead' ? 'No Personal Check-ins' : "I Don't Want to Participate", got_it: 'Got It' };
  const actions: OnboardingAction[] = role === 'employee' ? ['start', 'later', 'decline']
    : role === 'team_lead' ? ['start', 'got_it', 'later', 'decline'] : ['got_it'];
  return actions.map((action) => ({ action, label: labels[action] }));
}
export function applyOnboardingAction(state: OnboardingState, role: PrimaryOrgRole, action: OnboardingAction, now: Date) {
  if (!onboardingButtons(role).some((button) => button.action === action)) throw new Error('onboarding_action_not_allowed');
  const next = { ...state };
  if (action === 'got_it' && next.personalParticipation !== 'undecided') return state;
  if (action === 'later') {
    if (next.personalParticipation !== 'undecided' || next.managementCompleted) return state;
    next.deferredAt = now.toISOString();
  } else {
    delete next.deferredAt;
    next.reminderQueued = true;
    if (role !== 'employee') next.managementCompleted = true;
    if (action === 'start') next.personalParticipation = 'active';
    if (action === 'decline') next.personalParticipation = 'declined';
  }
  return next;
}
export function recognizeOnboardingAction(text: string): OnboardingAction | null {
  const value = text.trim().toLowerCase().replace(/[.!’']/g, '');
  if (/^(lets talk|lets start|start my conversation|start|давай|давай поговорим|поговорімо)$/.test(value)) return 'start';
  if (/^(later|not now|позже|пізніше)$/.test(value)) return 'later';
  if (/^(i dont want to participate|no personal check-ins|не хочу участвовать|не хочу брати участь)$/.test(value)) return 'decline';
  if (/^(got it|всё понятно|все понятно|усе зрозуміло)$/.test(value)) return 'got_it';
  return null;
}
export function onboardingCompleted(state: OnboardingState, role: PrimaryOrgRole): boolean {
  return role === 'employee' ? state.personalParticipation === 'active' : state.managementCompleted;
}

export function defaultOnboardingSettings(timezone = 'UTC', defaultLanguage: 'en' | 'ru' | 'uk' = 'en'): CompanyOnboardingSettings {
  return { timezone, defaultLanguage, workingDays: [1, 2, 3, 4, 5], workdayStart: '09:00', workdayEnd: '18:00' };
}
const calendarFormatters = new Map<string, Intl.DateTimeFormat>();
function localParts(now: Date, settings: CompanyOnboardingSettings) {
  let formatter = calendarFormatters.get(settings.timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone, year: 'numeric', month: '2-digit',
      day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    calendarFormatters.set(settings.timezone, formatter);
  }
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}`,
    day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1 };
}
export function withinCompanyWorkingHours(now: Date, settings: CompanyOnboardingSettings): boolean {
  const local = localParts(now, settings);
  return settings.workingDays.includes(local.day) && local.time >= settings.workdayStart && local.time < settings.workdayEnd;
}
/** Advance local calendar dates rather than 48 elapsed hours; handles weekends and DST. */
export function onboardingReminderDueAt(from: Date, settings: CompanyOnboardingSettings): Date {
  const origin = localParts(from, settings);
  const cursor = new Date(`${origin.date}T12:00:00Z`);
  let remaining = 2;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (settings.workingDays.includes(cursor.getUTCDay() || 7)) remaining--;
  }
  const target = cursor.toISOString().slice(0, 10);
  // Find the first configured opening minute on the target local date.
  const lower = new Date(`${target}T00:00:00Z`).getTime() - 15 * 3600000;
  for (let minute = 0; minute < 54 * 60; minute++) {
    const candidate = new Date(lower + minute * 60000);
    const local = localParts(candidate, settings);
    if (local.date === target && withinCompanyWorkingHours(candidate, settings)) return candidate;
  }
  throw new Error('onboarding_calendar_unresolvable');
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function readOnboardingState(preferences: unknown): OnboardingState | null {
  const state = object(object(preferences).onboarding);
  return typeof state.version === 'string' && ['undecided', 'active', 'declined'].includes(String(state.personalParticipation))
    ? state as unknown as OnboardingState : null;
}
