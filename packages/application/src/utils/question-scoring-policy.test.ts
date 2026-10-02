import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasCompleteV2ScoringPolicy, hasLegacyV2ScoringPolicy,
  LEGACY_V2_QUESTION_GROUP_BY_STABLE_KEY } from './question-scoring-policy';

const approved = JSON.parse(readFileSync(resolve('../../scripts/data/v2-scoring-policy-1.0.0.json'), 'utf8')) as Record<string, { title: string; canonicalMeaning: string; questionGroup: string; version: string;
    anchors: Array<{ score: number; description: string }> }>;
const questions = Object.entries(approved).map(([stableKey, rubric]) => ({
  stableKey, title: rubric.title, canonicalMeaning: rubric.canonicalMeaning,
  questionGroup: rubric.questionGroup, version: rubric.version, responseType: 'open_ended',
}));

describe('approved V2 policy boundary', () => {
  it('accepts only the twelve exact approved meanings and sixty anchors', () => {
    expect(questions).toHaveLength(12);
    expect(Object.values(approved).flatMap((rubric) => rubric.anchors)).toHaveLength(60);
    expect(hasCompleteV2ScoringPolicy(questions, approved)).toBe(true);
    expect(hasCompleteV2ScoringPolicy(questions.map((q) => q.stableKey === 'autonomy_control_work'
      ? { ...q, canonicalMeaning: 'Old strengths use meaning' } : q), approved)).toBe(false);
    expect(hasCompleteV2ScoringPolicy(questions, { ...approved,
      growth_skill_development: { ...approved.growth_skill_development,
        anchors: approved.growth_skill_development!.anchors.map((anchor, i) => i === 1
          ? { ...anchor, description: 'Altered' } : anchor) },
    })).toBe(false);
  });
});

it('keeps a legacy twelve-topic policy valid with three numeric Engagement questions', () => {
  const legacy = Object.entries(LEGACY_V2_QUESTION_GROUP_BY_STABLE_KEY).map(([stableKey, questionGroup]) => ({
    stableKey, questionGroup, responseType: 'open_ended',
  }));
  const numeric = ['engagement_nps', 'engagement_motivation', 'engagement_current'].map((stableKey) => ({
    stableKey, questionGroup: 'engagement', responseType: 'numeric_0_10',
  }));
  const rubric = { version: 'legacy', instructions: 'Assess meaning.', anchors: [
    { score: 0, description: 'Low' }, { score: 100, description: 'High' },
  ] };
  const rubrics = Object.fromEntries(legacy.map((question) => [question.stableKey, rubric]));
  expect(hasLegacyV2ScoringPolicy([...legacy, ...numeric], rubrics)).toBe(true);
  expect(hasLegacyV2ScoringPolicy([...legacy, ...numeric.slice(0, 2)], rubrics)).toBe(false);
  expect(hasLegacyV2ScoringPolicy([...legacy, ...numeric.slice(0, 2),
    { stableKey: 'unapproved_numeric', questionGroup: 'engagement', responseType: 'numeric_0_10' }], rubrics)).toBe(false);
  expect(hasCompleteV2ScoringPolicy([...legacy, ...numeric], rubrics)).toBe(false);
});
