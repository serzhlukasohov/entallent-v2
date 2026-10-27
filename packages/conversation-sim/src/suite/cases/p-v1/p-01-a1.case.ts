import { NOT_A_RISK_TURN, contextCriterion, decisionCriterion } from './decision-context';
import { MEANING, P01_STEP_1, SEND, STAGE, effect, rule, scriptedTurn } from './texts';

/** P-01 reply 1, during working hours: 10:00 at UTC+01:00 (clock offset; persona timezone not set), no pending bot question. */
export const test = {
  id: 'P-01.A1',
  sourceCase: 'P-01',
  requirement: ['CF-004'],
  kind: 'atomic',
  levels: ['L0', 'L1'],
  runProfile: 'isolated',
  setup: [{ name: 'clock', params: { start: '2026-01-05T10:00:00+01:00' } }],
  seed: { history: [] },
  scripted: scriptedTurn(),
  preconditions: [],
  steps: [{ text: P01_STEP_1 }],
  criteria: [
    { id: 'P-01.C1', evaluatedAt: 'reply:1', levels: ['L1'], checks: [MEANING] },
    { id: 'P-01.C2', evaluatedAt: 'reply:1', checks: [rule('reply-present'), MEANING] },
    { id: 'P-01.E1', evaluatedAt: 'after-step:1', checks: [effect(SEND, 1)] },
    { id: 'P-01.E2', evaluatedAt: 'after-step:1', checks: [effect(STAGE, 0)] },
    decisionCriterion('P-01.E3', NOT_A_RISK_TURN),
    contextCriterion('P-01.E4', { historyTurns: 1, historyUser: 1, memoryItems: 0, sessionStart: true }),
  ],
};
