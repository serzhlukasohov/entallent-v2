import { contextCriterion, decisionCriterion } from './decision-context';
import { MEANING, P04_COACH_1, P04_STEP_1, P04_STEP_2, SEND, coach, effect, rule, seedOf, user, scriptedTurn } from './texts';

/** P-04 reply 2: step 2 arrives 3 minutes after reply 1 (the suite's 2-5 minute wait). */
export const test = {
  id: 'P-04.A1',
  sourceCase: 'P-04',
  requirement: ['CF-005'],
  kind: 'atomic',
  levels: ['L0', 'L1'],
  runProfile: 'isolated',
  setup: [],
  seed: seedOf([user(P04_STEP_1), coach(P04_COACH_1)], 180_000),
  scripted: scriptedTurn(),
  preconditions: [],
  steps: [{ text: P04_STEP_2 }],
  criteria: [
    { id: 'P-04.C1', evaluatedAt: 'reply:1', levels: ['L1'], checks: [rule('no-greeting-restart'), MEANING] },
    { id: 'P-04.C2', evaluatedAt: 'reply:1', levels: ['L1'], checks: [MEANING] },
    { id: 'P-04.E1', evaluatedAt: 'after-step:1', checks: [effect(SEND, 1)] },
    decisionCriterion('P-04.E2', [{ field: 'risk.severity', in: ['none'] }]),
    contextCriterion('P-04.E3', { historyTurns: 3, sessionStart: false }),
  ],
};
