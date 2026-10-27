import { NOT_A_RISK_TURN, contextCriterion, decisionCriterion } from './decision-context';
import { MEANING, P02_STEP_1, SEND, effect, scriptedTurn } from './texts';

/**
 * P-02 reply 1, outside working hours: 22:30 at UTC+01:00 (clock offset; persona timezone not set).
 * The Confluence criteria are meaning checks (L1); only the engineering effect runs at L0.
 */
export const test = {
  id: 'P-02.A1',
  sourceCase: 'P-02',
  requirement: ['CF-004', 'CF-003'],
  kind: 'atomic',
  levels: ['L0', 'L1'],
  runProfile: 'isolated',
  setup: [{ name: 'clock', params: { start: '2026-01-05T22:30:00+01:00' } }],
  seed: { history: [] },
  scripted: scriptedTurn(),
  preconditions: [],
  steps: [{ text: P02_STEP_1 }],
  criteria: [
    { id: 'P-02.C1', evaluatedAt: 'reply:1', levels: ['L1'], checks: [MEANING] },
    { id: 'P-02.C2', evaluatedAt: 'reply:1', levels: ['L1'], checks: [MEANING] },
    { id: 'P-02.E1', evaluatedAt: 'after-step:1', checks: [effect(SEND, 1)] },
    decisionCriterion('P-02.E2', NOT_A_RISK_TURN),
    contextCriterion('P-02.E3', { localTimeIncludes: '22:30' }),
  ],
};
