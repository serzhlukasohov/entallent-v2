import type { OnboardingActionContract } from '@entalent/contracts';
import type { PrimaryOrgRole } from '../hierarchy/draft-person';

export type OnboardingTrack = 'employee' | 'team_lead' | 'management';
export type Participation = 'undecided' | 'deferred' | 'active' | 'declined' | 'not_applicable';
export type OnboardingAction = 'start' | 'later' | 'decline' | 'got_it';

// Compile-time guard: must stay identical to the contracts enum.
const _actionsMatchContract: [OnboardingAction] extends [OnboardingActionContract] ? ([OnboardingActionContract] extends [OnboardingAction] ? true : never) : never = true;
void _actionsMatchContract;
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
