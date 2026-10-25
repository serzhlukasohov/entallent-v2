import { createHash } from 'node:crypto';
import { zodSchema } from 'ai';
import { stableJson } from '../baseline';
import type { JudgeFingerprint, LoadedSuite, SuiteConfig } from '../schema';
import { JudgeOutputSchema } from './criterion-judge';
import { JUDGE_PROMPT_SHA256 } from './prompt';

/**
 * The run-time judge fingerprint (architecture AD-8): the pinned provider, model and
 * decoding from `suite.config.json` plus content hashes of the prompt template, the output
 * schema and every `judgeGuidance` text of the suite. No hand-maintained version number.
 */

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** sha256 of the output schema's JSON Schema, as the AI SDK sends it to the model. */
export function judgeSchemaSha256(): string {
  const jsonSchema: unknown = zodSchema(JudgeOutputSchema as never).jsonSchema;
  if (jsonSchema === null || typeof jsonSchema !== 'object' || typeof (jsonSchema as { then?: unknown }).then === 'function') {
    throw new Error('[suite] judge fingerprint: the output JSON schema is not available synchronously');
  }
  return sha256(stableJson(jsonSchema));
}

/** sha256 of `{ "<testId>/<criterionId>": judgeGuidance }` over every criterion with guidance. */
export function judgeGuidanceSha256(suite: Pick<LoadedSuite, 'tests'>): string {
  const guidance: Record<string, string> = {};
  for (const test of suite.tests) {
    for (const criterion of test.criteria) {
      if (criterion.judgeGuidance !== undefined) guidance[`${test.id}/${criterion.id}`] = criterion.judgeGuidance;
    }
  }
  return sha256(stableJson(guidance));
}

export function computeJudgeFingerprint(judge: SuiteConfig['judge'], suite: Pick<LoadedSuite, 'tests'>): JudgeFingerprint {
  return {
    provider: judge.provider,
    model: judge.model,
    decoding: {
      temperature: judge.decoding.temperature,
      reasoningEffort: judge.decoding.reasoningEffort,
      maxOutputTokens: judge.decoding.maxOutputTokens,
    },
    promptSha256: JUDGE_PROMPT_SHA256,
    schemaSha256: judgeSchemaSha256(),
    guidanceSha256: judgeGuidanceSha256(suite),
  };
}
