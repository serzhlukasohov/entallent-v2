import { autonomyState, p09Moment } from './p-09-shared';
import { CLARIFY, MEANING, P09_DISPUTED_STATEMENT, disclosureDelivered, effect } from './texts';

const STAGE_CORRECTED = { port: 'questionConfirmationRepo', method: 'stageCorrectedStatementConfirmation' } as const;

/**
 * P-09 authored clarification: statements 1 and 3 are confirmed and statement 2 waits for the
 * employee's clarification. The product shows the corrected statement (C3). Interpreting the
 * clarification needs a model, so the test is L1 only (deferred-work.md).
 */
export const test = {
  id: 'P-09.A4',
  sourceCase: 'P-09',
  requirement: ['CF-008'],
  kind: 'atomic',
  levels: ['L1'],
  runProfile: 'isolated',
  setup: [
    autonomyState(['confirmed', 'disputed', 'confirmed'], {
      pendingClarification: { surveyQuestionId: 'q12_opinions_count', disputedStatement: P09_DISPUTED_STATEMENT },
    }),
    disclosureDelivered,
  ],
  ...p09Moment(10),
  preconditions: [],
  criteria: [
    { id: 'P-09.C3', evaluatedAt: 'reply:1', checks: [effect(STAGE_CORRECTED, 1), MEANING] },
    { id: 'P-09.E7', evaluatedAt: 'after-step:1', checks: [effect(CLARIFY, 1), effect(STAGE_CORRECTED, 1)] },
  ],
};
