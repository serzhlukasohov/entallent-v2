import { STAGE, disclosureDelivered, effect, pulseCycleParams, rule, MEANING } from './texts';

/** P-07 setup: an open pulse cycle with Autonomy uncovered, and the disclosure delivered (L1 only). */
export const P07_SETUP = [{ name: 'pulseCycle', params: pulseCycleParams('autonomy') }, disclosureDelivered];

/** Criteria P-07 evaluates on every reply: C4, C5 and E1. */
export const P07_EVERY_REPLY = [
  { id: 'P-07.C4', evaluatedAt: 'reply:1', checks: [rule('too-many-questions'), MEANING] },
  { id: 'P-07.C5', evaluatedAt: 'reply:1', checks: [rule('no-internal-terms')] },
  {
    id: 'P-07.E1',
    evaluatedAt: 'after-step:1',
    checks: [effect(STAGE, 0), effect({ port: 'aiProvider', method: 'composeQuestionBundle' }, 0)],
  },
];
