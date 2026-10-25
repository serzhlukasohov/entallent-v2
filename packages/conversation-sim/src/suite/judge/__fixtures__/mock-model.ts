import { MockLanguageModelV3 } from 'ai/test';

/** Offline judge models for tests (no network, no credentials). */

export const MOCK_USAGE = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

export type MockStep = string | Error | { text: string; usage?: typeof MOCK_USAGE | 'missing' };

/** A model that answers each `doGenerate` call with the next step (the last repeats). */
export function mockJudgeModel(steps: readonly MockStep[]): MockLanguageModelV3 {
  let call = 0;
  return new MockLanguageModelV3({
    provider: 'mock',
    modelId: 'mock-judge',
    doGenerate: async () => {
      const step = steps[Math.min(call, steps.length - 1)]!;
      call += 1;
      if (step instanceof Error) throw step;
      const text = typeof step === 'string' ? step : step.text;
      const usage =
        typeof step === 'string' || step.usage === undefined
          ? MOCK_USAGE
          : step.usage === 'missing'
            ? {
                inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: undefined, text: undefined, reasoning: undefined },
              }
            : step.usage;
      return { content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] };
    },
  });
}

export function verdict(status: 'PASS' | 'FAIL' | null, reason: string | null, evidence: string | null): string {
  return JSON.stringify({ status, reason, evidence });
}

/** Text of the single user message the judge received on call `index`. */
export function promptOf(model: MockLanguageModelV3, index = 0): string {
  const prompt = model.doGenerateCalls[index]!.prompt;
  return prompt
    .flatMap((message) =>
      Array.isArray(message.content)
        ? message.content.map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
        : [String(message.content)],
    )
    .join('\n');
}
