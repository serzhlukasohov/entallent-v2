import type { OnboardingSignal } from '@entalent/contracts';
import type { OnboardingAction, OnboardingEvent, OnboardingState } from './onboarding-state';

export type SignalOutcome =
  | { kind: 'event'; event: OnboardingEvent }
  | { kind: 'clarify' }
  | { kind: 'none' };

const NONE: SignalOutcome = { kind: 'none' };
const CLARIFY: SignalOutcome = { kind: 'clarify' };

/**
 * Maps the classifier's onboarding reading of a user turn to an onboarding event. The classifier only
 * labels meaning; every participation decision is made here and in `decideOnboarding` (Q2, Q2a, Q2b,
 * Q3, Q4, Q15, A2). A later/decline choice that arrives with substance is clarified, not applied;
 * an active participant's explicit stop request always applies (Q4).
 */
export function interpretOnboardingSignal(
  state: OnboardingState,
  signal: OnboardingSignal | null | undefined,
  at: Date,
): SignalOutcome {
  if (!signal) return NONE;
  const { intent, substantive } = signal;
  const act = (action: OnboardingAction): SignalOutcome => ({
    kind: 'event', event: { type: 'action', action, source: 'text', at },
  });
  const substantiveTurn: SignalOutcome = { kind: 'event', event: { type: 'substantive_turn', at } };
  const resumeIfSubstantive = substantive ? substantiveTurn : NONE;

  if (state.track === 'management') {
    return intent === 'acknowledge' && state.introStatus === 'delivered' ? act('got_it') : NONE;
  }

  switch (state.participation) {
    case 'active':
      // A clear request to stop applies even inside a substantive turn (Q4).
      if (intent === 'stop_participation') return { kind: 'event', event: { type: 'stop_requested', at } };
      if (intent === 'decline') return substantive ? CLARIFY : { kind: 'event', event: { type: 'stop_requested', at } };
      return intent === 'ambiguous' ? CLARIFY : NONE;

    case 'undecided':
    case 'deferred':
      switch (intent) {
        case 'start':
          return act('start');
        case 'later':
          return substantive ? CLARIFY : act('later');
        case 'decline':
        case 'stop_participation':
          return substantive ? CLARIFY : act('decline');
        case 'acknowledge':
          return state.track === 'team_lead' ? act('got_it') : resumeIfSubstantive;
        case 'ambiguous':
          return CLARIFY;
        case 'end_today_only':
          return state.participation === 'undecided' ? CLARIFY : resumeIfSubstantive;
        case 'none':
          return resumeIfSubstantive;
      }
      return NONE;

    case 'declined':
      switch (intent) {
        case 'start':
          return act('start');
        case 'ambiguous':
          return CLARIFY;
        case 'none':
        case 'acknowledge':
        case 'end_today_only':
          return resumeIfSubstantive;
        case 'later':
        case 'decline':
        case 'stop_participation':
          return NONE;
      }
      return NONE;

    case 'not_applicable':
      return NONE;
  }
}
