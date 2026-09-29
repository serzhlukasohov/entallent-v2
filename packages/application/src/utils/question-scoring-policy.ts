import type { ApprovedQuestionRubric } from '../use-cases/finalize-question-insight.use-case';

export const V2_QUESTION_GROUP_BY_STABLE_KEY = {
  q12_expectations: 'autonomy',
  q12_strengths_opportunity: 'autonomy',
  q12_opinions_count: 'autonomy',
  wellbeing_at_work: 'belonging',
  q12_supervisor_cares: 'belonging',
  belonging_psychological_safety: 'belonging',
  role_clarity: 'growth',
  professional_growth: 'growth',
  q12_progress_discussion: 'growth',
  q12_recognition: 'purpose',
  purpose_meaning: 'purpose',
  purpose_contribution: 'purpose',
} as const;

export function isApprovedQuestionRubric(value: unknown): value is ApprovedQuestionRubric {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rubric = value as Record<string, unknown>;
  const anchors = rubric['anchors'];
  return typeof rubric['version'] === 'string' && rubric['version'].trim().length > 0
    && typeof rubric['instructions'] === 'string' && rubric['instructions'].trim().length > 0
    && Array.isArray(anchors) && anchors.length >= 2
    && anchors.every((anchor: unknown) => !!anchor && typeof anchor === 'object'
      && typeof (anchor as Record<string, unknown>)['score'] === 'number'
      && Number.isFinite((anchor as Record<string, number>)['score'])
      && (anchor as Record<string, number>)['score'] >= 0
      && (anchor as Record<string, number>)['score'] <= 100
      && typeof (anchor as Record<string, unknown>)['description'] === 'string'
      && ((anchor as Record<string, string>)['description'] ?? '').trim().length > 0)
    && new Set(anchors.map((anchor: { score: number }) => anchor.score)).size === anchors.length;
}

export function hasCompleteV2ScoringPolicy(
  questions: readonly { stableKey: string; responseType: string; questionGroup: string }[],
  rubrics: unknown,
): boolean {
  if (!rubrics || typeof rubrics !== 'object' || Array.isArray(rubrics)) return false;
  const questionRubrics = rubrics as Record<string, unknown>;
  const openEnded = questions.filter((question) => question.responseType === 'open_ended');
  const expected = V2_QUESTION_GROUP_BY_STABLE_KEY as Record<string, string>;
  if (openEnded.length !== Object.keys(expected).length
    || new Set(openEnded.map((question) => question.stableKey)).size !== openEnded.length) {
    return false;
  }
  return openEnded.every((question) => expected[question.stableKey] === question.questionGroup
    && isApprovedQuestionRubric(questionRubrics[question.stableKey]));
}
