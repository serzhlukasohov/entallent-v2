import {
  generateText,
  JSONParseError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  TypeValidationError,
  type FlexibleSchema,
  type LanguageModel,
  type LanguageModelUsage,
} from 'ai';
import { z } from 'zod';
import type { JudgeUsage, Layer, SuiteConfig } from '../schema';
import { renderJudgePrompt } from './prompt';

/**
 * Per-criterion structured judge (architecture AD-7). One `generateText` call with
 * `Output.object` on an injected model decides one meaning check on one evaluated reply.
 * Transport failures are retried once here; output errors are not retried. The evidence
 * substring check and its single re-ask live in `evaluate`, which knows the reply texts.
 */

/** Nullable, never optional: AI SDK 6 sends OpenAI a strict JSON schema. */
export const JudgeOutputSchema = z
  .object({
    status: z.enum(['PASS', 'FAIL']).nullable(),
    reason: z.string().nullable(),
    evidence: z.string().nullable(),
  })
  .strict();
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

export interface JudgeTurn {
  role: 'user' | 'coach';
  text: string;
}

/** Label-compatible with 13.2 calibration records (AD-8). */
export interface JudgeTranscript {
  turns: JudgeTurn[];
  /** Index into `turns` of the evaluated coach reply; `null` for `conversation` criteria. */
  evaluatedReplyIndex: number | null;
}

export interface JudgeInput {
  transcript: JudgeTranscript;
  expectedBehavior: string;
  /** Suite text, verbatim. */
  passCondition: string;
  judgeGuidance: string | null;
  layer: Layer;
  /** Reference material only; never evidence of what the coach said. */
  fixtureContext: unknown | null;
}

export type { JudgeUsage };

export type JudgeErrorReason = 'judge-transport' | 'judge-invalid-output';

export type MeaningOutcome =
  | { status: 'PASS' | 'FAIL'; reason: string; evidence: string | null; usage: JudgeUsage }
  | { status: 'ERROR'; reason: JudgeErrorReason; message: string; usage: JudgeUsage };

export interface CriterionJudgeOptions {
  /** The single re-ask after a PASS without a matching evidence fragment. */
  reask?: boolean;
}

/** The value `evaluate` takes in place of `null`. */
export type CriterionJudge = (input: JudgeInput, options?: CriterionJudgeOptions) => Promise<MeaningOutcome>;

/**
 * A model object only: a plain string would be resolved by `ai` through its global provider
 * (a network route outside the import-graph guard).
 */
export type JudgeModel = Exclude<LanguageModel, string>;

export interface CriterionJudgeDeps {
  model: JudgeModel;
  decoding: SuiteConfig['judge']['decoding'];
}

// Built once; inlining it in the `generateText` call overflows TypeScript's instantiation depth.
const JUDGE_OUTPUT = Output.object<JudgeOutput>({ schema: JudgeOutputSchema as unknown as FlexibleSchema<JudgeOutput> });

/** Attempts per call: the first plus one transport retry (AD-7). */
const TRANSPORT_ATTEMPTS = 2;

export function emptyJudgeUsage(): JudgeUsage {
  return { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

export function addJudgeUsage(a: JudgeUsage, b: JudgeUsage): JudgeUsage {
  return {
    calls: a.calls + b.calls,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

function tokens(usage: JudgeUsage, sdk: LanguageModelUsage | undefined): JudgeUsage {
  const input = sdk?.inputTokens ?? 0;
  const output = sdk?.outputTokens ?? 0;
  return {
    calls: usage.calls,
    inputTokens: usage.inputTokens + input,
    outputTokens: usage.outputTokens + output,
    totalTokens: usage.totalTokens + (sdk?.totalTokens ?? input + output),
  };
}

function isOutputError(error: unknown): boolean {
  return (
    NoObjectGeneratedError.isInstance(error) ||
    NoOutputGeneratedError.isInstance(error) ||
    TypeValidationError.isInstance(error) ||
    JSONParseError.isInstance(error)
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export async function judgeCriterion(
  input: JudgeInput,
  deps: CriterionJudgeDeps,
  options: CriterionJudgeOptions = {},
): Promise<MeaningOutcome> {
  const prompt = renderJudgePrompt(input, { reask: options.reask === true });
  const { temperature, maxOutputTokens, reasoningEffort } = deps.decoding;
  let usage = emptyJudgeUsage();
  let lastError: unknown;
  for (let attempt = 1; attempt <= TRANSPORT_ATTEMPTS; attempt += 1) {
    usage = { ...usage, calls: usage.calls + 1 };
    try {
      const result = await generateText({
        model: deps.model,
        output: JUDGE_OUTPUT,
        prompt,
        temperature,
        maxOutputTokens,
        maxRetries: 0,
        ...(reasoningEffort !== null
          ? { providerOptions: { openai: { reasoningEffort }, azure: { reasoningEffort } } }
          : {}),
      });
      usage = tokens(usage, result.totalUsage);
      const output: JudgeOutput = result.output;
      if (output.status === null || output.reason === null || output.reason.trim() === '') {
        const field = output.status === null ? 'null status' : output.reason === null ? 'null reason' : 'blank reason';
        return { status: 'ERROR', reason: 'judge-invalid-output', message: `judge returned ${field}`, usage };
      }
      return { status: output.status, reason: output.reason, evidence: output.evidence, usage };
    } catch (error) {
      if (isOutputError(error)) {
        const sdkUsage = NoObjectGeneratedError.isInstance(error) ? error.usage : undefined;
        return { status: 'ERROR', reason: 'judge-invalid-output', message: describe(error), usage: tokens(usage, sdkUsage) };
      }
      lastError = error;
    }
  }
  return { status: 'ERROR', reason: 'judge-transport', message: describe(lastError), usage };
}

export function createCriterionJudge(deps: CriterionJudgeDeps): CriterionJudge {
  return (input, options) => judgeCriterion(input, deps, options);
}

/** Collapses whitespace runs to one space and trims both ends (AD-7 evidence matching). */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** True when `evidence` is a non-empty verbatim fragment of one of `replyTexts` after normalization. */
export function evidenceMatches(evidence: string | null, replyTexts: readonly string[]): boolean {
  if (evidence === null) return false;
  const fragment = normalizeWhitespace(evidence);
  if (fragment === '') return false;
  return replyTexts.some((text) => normalizeWhitespace(text).includes(fragment));
}
