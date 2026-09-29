export const QUESTION_INSIGHT_STATUSES = [
  'collecting',
  'pending_confirmation',
  'pending_clarification',
  'confirmed',
  'declined',
  'no_data',
  'reset',
] as const;

export type QuestionInsightStatus = (typeof QUESTION_INSIGHT_STATUSES)[number];

export interface QuestionInsightState {
  questionId: string;
  status: QuestionInsightStatus;
}

export interface QuestionTransition extends QuestionInsightState {
  purgeTemporary: boolean;
}

/** The bundle is one employee interaction, but its outcomes are question-grained. */
export function resolveQuestionBundle(
  questions: readonly QuestionInsightState[],
  outcome:
    | { kind: 'agree' }
    | { kind: 'partial'; acceptedQuestionIds: readonly string[]; disputedQuestionIds: readonly string[] }
    | { kind: 'reject' },
): QuestionTransition[] {
  const ids = new Set(questions.map((question) => question.questionId));
  if (ids.size !== questions.length || questions.length === 0 || questions.length > 3
    || questions.some((question) => question.status !== 'pending_confirmation')) {
    throw new Error('question_bundle_invalid_state');
  }

  if (outcome.kind === 'agree') {
    return questions.map((question) => ({ ...question, status: 'confirmed', purgeTemporary: false }));
  }
  if (outcome.kind === 'reject') {
    return questions.map((question) => ({ ...question, status: 'reset', purgeTemporary: true }));
  }

  const accepted = new Set(outcome.acceptedQuestionIds);
  const disputed = new Set(outcome.disputedQuestionIds);
  if (accepted.size !== outcome.acceptedQuestionIds.length
    || disputed.size !== outcome.disputedQuestionIds.length
    || accepted.size === 0 || disputed.size === 0
    || accepted.size + disputed.size !== questions.length
    || [...accepted, ...disputed].some((id) => !ids.has(id))
    || [...accepted].some((id) => disputed.has(id))) {
    throw new Error('question_bundle_partial_mapping_invalid');
  }

  return questions.map((question) => ({
    ...question,
    status: accepted.has(question.questionId) ? 'confirmed' : 'pending_clarification',
    purgeTemporary: false,
  }));
}

export function clarifyQuestion(question: QuestionInsightState): QuestionTransition {
  if (question.status !== 'pending_clarification') throw new Error('question_not_pending_clarification');
  return { ...question, status: 'confirmed', purgeTemporary: false };
}

export function declineQuestion(question: QuestionInsightState): QuestionTransition {
  if (!['collecting', 'pending_confirmation', 'pending_clarification'].includes(question.status)) {
    throw new Error('question_cannot_be_declined');
  }
  return { ...question, status: 'declined', purgeTemporary: true };
}

export function cutOffQuestions(questions: readonly QuestionInsightState[]): QuestionTransition[] {
  return questions
    .filter((question) => ['collecting', 'pending_confirmation', 'pending_clarification', 'reset'].includes(question.status))
    .map((question) => ({ ...question, status: 'no_data', purgeTemporary: true }));
}

export interface ConfirmedQuestionScore {
  questionId: string;
  score: number;
  scoringPolicyVersion: string;
}

/** Eligibility only: the complete Index formula is a separate product decision. */
export function hasCompleteIndexInput(
  requiredQuestionIds: readonly string[],
  confirmedScores: readonly ConfirmedQuestionScore[],
): boolean {
  if (requiredQuestionIds.length !== 3 || new Set(requiredQuestionIds).size !== 3) return false;
  const scores = new Map(confirmedScores.map((value) => [value.questionId, value]));
  if (scores.size !== confirmedScores.length) return false;
  const selected = requiredQuestionIds.map((id) => scores.get(id));
  return selected.every((value) => value !== undefined
    && Number.isFinite(value.score) && value.score >= 0 && value.score <= 100
    && value.scoringPolicyVersion.trim().length > 0)
    && new Set(selected.map((value) => value!.scoringPolicyVersion)).size === 1;
}
