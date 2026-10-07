import { DialogueActSchema, type OnboardingSignal } from '@entalent/contracts';
import {
  initialOnboardingState, interpretOnboardingSignal, introMessages,
  type ClassifyContext, type ConversationTurn, type OnboardingState, type SignalOutcome,
} from '@entalent/application';
import { describe, expect, it } from 'vitest';
import { createLiveProvider } from '../harness/coach-harness';

/**
 * Live classifier check for the onboarding signal: the real provider and prompt, with onboarding
 * context, must parse (valid dialogueAct) and label each employee message by meaning (Q2, Q2a, Q2b,
 * Q4, Q15). TypeScript decides what changes; this only pins the labels it decides from.
 */
type Onboarding = NonNullable<ClassifyContext['onboarding']>;
type Intent = OnboardingSignal['intent'];

const undecidedEmployee: Onboarding = { track: 'employee', participation: 'undecided', introStatus: 'delivered' };
const activeEmployee: Onboarding = { track: 'employee', participation: 'active', introStatus: 'completed' };
const declinedEmployee: Onboarding = { track: 'employee', participation: 'declined', introStatus: 'delivered' };
const deliveredManager: Onboarding = { track: 'management', participation: 'not_applicable', introStatus: 'delivered' };
const undecidedTeamLead: Onboarding = { track: 'team_lead', participation: 'undecided', introStatus: 'delivered' };

interface Case {
  name: string;
  onboarding: Onboarding;
  text: string;
  intents: Intent[];
  substantive?: boolean;
  /** What TypeScript does with the label: the load-bearing product outcome. */
  outcomes: string[];
  previousIntro?: 'employee' | 'manager' | 'team_lead';
}

const CASES: Case[] = [
  { name: 'undecided postpones', onboarding: undecidedEmployee, text: "I'm swamped this week, let's do it later", intents: ['later'], substantive: false, outcomes: ['later'] },
  { name: 'undecided shares a situation', onboarding: undecidedEmployee, text: "honestly my lead keeps changing priorities and I'm exhausted", intents: ['none'], substantive: true, outcomes: ['substantive_turn'] },
  { name: 'undecided greets', onboarding: undecidedEmployee, text: 'hi', intents: ['none'], substantive: false, outcomes: ['none'] },
  { name: 'undecided asks about privacy', onboarding: undecidedEmployee, text: 'what is this exactly? who sees what I write?', intents: ['none', 'ambiguous'], substantive: false, outcomes: ['none', 'clarify'] },
  { name: 'active is busy right now', onboarding: activeEmployee, text: "not now, I'm in a meeting", intents: ['end_today_only', 'none'], outcomes: ['none'] },
  { name: 'active stops invitations', onboarding: activeEmployee, text: 'please stop sending me these check-ins', intents: ['stop_participation'], outcomes: ['stop_requested'] },
  { name: 'declined starts again', onboarding: declinedEmployee, text: 'давай поговоримо', intents: ['start'], outcomes: ['start'], previousIntro: 'employee' },
  { name: 'declined thanks', onboarding: declinedEmployee, text: 'дякую', intents: ['none', 'acknowledge'], substantive: false, outcomes: ['none'], previousIntro: 'employee' },
  { name: 'manager acknowledges', onboarding: deliveredManager, text: 'ok, thanks, looks useful', intents: ['acknowledge'], outcomes: ['got_it'], previousIntro: 'manager' },
  { name: 'team lead acknowledges', onboarding: undecidedTeamLead, text: 'got it, thanks', intents: ['acknowledge'], outcomes: ['got_it'], previousIntro: 'team_lead' },
];

function stateFor(o: Onboarding): OnboardingState {
  const role = o.track === 'management' ? 'manager' : o.track;
  return { ...initialOnboardingState(role), participation: o.participation, introStatus: o.introStatus as OnboardingState['introStatus'], buttonsActive: o.introStatus === 'delivered' };
}

function outcomeKind(outcome: SignalOutcome): string {
  if (outcome.kind !== 'event') return outcome.kind;
  return outcome.event.type === 'action' ? outcome.event.action : outcome.event.type;
}

function turnsFor(c: Case): ConversationTurn[] {
  const now = Date.now();
  const intro: ConversationTurn[] = c.previousIntro
    ? [
        { role: 'assistant', content: introMessages(c.previousIntro).intro, timestamp: new Date(now - 120_000) },
        { role: 'assistant', content: introMessages(c.previousIntro).trust, timestamp: new Date(now - 119_000) },
      ]
    : [];
  return [...intro, { role: 'user', content: c.text, timestamp: new Date(now) }];
}

describe('live onboarding classifier labels', () => {
  const provider = createLiveProvider();

  it.each(CASES)('$name: "$text"', async (c) => {
    const classification = await provider.classifySituation(turnsFor(c), {
      userName: 'Sam',
      now: new Date().toISOString(),
      timezone: 'Europe/Kyiv',
      onboarding: c.onboarding,
    });

    expect(DialogueActSchema.options).toContain(classification.dialogueAct);
    const signal = classification.onboardingSignal;
    expect(signal, `onboardingSignal missing: ${JSON.stringify(classification)}`).toBeTruthy();
    expect(c.intents, `intent=${signal?.intent} substantive=${signal?.substantive}`).toContain(signal!.intent);
    if (c.substantive !== undefined) {
      expect(signal!.substantive, `intent=${signal?.intent}`).toBe(c.substantive);
    }
    const kind = outcomeKind(interpretOnboardingSignal(stateFor(c.onboarding), signal, new Date()));
    expect(c.outcomes, `TypeScript outcome for intent=${signal?.intent}`).toContain(kind);
  });
});
