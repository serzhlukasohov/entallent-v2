import { contextCriterion } from './decision-context';
import { P08_EVERY_REPLY } from './p-08-shared';
import { MEANING, P08_COACH, P08_STEPS, coach, rule, seedOf, user, scriptedTurn } from './texts';

/**
 * P-08 reply 3. The seeded reply 2 asks no question, so C2 ("no two consecutive replies
 * without a question about the cause") is decided by reply 3 alone.
 */
export const test = {
  id: 'P-08.A3',
  sourceCase: 'P-08',
  requirement: ['CF-006'],
  kind: 'atomic',
  levels: ['L0', 'L1'],
  runProfile: 'isolated',
  setup: [],
  seed: seedOf([user(P08_STEPS[0]), coach(P08_COACH[0]), user(P08_STEPS[1]), coach(P08_COACH[1])]),
  scripted: scriptedTurn(),
  preconditions: [],
  steps: [{ text: P08_STEPS[2] }],
  criteria: [
    { id: 'P-08.C2', evaluatedAt: 'conversation', levels: ['L1'], checks: [rule('no-two-replies-without-cause-question'), MEANING] },
    { id: 'P-08.C3', evaluatedAt: 'reply:1', levels: ['L1'], checks: [MEANING] },
    ...P08_EVERY_REPLY,
    contextCriterion('P-08.E3', { historyTurns: 5 }),
  ],
};
