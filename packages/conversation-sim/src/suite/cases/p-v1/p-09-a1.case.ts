import { autonomyState, p09Moment } from './p-09-shared';
import { STAGE, disclosureDelivered, effect, scriptedTurn } from './texts';

/**
 * P-09 step 3 (the third answer). Evidence is extracted after the reply, so the product shows
 * no summary on this turn (p-v1-product-findings.md); only the engineering effect is checked.
 */
export const test = {
  id: 'P-09.A1',
  sourceCase: 'P-09',
  requirement: ['CF-008'],
  kind: 'atomic',
  levels: ['L0', 'L1'],
  runProfile: 'isolated',
  setup: [autonomyState(['ready', 'ready', 'pending']), disclosureDelivered],
  ...p09Moment(4),
  scripted: scriptedTurn(),
  preconditions: [],
  criteria: [{ id: 'P-09.E1', evaluatedAt: 'after-step:1', checks: [effect(STAGE, 0)] }],
};
