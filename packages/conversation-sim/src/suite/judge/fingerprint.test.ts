import { zodSchema } from 'ai';
import { describe, expect, it } from 'vitest';
import { RUNNER_CONFIG } from '../__fixtures__/runner';
import { stableJson } from '../baseline';
import { JudgeFingerprintSchema, type LoadedSuite } from '../schema';
import { calibrationSuite } from './__fixtures__/calibration';
import { JudgeOutputSchema } from './criterion-judge';
import { computeJudgeFingerprint, judgeGuidanceSha256, judgeSchemaSha256, sha256 } from './fingerprint';
import { JUDGE_PROMPT_SHA256 } from './prompt';

const JUDGE = RUNNER_CONFIG.judge;

function withGuidance(suite: LoadedSuite, criterionId: string, judgeGuidance: string | undefined): LoadedSuite {
  return {
    ...suite,
    tests: suite.tests.map((test) => ({
      ...test,
      criteria: test.criteria.map((criterion) => {
        if (criterion.id !== criterionId) return criterion;
        const rest = { ...criterion };
        delete rest.judgeGuidance;
        return judgeGuidance === undefined ? rest : { ...rest, judgeGuidance };
      }),
    })),
  };
}

describe('computeJudgeFingerprint', () => {
  const suite = calibrationSuite();

  it('carries the pinned config and the three run-time hashes', () => {
    const fingerprint = computeJudgeFingerprint(JUDGE, suite);
    expect(JudgeFingerprintSchema.parse(fingerprint)).toEqual(fingerprint);
    expect(fingerprint).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
      decoding: { temperature: 0, reasoningEffort: null, maxOutputTokens: 1024 },
      promptSha256: JUDGE_PROMPT_SHA256,
      schemaSha256: sha256(stableJson(zodSchema(JudgeOutputSchema as never).jsonSchema)),
      guidanceSha256: sha256(stableJson({ 'Y-01.A1/Y-01.C2': 'Deadlines count as priorities.' })),
    });
  });

  it('is stable across calls and suite copies', () => {
    expect(computeJudgeFingerprint(JUDGE, calibrationSuite())).toEqual(computeJudgeFingerprint(JUDGE, suite));
    expect(judgeSchemaSha256()).toBe(judgeSchemaSha256());
  });

  it('hashes an empty guidance object when no criterion has guidance', () => {
    const none = withGuidance(suite, 'Y-01.C2', undefined);
    expect(judgeGuidanceSha256(none)).toBe(sha256('{}'));
    expect(judgeGuidanceSha256({ tests: [] })).toBe(sha256('{}'));
  });

  it('changes with any guidance text, test key or config field', () => {
    const base = computeJudgeFingerprint(JUDGE, suite);
    expect(computeJudgeFingerprint(JUDGE, withGuidance(suite, 'Y-01.C2', 'Deadlines count.')).guidanceSha256).not.toBe(base.guidanceSha256);
    expect(computeJudgeFingerprint(JUDGE, withGuidance(suite, 'Y-01.C1', 'New guidance.')).guidanceSha256).not.toBe(base.guidanceSha256);
    expect(computeJudgeFingerprint({ ...JUDGE, model: 'gpt-4.1' }, suite).model).toBe('gpt-4.1');
    expect(computeJudgeFingerprint({ ...JUDGE, provider: 'azure_openai' }, suite).provider).toBe('azure_openai');
    expect(computeJudgeFingerprint({ ...JUDGE, decoding: { ...JUDGE.decoding, temperature: 0.2 } }, suite).decoding.temperature).toBe(0.2);
    // Thresholds are trust inputs, not fingerprint fields.
    expect(computeJudgeFingerprint({ ...JUDGE, minLabels: 3 }, suite)).toEqual(base);
  });

  it('is sensitive to the output schema', () => {
    const other = sha256(stableJson(zodSchema(JudgeOutputSchema.extend({ extra: JudgeOutputSchema.shape.reason }) as never).jsonSchema));
    expect(other).not.toBe(judgeSchemaSha256());
  });
});
