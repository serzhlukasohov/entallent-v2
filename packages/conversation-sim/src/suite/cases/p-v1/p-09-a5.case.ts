import { autonomyState, p09Moment } from './p-09-shared';
import { MEANING, P09_COACH, P09_CORRECTED_STATEMENT, STAGE, VERDICT, disclosureDelivered, effect, rule, scriptedTurn } from './texts';

/**
 * P-09 authored confirmation of the corrected statement: the topic is complete (C4), Autonomy
 * shows 3/3 (C5) and no more summaries were staged than shown (C6). C4, C5 and E8 need the
 * verdict interpreted (L1); the invariant C6 is decided at L0 too.
 */
export const test = {
  id: 'P-09.A5',
  sourceCase: 'P-09',
  requirement: ['CF-008'],
  kind: 'atomic',
  levels: ['L0', 'L1'],
  runProfile: 'isolated',
  setup: [
    autonomyState(
      ['confirmed', 'ready', 'confirmed'],
      { stagedBundle: { questionGroup: 'autonomy', displayedText: P09_COACH.correctedStatement, questionIds: ['q12_opinions_count'] } },
      { q12_opinions_count: P09_CORRECTED_STATEMENT },
    ),
    disclosureDelivered,
  ],
  ...p09Moment(12),
  scripted: scriptedTurn(),
  preconditions: [],
  criteria: [
    { id: 'P-09.C4', evaluatedAt: 'reply:1', levels: ['L1'], checks: [MEANING] },
    {
      id: 'P-09.C5',
      evaluatedAt: 'state',
      levels: ['L1'],
      stateQuery: { name: 'questionProgress', at: 'after', kind: 'change' },
      checks: [rule('state-equals', { query: 'questionProgress', at: 'after', expected: { answered: 3, total: 3 } })],
    },
    {
      id: 'P-09.C6',
      evaluatedAt: 'state',
      stateQuery: { name: 'stagedBundleCount', at: 'after', kind: 'invariant' },
      checks: [
        rule('state-not-greater-than', {
          query: 'stagedBundleCount',
          at: 'after',
          delta: true,
          max: { repliesWithMetadata: 'v2ConfirmationBundle' },
        }),
      ],
    },
    { id: 'P-09.E8', evaluatedAt: 'after-step:1', levels: ['L1'], checks: [effect(VERDICT, 1), effect(STAGE, 0)] },
  ],
};
