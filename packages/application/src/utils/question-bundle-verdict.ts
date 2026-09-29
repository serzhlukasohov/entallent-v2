import type { QuestionBundleVerdict } from '../ports/question-confirmation.port';

/** Reject model-supplied question ids or incomplete classifications before state changes. */
export function validateQuestionBundleVerdict(
  value: unknown,
  questionIds: readonly string[],
): QuestionBundleVerdict {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || questionIds.length !== 3 || new Set(questionIds).size !== 3) {
    throw new Error('v2_confirmation_verdict_invalid');
  }
  const draft = value as Record<string, unknown>;
  if (draft['kind'] === 'agree' || draft['kind'] === 'reject' || draft['kind'] === 'unrelated') {
    if (Object.keys(draft).length !== 1) throw new Error('v2_confirmation_verdict_invalid');
    return { kind: draft['kind'] };
  }
  if (draft['kind'] !== 'partial') throw new Error('v2_confirmation_verdict_invalid');
  if (Object.keys(draft).length !== 4
    || !['kind', 'acceptedQuestionIds', 'disputedQuestionIds', 'declinedQuestionIds']
      .every((key) => Object.hasOwn(draft, key))) {
    throw new Error('v2_confirmation_verdict_invalid');
  }
  const acceptedQuestionIds = draft['acceptedQuestionIds'];
  const disputedQuestionIds = draft['disputedQuestionIds'];
  const declinedQuestionIds = draft['declinedQuestionIds'];
  if (!Array.isArray(acceptedQuestionIds) || !Array.isArray(disputedQuestionIds)
    || !Array.isArray(declinedQuestionIds)
    || ![...acceptedQuestionIds, ...disputedQuestionIds, ...declinedQuestionIds]
      .every((id) => typeof id === 'string')) {
    throw new Error('v2_confirmation_verdict_invalid');
  }
  const allIds = [...acceptedQuestionIds, ...disputedQuestionIds, ...declinedQuestionIds] as string[];
  if (allIds.length !== 3 || new Set(allIds).size !== 3
    || allIds.some((id) => !questionIds.includes(id))) {
    throw new Error('v2_confirmation_verdict_invalid');
  }
  return { kind: 'partial', acceptedQuestionIds, disputedQuestionIds, declinedQuestionIds };
}
