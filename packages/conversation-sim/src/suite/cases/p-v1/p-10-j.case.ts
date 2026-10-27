import { MEANING, P10_STEPS, disclosureDelivered, pulseCycleParams, rule } from './texts';

/**
 * P-10 smoke journey, steps 1-3 verbatim, L1 and L2. No `freshPersona` (it verifies an empty
 * question window, which `pulseCycle` opens); isolation comes from the run profile.
 */
export const test = {
  id: 'P-10.J',
  sourceCase: 'P-10',
  requirement: ['CF-004'],
  kind: 'journey',
  levels: ['L1', 'L2'],
  runProfile: 'isolated',
  setup: [{ name: 'pulseCycle', params: pulseCycleParams('belonging') }, disclosureDelivered],
  preconditions: [],
  steps: P10_STEPS.map((text) => ({ text })),
  criteria: [
    { id: 'P-10.C1', evaluatedAt: 'reply:3', checks: [MEANING] },
    { id: 'P-10.C2', evaluatedAt: 'reply:3', checks: [rule('answer-then-bundle'), MEANING] },
    { id: 'P-10.C3', evaluatedAt: 'reply:3', checks: [MEANING] },
  ],
};
