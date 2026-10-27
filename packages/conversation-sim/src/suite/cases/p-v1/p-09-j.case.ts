import { P09_CONVERSATION } from './p-09-shared';
import { MEANING, disclosureDelivered, pulseCycleParams, rule } from './texts';

/** Journey steps: the user turns of the product-order conversation (8 steps). */
const STEPS = P09_CONVERSATION.filter((turn) => turn.role === 'user').map((turn) => ({ text: turn.text }));
/** 1-based journey steps: 4 = authored summary turn, 5 = suite step 4, 6 = clarification, 7 = confirmation, 8 = suite step 5. */
const SUMMARY_TURN = 4;

/**
 * P-09 smoke journey in product order (Illia, 2026-10-27), L1 and L2. The checkpoint sits on the
 * summary turn: without a staged summary the journey stops and later criteria are INVALID.
 * No `freshPersona`: it verifies an empty question window, which `pulseCycle` opens; isolation
 * comes from the run profile.
 */
export const test = {
  id: 'P-09.J',
  sourceCase: 'P-09',
  requirement: ['CF-008'],
  kind: 'journey',
  levels: ['L1', 'L2'],
  runProfile: 'isolated',
  setup: [{ name: 'pulseCycle', params: pulseCycleParams('autonomy') }, disclosureDelivered],
  preconditions: [],
  steps: STEPS.map((step, index) =>
    index + 1 === SUMMARY_TURN
      ? { ...step, checkpoint: { checks: [rule('bundle-staged')], onFail: 'stop' } }
      : step,
  ),
  criteria: [
    { id: 'P-09.C1', evaluatedAt: `reply:${SUMMARY_TURN}`, checks: [rule('bundle-staged'), MEANING] },
    { id: 'P-09.C2', evaluatedAt: `reply:${SUMMARY_TURN}`, checks: [MEANING] },
    // The corrected statement is shown on the reply to the authored clarification. A judge cannot
    // decide a `state` criterion, so the journey checks the reply's meaning; staging the corrected
    // statement is checked by P-09.A4 (C3, E7) and bounded by C6 here.
    { id: 'P-09.C3', evaluatedAt: 'reply:6', checks: [MEANING] },
    { id: 'P-09.C4', evaluatedAt: 'reply:7', checks: [MEANING] },
    {
      id: 'P-09.C5',
      evaluatedAt: 'state',
      stateQuery: { name: 'questionProgress', at: 'after-step:7', kind: 'change' },
      checks: [rule('state-equals', { query: 'questionProgress', at: 'after-step:7', expected: { answered: 3, total: 3 } })],
    },
    {
      id: 'P-09.C6',
      evaluatedAt: 'state',
      stateQuery: { name: 'stagedBundleCount', at: 'after', kind: 'invariant' },
      // One summary and one corrected statement are shown in this flow; the metadata bound
      // counts only `v2ConfirmationBundle` replies, not corrected statements (deferred-work.md).
      checks: [rule('state-not-greater-than', { query: 'stagedBundleCount', at: 'after', delta: true, max: 2 })],
    },
    { id: 'P-09.C7', evaluatedAt: 'reply:8', checks: [MEANING] },
    { id: 'P-09.C8', evaluatedAt: 'reply:8', checks: [MEANING] },
  ],
};
