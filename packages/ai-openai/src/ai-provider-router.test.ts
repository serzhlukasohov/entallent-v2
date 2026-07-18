import { describe, it, expect, vi } from 'vitest';
import { AiProviderWithFallback } from './ai-provider-router';
import type { AiProviderPort, ConversationTurn, ClassifyContext } from '@entalent/application';
import type { SituationClassification } from '@entalent/contracts';

const TURNS: ConversationTurn[] = [{ role: 'user', content: 'Hello', timestamp: new Date() }];
const CTX: ClassifyContext = { userName: 'Alice' };

const CLASSIFICATION: SituationClassification = {
  primaryIntent: 'casual_conversation',
  secondaryIntents: [],
  emotionalState: [],
  urgency: 'low',
  confidence: 0.9,
  requiresSafetyCheck: false,
  surveyAllowed: true,
  reasoningSummary: 'Normal conversation.',
};

function makeProvider(result: SituationClassification | Error): AiProviderPort {
  const classify = result instanceof Error
    ? vi.fn().mockRejectedValue(result)
    : vi.fn().mockResolvedValue(result);

  return {
    classifySituation: classify,
    detectRisk: vi.fn(),
    extractMemory: vi.fn(),
    evaluateSurveyEvidence: vi.fn(),
    generateResponse: vi.fn(),
  } as unknown as AiProviderPort;
}

describe('AiProviderWithFallback', () => {
  it('returns primary result when primary succeeds', async () => {
    const primary = makeProvider(CLASSIFICATION);
    const fallback = makeProvider(new Error('should not be called'));
    const router = new AiProviderWithFallback(primary, fallback);

    const result = await router.classifySituation(TURNS, CTX);
    expect(result).toEqual(CLASSIFICATION);
    expect(primary.classifySituation).toHaveBeenCalledOnce();
    expect(fallback.classifySituation).not.toHaveBeenCalled();
  });

  it('calls fallback when primary throws', async () => {
    const primary = makeProvider(new Error('OpenAI rate limit'));
    const fallback = makeProvider(CLASSIFICATION);
    const router = new AiProviderWithFallback(primary, fallback);

    const result = await router.classifySituation(TURNS, CTX);
    expect(result).toEqual(CLASSIFICATION);
    expect(primary.classifySituation).toHaveBeenCalledOnce();
    expect(fallback.classifySituation).toHaveBeenCalledOnce();
  });

  it('throws when all providers fail', async () => {
    const error1 = new Error('Primary failed');
    const error2 = new Error('Fallback also failed');
    const router = new AiProviderWithFallback(makeProvider(error1), makeProvider(error2));

    await expect(router.classifySituation(TURNS, CTX)).rejects.toThrow('Fallback also failed');
  });

  it('tries providers in order and stops at first success', async () => {
    const error = new Error('fail');
    const p1 = makeProvider(error);
    const p2 = makeProvider(error);
    const p3 = makeProvider(CLASSIFICATION);
    const router = new AiProviderWithFallback(p1, p2, p3);

    const result = await router.classifySituation(TURNS, CTX);
    expect(result).toEqual(CLASSIFICATION);
    expect(p1.classifySituation).toHaveBeenCalledOnce();
    expect(p2.classifySituation).toHaveBeenCalledOnce();
    expect(p3.classifySituation).toHaveBeenCalledOnce();
  });
});
