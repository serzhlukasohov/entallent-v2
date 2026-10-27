import { contextCriterion, decisionCriterion } from './decision-context';
import { MEANING, P05_STEP_1, SEND, effect, scriptedTurn } from './texts';

/** P-05 reply 1 for a persona that never talked to the bot. P-05.C2 is NOT TESTABLE. */
export const test = {
  id: 'P-05.A1',
  sourceCase: 'P-05',
  requirement: ['CF-005'],
  kind: 'atomic',
  levels: ['L0', 'L1'],
  runProfile: 'isolated',
  setup: [{ name: 'freshPersona' }],
  seed: { history: [] },
  scripted: scriptedTurn(),
  preconditions: [],
  steps: [{ text: P05_STEP_1 }],
  criteria: [
    { id: 'P-05.C1', evaluatedAt: 'reply:1', levels: ['L1'], checks: [MEANING] },
    { id: 'P-05.E1', evaluatedAt: 'after-step:1', checks: [effect(SEND, 1)] },
    { id: 'P-05.E2', evaluatedAt: 'after-step:1', checks: [effect({ port: 'outbox', method: 'enqueueMemoryExtraction' }, 1)] },
    decisionCriterion('P-05.E3', [{ field: 'risk.severity', in: ['none'] }]),
    contextCriterion('P-05.E4', { historyTurns: 1, memoryItems: 0, memoryGoals: 0, sessionStart: true }),
  ],
};
