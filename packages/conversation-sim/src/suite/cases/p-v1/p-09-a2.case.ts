import { SURVEY_ALLOWED, contextCriterion, decisionCriterion } from './decision-context';
import { autonomyState, p09Moment } from './p-09-shared';
import { MEANING, STAGE, disclosureDelivered, effect, rule, scriptedTurn } from './texts';

/** P-09 authored summary turn: all three Autonomy statements are ready, so the summary is shown (C1, C2). */
export const test = {
  id: 'P-09.A2',
  sourceCase: 'P-09',
  requirement: ['CF-008'],
  kind: 'atomic',
  levels: ['L0', 'L1'],
  runProfile: 'isolated',
  setup: [autonomyState(['ready', 'ready', 'ready']), disclosureDelivered],
  ...p09Moment(6),
  scripted: scriptedTurn(),
  preconditions: [],
  criteria: [
    { id: 'P-09.C1', evaluatedAt: 'reply:1', checks: [rule('bundle-staged'), MEANING] },
    { id: 'P-09.C2', evaluatedAt: 'reply:1', levels: ['L1'], checks: [MEANING] },
    {
      id: 'P-09.E2',
      evaluatedAt: 'after-step:1',
      checks: [effect({ port: 'aiProvider', method: 'composeQuestionBundle' }, 1), effect(STAGE, 1)],
    },
    {
      id: 'P-09.E3',
      evaluatedAt: 'state',
      stateQuery: { name: 'questionProgress', at: 'after', kind: 'invariant' },
      checks: [rule('state-equals', { query: 'questionProgress', at: 'after', expected: { answered: 0, total: 3 } })],
    },
    decisionCriterion('P-09.E10', SURVEY_ALLOWED),
    contextCriterion('P-09.E12', { sectionsInclude: ['trailingBundle'] }),
  ],
};
