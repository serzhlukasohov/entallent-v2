import { SURVEY_ALLOWED, contextCriterion, decisionCriterion } from './decision-context';
import { P07_EVERY_REPLY, P07_SETUP } from './p-07-shared';
import { MEANING, P07_COACH, P07_STEPS, coach, effect, rule, seedOf, user } from './texts';

/** P-07 reply 3: the user explicitly invites a question. */
export const test = {
  id: 'P-07.A3',
  sourceCase: 'P-07',
  requirement: ['CF-002', 'CF-006'],
  kind: 'atomic',
  levels: ['L1'],
  runProfile: 'isolated',
  setup: P07_SETUP,
  seed: seedOf([user(P07_STEPS[0]), coach(P07_COACH[0]), user(P07_STEPS[1]), coach(P07_COACH[1])]),
  preconditions: [],
  steps: [{ text: P07_STEPS[2] }],
  criteria: [
    { id: 'P-07.C2', evaluatedAt: 'reply:1', checks: [rule('single-question'), MEANING] },
    { id: 'P-07.C3', evaluatedAt: 'reply:1', checks: [MEANING] },
    ...P07_EVERY_REPLY,
    {
      id: 'P-07.E2',
      evaluatedAt: 'after-step:1',
      checks: [effect({ port: 'pulseBacklogService', method: 'getNextProbeQuestion' }, 1)],
    },
    decisionCriterion('P-07.E3', [...SURVEY_ALLOWED, { field: 'reply.surveyQuestion', in: [true] }]),
    contextCriterion('P-07.E4', { surveyQuestion: true }),
  ],
};
