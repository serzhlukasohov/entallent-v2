import { createHash } from 'node:crypto';
import type { ApprovedQuestionRubric } from '../use-cases/finalize-question-insight.use-case';

const APPROVED_POLICY_SHA256 = '99031ed36c6499784325f95e729bda466a71c3f76a81d8271c1de52457f1827f';

export const V2_QUESTION_GROUP_BY_STABLE_KEY = {
  autonomy_control_work: 'autonomy',
  autonomy_voice_influence: 'autonomy',
  autonomy_expectation_clarity: 'autonomy',
  growth_skill_development: 'growth',
  growth_useful_feedback: 'growth',
  growth_future_opportunities: 'growth',
  purpose_personal_meaning: 'purpose',
  purpose_contribution_visibility: 'purpose',
  purpose_recognition: 'purpose',
  belonging_team: 'belonging',
  belonging_psychological_safety: 'belonging',
  belonging_manager_support: 'belonging',
} as const;

// Historical V2 cycles remain readable with their original policy binding.
export const LEGACY_V2_QUESTION_GROUP_BY_STABLE_KEY = {
  q12_expectations: 'autonomy', q12_strengths_opportunity: 'autonomy', q12_opinions_count: 'autonomy',
  wellbeing_at_work: 'belonging', q12_supervisor_cares: 'belonging',
  belonging_psychological_safety: 'belonging',
  role_clarity: 'growth', professional_growth: 'growth', q12_progress_discussion: 'growth',
  q12_recognition: 'purpose', purpose_meaning: 'purpose', purpose_contribution: 'purpose',
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

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export function hasCompleteV2ScoringPolicy(
  questions: readonly { stableKey: string; responseType: string; questionGroup: string;
    title?: string; canonicalMeaning?: string; version?: string }[],
  rubrics: unknown,
): boolean {
  if (!rubrics || typeof rubrics !== 'object' || Array.isArray(rubrics)) return false;
  const questionRubrics = rubrics as Record<string, unknown>;
  const expected = V2_QUESTION_GROUP_BY_STABLE_KEY as Record<string, string>;
  const openEnded = questions.filter((question) => question.responseType === 'open_ended');
  if (openEnded.length !== 12 || questions.length !== 12
    || Object.keys(questionRubrics).length !== 12
    || new Set(openEnded.map((question) => question.stableKey)).size !== 12) return false;
  if (!openEnded.every((question) => {
    const rubric = questionRubrics[question.stableKey] as Record<string, unknown> | undefined;
    return expected[question.stableKey] === question.questionGroup
      && isApprovedQuestionRubric(rubric)
      && rubric['version'] === '1.0.0'
      && (rubric['anchors'] as ReadonlyArray<{ score: number }>).map((anchor) => anchor.score).join(',') === '0,25,50,75,100'
      && question.title === rubric['title']
      && question.canonicalMeaning === rubric['canonicalMeaning']
      && question.version === rubric['version'];
  })) return false;
  const digest = createHash('sha256').update(JSON.stringify(canonical(rubrics))).digest('hex');
  return digest === APPROVED_POLICY_SHA256;
}

export function hasLegacyV2ScoringPolicy(
  questions: readonly { stableKey: string; responseType: string; questionGroup: string }[],
  rubrics: unknown,
): boolean {
  if (!rubrics || typeof rubrics !== 'object' || Array.isArray(rubrics)) return false;
  const entries = rubrics as Record<string, unknown>;
  const expected = LEGACY_V2_QUESTION_GROUP_BY_STABLE_KEY as Record<string, string>;
  const openEnded = questions.filter((question) => question.responseType === 'open_ended');
  const numeric = questions.filter((question) => question.responseType === 'numeric_0_10');
  return (questions.length === 12 || questions.length === 15) && openEnded.length === 12
    && (numeric.length === 0 || numeric.length === 3 && new Set(numeric.map((question) => question.stableKey)).size === 3
      && ['engagement_nps', 'engagement_motivation', 'engagement_current'].every((key) => numeric.some(
        (question) => question.stableKey === key && question.questionGroup === 'engagement')))
    && Object.keys(entries).length === 12
    && new Set(openEnded.map((question) => question.stableKey)).size === 12
    && openEnded.every((question) => expected[question.stableKey] === question.questionGroup
      && isApprovedQuestionRubric(entries[question.stableKey]));
}
