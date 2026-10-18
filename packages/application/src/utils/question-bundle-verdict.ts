import type { QuestionBundleVerdict } from '../ports/question-confirmation.port';

/** Reject model-supplied question ids or incomplete classifications before state changes. */
export function validateQuestionBundleVerdict(
  value: unknown,
  questionIds: readonly string[],
): QuestionBundleVerdict {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || questionIds.length < 1 || questionIds.length > 3
    || new Set(questionIds).size !== questionIds.length) {
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
  if (allIds.length !== questionIds.length || new Set(allIds).size !== questionIds.length
    || allIds.some((id) => !questionIds.includes(id))) {
    throw new Error('v2_confirmation_verdict_invalid');
  }
  return { kind: 'partial', acceptedQuestionIds, disputedQuestionIds, declinedQuestionIds };
}

/** At most two clarification questions per question and cycle (GC round 3 S4b, PO decision 2026-10-17). */
export const MAX_QUESTION_CLARIFICATIONS = 2;

/**
 * GC round 3 S4b: a corrected statement is never wiped. A reject or a dispute on it asks one more
 * clarification while the budget lasts; once it is spent the question closes for this cycle as
 * declined. Agreement and an explicit skip keep their meaning.
 */
export function resolveCorrectedStatementVerdict(
  verdict: Exclude<QuestionBundleVerdict, { kind: 'unrelated' }>,
  questionId: string,
  clarificationAttempts: number,
): Exclude<QuestionBundleVerdict, { kind: 'unrelated' }> {
  if (verdict.kind === 'agree') return verdict;
  const disputed = verdict.kind === 'reject' || verdict.disputedQuestionIds.includes(questionId);
  if (verdict.kind === 'partial' && !disputed) return verdict;
  return clarificationAttempts < MAX_QUESTION_CLARIFICATIONS
    ? { kind: 'partial', acceptedQuestionIds: [], disputedQuestionIds: [questionId], declinedQuestionIds: [] }
    : { kind: 'partial', acceptedQuestionIds: [], disputedQuestionIds: [], declinedQuestionIds: [questionId] };
}
