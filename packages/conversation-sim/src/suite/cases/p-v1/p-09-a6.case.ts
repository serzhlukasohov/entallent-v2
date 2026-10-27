import { contextCriterion, decisionCriterion } from './decision-context';
import { autonomyState, p09Moment } from './p-09-shared';
import { CLARIFY, MEANING, P09_CORRECTED_STATEMENT, STAGE, VERDICT, disclosureDelivered, effect, scriptedTurn } from './texts';

/** P-09 step 5: a progress question after Autonomy is complete. P-09.C9 is NOT TESTABLE. */
export const test = {
  id: 'P-09.A6',
  sourceCase: 'P-09',
  requirement: ['CF-008'],
  kind: 'atomic',
  levels: ['L0', 'L1'],
  runProfile: 'isolated',
  setup: [
    autonomyState(['confirmed', 'confirmed', 'confirmed'], {}, { q12_opinions_count: P09_CORRECTED_STATEMENT }),
    disclosureDelivered,
  ],
  ...p09Moment(14),
  scripted: scriptedTurn(),
  preconditions: [],
  criteria: [
    { id: 'P-09.C7', evaluatedAt: 'reply:1', levels: ['L1'], checks: [MEANING] },
    { id: 'P-09.C8', evaluatedAt: 'reply:1', levels: ['L1'], checks: [MEANING] },
    { id: 'P-09.E9', evaluatedAt: 'after-step:1', checks: [effect(VERDICT, 0), effect(CLARIFY, 0), effect(STAGE, 0)] },
    decisionCriterion('P-09.E11', [{ field: 'classification.cycleStatusQuestion', in: [true] }]),
    contextCriterion('P-09.E13', { sectionsInclude: ['cycleProgress'] }, { levels: ['L1'] }),
  ],
};
