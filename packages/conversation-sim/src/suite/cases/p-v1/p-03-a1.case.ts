import { contextCriterion, decisionCriterion } from './decision-context';
import { CLARIFY, MEANING, P03_PENDING_BOT_QUESTION, P03_STEP_1, SEND, VERDICT, effect, scriptedTurn } from './texts';

/** P-03 reply 1: the last DM message is an unanswered bot-initiated question. */
export const test = {
  id: 'P-03.A1',
  sourceCase: 'P-03',
  requirement: ['CF-004'],
  kind: 'atomic',
  levels: ['L0', 'L1'],
  runProfile: 'isolated',
  setup: [
    {
      name: 'pendingBotQuestion',
      params: { text: P03_PENDING_BOT_QUESTION, atOffsetMs: 3_600_000, messageType: 'proactive_check_in' },
    },
  ],
  seed: { history: [] },
  scripted: scriptedTurn(),
  preconditions: [],
  steps: [{ text: P03_STEP_1 }],
  criteria: [
    { id: 'P-03.C1', evaluatedAt: 'reply:1', levels: ['L1'], checks: [MEANING] },
    { id: 'P-03.C2', evaluatedAt: 'reply:1', levels: ['L1'], checks: [MEANING] },
    { id: 'P-03.C3', evaluatedAt: 'reply:1', levels: ['L1'], checks: [MEANING] },
    { id: 'P-03.E1', evaluatedAt: 'after-step:1', checks: [effect(SEND, 1)] },
    { id: 'P-03.E2', evaluatedAt: 'after-step:1', checks: [effect(VERDICT, 0), effect(CLARIFY, 0)] },
    decisionCriterion('P-03.E3', [
      { field: 'classification.primaryIntent', notIn: ['survey_opportunity'] },
      { field: 'mode', notIn: ['survey_probe'] },
      { field: 'reply.surveyQuestion', in: [false] },
    ]),
    contextCriterion('P-03.E4', { historyTurns: 2, historyAssistant: 1, lastRole: 'user' }),
  ],
};
