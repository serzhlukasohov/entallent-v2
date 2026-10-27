import { P08_EVERY_REPLY } from './p-08-shared';
import { MEANING, P08_STEPS, scriptedTurn } from './texts';

/** P-08 reply 1: a stated status whose cause is not yet known. */
export const test = {
  id: 'P-08.A1',
  sourceCase: 'P-08',
  requirement: ['CF-006'],
  kind: 'atomic',
  levels: ['L0', 'L1'],
  runProfile: 'isolated',
  setup: [],
  seed: { history: [] },
  scripted: scriptedTurn(),
  preconditions: [],
  steps: [{ text: P08_STEPS[0] }],
  criteria: [{ id: 'P-08.C1', evaluatedAt: 'reply:1', levels: ['L1'], checks: [MEANING] }, ...P08_EVERY_REPLY],
};
