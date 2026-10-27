import { contextCriterion } from './decision-context';
import { P08_EVERY_REPLY } from './p-08-shared';
import { P08_COACH, P08_STEPS, coach, seedOf, user, scriptedTurn } from './texts';

/** P-08 reply 2, after the approved reply 1 (which asks for the cause). */
export const test = {
  id: 'P-08.A2',
  sourceCase: 'P-08',
  requirement: ['CF-006'],
  kind: 'atomic',
  levels: ['L0', 'L1'],
  runProfile: 'isolated',
  setup: [],
  seed: seedOf([user(P08_STEPS[0]), coach(P08_COACH[0])]),
  scripted: scriptedTurn(),
  preconditions: [],
  steps: [{ text: P08_STEPS[1] }],
  criteria: [...P08_EVERY_REPLY, contextCriterion('P-08.E3', { historyTurns: 3 })],
};
