import { describe, expect, it } from 'vitest';
import type { OnboardingSignal } from '@entalent/contracts';
import { initialOnboardingState, type OnboardingState, type Participation } from './onboarding-state';
import { interpretOnboardingSignal } from './onboarding-signal';

const AT = new Date('2026-10-07T10:00:00.000Z');

function employee(participation: Participation, extra: Partial<OnboardingState> = {}): OnboardingState {
  return { ...initialOnboardingState('employee'), introStatus: 'delivered', buttonsActive: true, participation, ...extra };
}
function teamLead(participation: Participation): OnboardingState {
  return { ...initialOnboardingState('team_lead'), introStatus: 'delivered', buttonsActive: true, participation };
}
function manager(introStatus: OnboardingState['introStatus']): OnboardingState {
  return { ...initialOnboardingState('manager'), introStatus };
}
const sig = (intent: OnboardingSignal['intent'], substantive = false): OnboardingSignal => ({ intent, substantive });
const action = (a: 'start' | 'later' | 'decline' | 'got_it') => ({
  kind: 'event', event: { type: 'action', action: a, source: 'text', at: AT },
});
const SUBSTANTIVE = { kind: 'event', event: { type: 'substantive_turn', at: AT } };
const STOP = { kind: 'event', event: { type: 'stop_requested', at: AT } };
const NONE = { kind: 'none' };
const CLARIFY = { kind: 'clarify' };

const ALL_PERSONAL: Participation[] = ['undecided', 'deferred', 'active', 'declined'];
const NOT_ACTIVE: Participation[] = ['undecided', 'deferred', 'declined'];

describe('interpretOnboardingSignal', () => {
  it.each(ALL_PERSONAL)('%s: a null/absent signal is none', (p) => {
    expect(interpretOnboardingSignal(employee(p), null, AT)).toEqual(NONE);
    expect(interpretOnboardingSignal(employee(p), undefined, AT)).toEqual(NONE);
  });

  it.each(ALL_PERSONAL)('%s: intent none without substance is none', (p) => {
    expect(interpretOnboardingSignal(employee(p), sig('none'), AT)).toEqual(NONE);
  });

  it('management: a null signal is none', () => {
    expect(interpretOnboardingSignal(manager('delivered'), null, AT)).toEqual(NONE);
  });

  describe.each(['undecided', 'deferred'] as const)('%s', (p) => {
    it('start → action start (text)', () => {
      expect(interpretOnboardingSignal(employee(p), sig('start'), AT)).toEqual(action('start'));
    });
    it('later → action later', () => {
      expect(interpretOnboardingSignal(employee(p), sig('later'), AT)).toEqual(action('later'));
    });
    it('decline → action decline', () => {
      expect(interpretOnboardingSignal(employee(p), sig('decline'), AT)).toEqual(action('decline'));
    });
    it('stop_participation → action decline', () => {
      expect(interpretOnboardingSignal(employee(p), sig('stop_participation'), AT)).toEqual(action('decline'));
    });
    it('team lead acknowledge → action got_it', () => {
      expect(interpretOnboardingSignal(teamLead(p), sig('acknowledge'), AT)).toEqual(action('got_it'));
    });
    it('employee acknowledge without substance → none (Q15)', () => {
      expect(interpretOnboardingSignal(employee(p), sig('acknowledge'), AT)).toEqual(NONE);
    });
    it('none + substantive → substantive_turn', () => {
      expect(interpretOnboardingSignal(employee(p), sig('none', true), AT)).toEqual(SUBSTANTIVE);
    });
    it('ambiguous → clarify', () => {
      expect(interpretOnboardingSignal(employee(p), sig('ambiguous'), AT)).toEqual(CLARIFY);
    });
    it('start + substantive → the explicit start wins', () => {
      expect(interpretOnboardingSignal(employee(p), sig('start', true), AT)).toEqual(action('start'));
    });
    it('later + substantive → clarify', () => {
      expect(interpretOnboardingSignal(employee(p), sig('later', true), AT)).toEqual(CLARIFY);
    });
    it('decline + substantive → clarify', () => {
      expect(interpretOnboardingSignal(employee(p), sig('decline', true), AT)).toEqual(CLARIFY);
    });
  });

  it('undecided: end_today_only → clarify (Q4)', () => {
    expect(interpretOnboardingSignal(employee('undecided'), sig('end_today_only'), AT)).toEqual(CLARIFY);
  });

  it('deferred: end_today_only without substance → none', () => {
    expect(interpretOnboardingSignal(employee('deferred'), sig('end_today_only'), AT)).toEqual(NONE);
  });

  describe('declined', () => {
    it('none + substantive → substantive_turn (resume, Q3/Q5)', () => {
      expect(interpretOnboardingSignal(employee('declined'), sig('none', true), AT)).toEqual(SUBSTANTIVE);
    });
    it('a greeting ("давай" read as none, not substantive) → none (A2, bug 1.2)', () => {
      expect(interpretOnboardingSignal(employee('declined'), sig('none', false), AT)).toEqual(NONE);
    });
    it('later → none, never deferred (bug 1.3)', () => {
      expect(interpretOnboardingSignal(employee('declined'), sig('later'), AT)).toEqual(NONE);
    });
    it('explicit start → action start', () => {
      expect(interpretOnboardingSignal(employee('declined'), sig('start'), AT)).toEqual(action('start'));
    });
    it('decline again → none', () => {
      expect(interpretOnboardingSignal(employee('declined'), sig('decline'), AT)).toEqual(NONE);
    });
    it('ambiguous → clarify', () => {
      expect(interpretOnboardingSignal(employee('declined'), sig('ambiguous'), AT)).toEqual(CLARIFY);
    });
  });

  describe('active', () => {
    it('stop_participation → stop_requested', () => {
      expect(interpretOnboardingSignal(employee('active'), sig('stop_participation'), AT)).toEqual(STOP);
    });
    it('decline → stop_requested', () => {
      expect(interpretOnboardingSignal(employee('active'), sig('decline'), AT)).toEqual(STOP);
    });
    it.each(['end_today_only', 'later', 'none', 'start', 'acknowledge'] as const)(
      '%s → none (bug 1.1, Review Focus 2)',
      (intent) => {
        expect(interpretOnboardingSignal(employee('active'), sig(intent), AT)).toEqual(NONE);
        expect(interpretOnboardingSignal(employee('active'), sig(intent, true), AT)).toEqual(NONE);
      },
    );
    it('stop_participation + substantive → still stop_requested (Q4)', () => {
      expect(interpretOnboardingSignal(employee('active'), sig('stop_participation', true), AT)).toEqual(STOP);
    });
    it('ambiguous → clarify (Q2, Q4)', () => {
      expect(interpretOnboardingSignal(employee('active'), sig('ambiguous'), AT)).toEqual(CLARIFY);
      expect(interpretOnboardingSignal(employee('active'), sig('ambiguous', true), AT)).toEqual(CLARIFY);
    });
  });

  describe('management', () => {
    it('delivered + acknowledge → action got_it (Q2a)', () => {
      expect(interpretOnboardingSignal(manager('delivered'), sig('acknowledge'), AT)).toEqual(action('got_it'));
    });
    it('delivered + acknowledge with substance → still got_it', () => {
      expect(interpretOnboardingSignal(manager('delivered'), sig('acknowledge', true), AT)).toEqual(action('got_it'));
    });
    it('completed + acknowledge → none', () => {
      expect(interpretOnboardingSignal(manager('completed'), sig('acknowledge'), AT)).toEqual(NONE);
    });
    it.each(['start', 'later', 'decline', 'stop_participation', 'end_today_only', 'ambiguous', 'none'] as const)(
      '%s → none (no personal participation)',
      (intent) => {
        expect(interpretOnboardingSignal(manager('delivered'), sig(intent, true), AT)).toEqual(NONE);
      },
    );
  });

  it.each(NOT_ACTIVE)('%s: never emits substantive_turn without substance', (p) => {
    for (const intent of ['none', 'acknowledge', 'end_today_only'] as const) {
      const outcome = interpretOnboardingSignal(employee(p), sig(intent), AT);
      expect(outcome).not.toEqual(SUBSTANTIVE);
    }
  });
});
