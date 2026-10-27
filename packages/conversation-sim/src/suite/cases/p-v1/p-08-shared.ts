import { decisionCriterion } from './decision-context';
import { MEANING, SEND, STAGE, effect } from './texts';

/** Criteria P-08 evaluates on every reply: C4 and E1. */
export const P08_EVERY_REPLY = [
  { id: 'P-08.C4', evaluatedAt: 'reply:1', levels: ['L1'], checks: [MEANING] },
  { id: 'P-08.E1', evaluatedAt: 'after-step:1', checks: [effect(SEND, 1), effect(STAGE, 0)] },
  decisionCriterion('P-08.E2', [
    { field: 'risk.severity', in: ['none', 'low'] },
    { field: 'risk.escalates', in: [false] },
    { field: 'mode', notIn: ['crisis', 'sensitive'] },
  ]),
];
