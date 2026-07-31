import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the OpenAI SDK so we control the completion response.
const createMock = vi.fn();
vi.mock('openai', () => {
  class FakeClient {
    chat = { completions: { create: createMock } };
    constructor(_cfg: unknown) {}
  }
  return { default: FakeClient, AzureOpenAI: FakeClient };
});

import { OpenAiProvider } from './openai-provider';

function makeProvider() {
  return new OpenAiProvider({ azure: false, apiKey: 'test', model: 'gpt-test' });
}

const turns = [{ role: 'user' as const, content: 'hi', timestamp: new Date() }];
const questions = [
  {
    id: 'q1',
    stableKey: 'clear_expectations',
    canonicalMeaning: 'Does the employee know what is expected?',
    positiveIndicators: [],
    negativeIndicators: [],
    contraindications: [],
  },
];

describe('OpenAiProvider.interpretConfirmationResponse', () => {
  beforeEach(() => createMock.mockReset());

  it('parses an agree verdict', async () => {
    createMock.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '{"verdict":"agree"}' } }],
    });
    const provider = makeProvider();
    const r = await provider.interpretConfirmationResponse(
      [{ role: 'user', content: 'да, всё так', timestamp: new Date() }],
      'You value autonomy...',
    );
    expect(r.verdict).toBe('agree');
  });

  it('parses a correct verdict with a note', async () => {
    createMock.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '{"verdict":"correct","correctionNote":"не про деньги"}' } }],
    });
    const provider = makeProvider();
    const r = await provider.interpretConfirmationResponse(
      [{ role: 'user', content: 'не совсем', timestamp: new Date() }],
      'summary',
    );
    expect(r.verdict).toBe('correct');
    expect(r.correctionNote).toBe('не про деньги');
  });
});

describe('OpenAiProvider.complete truncation handling', () => {
  beforeEach(() => createMock.mockReset());

  it('throws a descriptive error when the response is truncated (finish_reason=length)', async () => {
    // Simulate a truncated survey-evidence response: valid-looking prefix, cut off.
    createMock.mockResolvedValue({
      choices: [
        {
          finish_reason: 'length',
          message: { content: '{"candidateQuestionIds":["q1"],"evidence":[{"questionId":"q1","evidenceSum' },
        },
      ],
    });

    const provider = makeProvider();
    await expect(provider.evaluateSurveyEvidence(turns, questions)).rejects.toThrow(/truncated.*finish_reason=length/);
  });

  it('requests a large token budget for survey evidence so rich transcripts are not truncated', async () => {
    createMock.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '{"candidateQuestionIds":[],"evidence":[]}' } }],
    });

    const provider = makeProvider();
    await provider.evaluateSurveyEvidence(turns, questions);

    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0][0];
    expect(arg.max_completion_tokens).toBeGreaterThanOrEqual(4096);
  });

  it('parses a complete (non-truncated) response normally', async () => {
    createMock.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '{"candidateQuestionIds":[],"evidence":[]}' } }],
    });

    const provider = makeProvider();
    const result = await provider.evaluateSurveyEvidence(turns, questions);
    expect(result.evidence).toEqual([]);
  });
});
