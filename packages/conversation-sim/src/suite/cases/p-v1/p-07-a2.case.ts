import { P07_EVERY_REPLY, P07_SETUP } from './p-07-shared';
import { MEANING, P07_COACH, P07_STEPS, coach, seedOf, user } from './texts';

/** P-07 reply 2, after the approved neutral reply 1. */
export const test = {
  id: 'P-07.A2',
  sourceCase: 'P-07',
  requirement: ['CF-002', 'CF-006'],
  kind: 'atomic',
  levels: ['L1'],
  runProfile: 'isolated',
  setup: P07_SETUP,
  seed: seedOf([user(P07_STEPS[0]), coach(P07_COACH[0])]),
  preconditions: [],
  steps: [{ text: P07_STEPS[1] }],
  criteria: [{ id: 'P-07.C1', evaluatedAt: 'reply:1', checks: [MEANING] }, ...P07_EVERY_REPLY],
};
