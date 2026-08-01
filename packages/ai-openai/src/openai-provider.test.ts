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
import { ReplyStrategy } from '@entalent/contracts';

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

describe('OpenAiProvider.generateResponse opener gate', () => {
  beforeEach(() => createMock.mockReset());
  const strat = { mode: 'normal', tone: 'warm', includeFollowUpQuestion: true, maxResponseLength: 'medium', forbiddenPatterns: [] } as ReplyStrategy;

  it('regenerates once when the first draft opens with a reflective label', async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"Вот это, похоже, и есть корень: шум.","confidence":0.9,"containsSurveyProbe":false}' } }] })
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"А что мешает отсечь это первым?","confidence":0.9,"containsSurveyProbe":false}' } }] });
    const provider = makeProvider();
    const res = await provider.generateResponse([{ role: 'user', content: 'суета', timestamp: new Date() }], strat, { userName: 'X' });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(res.text).toBe('А что мешает отсечь это первым?');
  });

  it('does not regenerate when the first draft is clean', async () => {
    createMock.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"А что мешает отсечь это первым?","confidence":0.9,"containsSurveyProbe":false}' } }] });
    const provider = makeProvider();
    await provider.generateResponse([{ role: 'user', content: 'суета', timestamp: new Date() }], strat, { userName: 'X' });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('does not run the opener gate for confirmation replies (confirmationRequest set)', async () => {
    createMock.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"Похоже, для тебя важнее автономия — я правильно понял?","confidence":0.9,"containsSurveyProbe":false}' } }] });
    const provider = makeProvider();
    const res = await provider.generateResponse(
      [{ role: 'user', content: 'да', timestamp: new Date() }],
      { mode: 'confirmation', tone: 'warm', includeFollowUpQuestion: false, maxResponseLength: 'medium', forbiddenPatterns: [] },
      { userName: 'X', confirmationRequest: { questionGroup: 'autonomy', evidence: [] } },
    );
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(res.text).toContain('я правильно понял');
  });

  it('returns the regenerated draft unconditionally even if it also opens reflectively (no loop)', async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"Вот это, похоже, и есть корень: шум.","confidence":0.9,"containsSurveyProbe":false}' } }] })
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"Звучит как перегрузка, честно.","confidence":0.9,"containsSurveyProbe":false}' } }] });
    const provider = makeProvider();
    const res = await provider.generateResponse(
      [{ role: 'user', content: 'суета', timestamp: new Date() }],
      { mode: 'normal', tone: 'warm', includeFollowUpQuestion: true, maxResponseLength: 'medium', forbiddenPatterns: [] },
      { userName: 'X' },
    );
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(res.text).toBe('Звучит как перегрузка, честно.');
  });
});

describe('OpenAiProvider.analyzeStyle', () => {
  beforeEach(() => createMock.mockReset());
  it('parses observed style', async () => {
    createMock.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '{"dimensions":{"register":0.9,"humor":0.6,"verbosity":0.3,"emoji":0.1},"phrases":["ну такое"]}' } }] });
    const provider = makeProvider();
    const r = await provider.analyzeStyle(['привет, ну такое']);
    expect(r.dimensions.register).toBe(0.9);
    expect(r.phrases).toContain('ну такое');
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
