import { P07_EVERY_REPLY, P07_SETUP } from './p-07-shared';
import { P07_STEPS } from './texts';

/** P-07 reply 1. C1 is evaluated on reply 2 only (the seeded reply 1 is neutral). */
export const test = {
  id: 'P-07.A1',
  sourceCase: 'P-07',
  requirement: ['CF-002', 'CF-006'],
  kind: 'atomic',
  levels: ['L1'],
  runProfile: 'isolated',
  setup: P07_SETUP,
  seed: { history: [] },
  preconditions: [],
  steps: [{ text: P07_STEPS[0] }],
  criteria: [...P07_EVERY_REPLY],
};
