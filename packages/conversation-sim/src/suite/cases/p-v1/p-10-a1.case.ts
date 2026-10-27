import { SURVEY_ALLOWED, contextCriterion, decisionCriterion } from './decision-context';
import {
  BELONGING_IDS,
  BELONGING_SUMMARIES,
  BELONGING_WINDOW,
  MEANING,
  P10_COACH,
  P10_STEPS,
  SEND,
  coach,
  confirmationQuestion,
  disclosureDelivered,
  effect,
  rule,
  scriptedTurn,
  seedOf,
  user,
} from './texts';

/**
 * P-10 reply 3: a practical question in the same message as the third Belonging answer.
 * All three Belonging statements are ready before the step (the product offers a group only when
 * every question is ready), so a summary is due on this turn and must come in addition to the answer.
 */
export const test = {
  id: 'P-10.A1',
  sourceCase: 'P-10',
  requirement: ['CF-004'],
  kind: 'atomic',
  levels: ['L0', 'L1'],
  runProfile: 'isolated',
  setup: [
    {
      name: 'confirmationState',
      params: {
        surveyWindowId: BELONGING_WINDOW,
        questions: BELONGING_IDS.map((id) =>
          confirmationQuestion(id, 'belonging', 'ready', BELONGING_SUMMARIES[id]),
        ),
      },
    },
    disclosureDelivered,
  ],
  seed: seedOf([user(P10_STEPS[0]), coach(P10_COACH[0]), user(P10_STEPS[1]), coach(P10_COACH[1])]),
  scripted: scriptedTurn(),
  preconditions: [],
  steps: [{ text: P10_STEPS[2] }],
  criteria: [
    { id: 'P-10.C1', evaluatedAt: 'reply:1', levels: ['L1'], checks: [MEANING] },
    { id: 'P-10.C2', evaluatedAt: 'reply:1', checks: [rule('answer-then-bundle'), MEANING] },
    { id: 'P-10.C3', evaluatedAt: 'reply:1', levels: ['L1'], checks: [MEANING] },
    { id: 'P-10.E1', evaluatedAt: 'after-step:1', checks: [effect(SEND, 1)] },
    {
      id: 'P-10.E2',
      evaluatedAt: 'state',
      stateQuery: { name: 'stagedBundleCount', at: 'after', kind: 'change' },
      checks: [rule('state-equals', { query: 'stagedBundleCount', at: 'after', expected: 1 })],
    },
    decisionCriterion('P-10.E3', [...SURVEY_ALLOWED, { field: 'risk.severity', in: ['none'] }]),
    contextCriterion('P-10.E4', { sectionsInclude: ['trailingBundle'] }),
  ],
};
