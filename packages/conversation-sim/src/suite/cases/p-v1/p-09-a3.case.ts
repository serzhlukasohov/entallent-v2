import { autonomyState, p09Moment } from './p-09-shared';
import { P09_COACH, STAGE, VERDICT, disclosureDelivered, effect, rule } from './texts';

/**
 * P-09 step 4: "mostly right, but ..." disputes statement 2 of the shown summary. The product
 * confirms the other two and asks a clarification question. Every criterion needs the verdict
 * interpreted, which the L0 scripted model cannot do (deferred-work.md), so the test is L1 only.
 */
export const test = {
  id: 'P-09.A3',
  sourceCase: 'P-09',
  requirement: ['CF-008'],
  kind: 'atomic',
  levels: ['L1'],
  runProfile: 'isolated',
  setup: [
    autonomyState(['ready', 'ready', 'ready'], {
      stagedBundle: {
        questionGroup: 'autonomy',
        displayedText: P09_COACH.summary,
        questionIds: ['q12_strengths_opportunity', 'q12_opinions_count', 'q12_expectations'],
      },
    }),
    disclosureDelivered,
  ],
  ...p09Moment(8),
  preconditions: [],
  criteria: [
    {
      id: 'P-09.E4',
      evaluatedAt: 'after-step:1',
      checks: [effect({ port: 'aiProvider', method: 'interpretQuestionBundleResponse' }, 1), effect(VERDICT, 1)],
    },
    {
      id: 'P-09.E5',
      evaluatedAt: 'after-step:1',
      checks: [effect({ port: 'questionConfirmationRepo', method: 'stageQuestionClarificationPrompt' }, 1), effect(STAGE, 0)],
    },
    {
      id: 'P-09.E6',
      evaluatedAt: 'state',
      stateQuery: { name: 'questionProgress', at: 'after', kind: 'change' },
      checks: [rule('state-equals', { query: 'questionProgress', at: 'after', expected: { answered: 2, total: 3 } })],
    },
  ],
};
