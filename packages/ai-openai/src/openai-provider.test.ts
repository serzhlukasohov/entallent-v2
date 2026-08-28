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
import type { LanguagePolicy, MemoryContext, ResponseContext } from '@entalent/application';

function makeProvider() {
  return new OpenAiProvider({ azure: false, apiKey: 'test', model: 'gpt-test' });
}

const turns = [{ role: 'user' as const, content: 'hi', timestamp: new Date() }];
const defaultLanguagePolicy: LanguagePolicy = {
  responseLanguage: 'en',
  source: 'tenant_default',
  confidence: 0.4,
  shouldUpdateUserLocale: false,
};

function responseContext(overrides: Omit<ResponseContext, 'languagePolicy'> & Partial<Pick<ResponseContext, 'languagePolicy'>>): ResponseContext {
  return { languagePolicy: defaultLanguagePolicy, ...overrides };
}

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
      [{ role: 'user', content: "yes, that's right", timestamp: new Date() }],
      'You value autonomy...',
    );
    expect(r.verdict).toBe('agree');
  });

  it('parses a correct verdict with a note', async () => {
    createMock.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '{"verdict":"correct","correctionNote":"not about money"}' } }],
    });
    const provider = makeProvider();
    const r = await provider.interpretConfirmationResponse(
      [{ role: 'user', content: 'not quite', timestamp: new Date() }],
      'summary',
    );
    expect(r.verdict).toBe('correct');
    expect(r.correctionNote).toBe('not about money');
  });
});

describe('OpenAiProvider.classifySituation', () => {
  beforeEach(() => createMock.mockReset());

  it('uses deterministic temperature for dialogue act classification', async () => {
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'casual_conversation',
            secondaryIntents: [],
            emotionalState: ['neutral'],
            urgency: 'low',
            confidence: 0.94,
            requiresSafetyCheck: false,
            surveyAllowed: true,
            reasoningSummary: 'The latest employee message is a social check-in.',
            reminderRequest: null,
            dialogueAct: 'social_checkin',
            latestUserSubstance: null,
            topicAnchor: null,
          }),
        },
      }],
    });

    const provider = makeProvider();
    const result = await provider.classifySituation(
      [{ role: 'user', content: 'как ты?', timestamp: new Date('2026-08-13T12:02:00.000Z') }],
      { userName: 'Serhii' },
    );

    expect(result.dialogueAct).toBe('social_checkin');
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0]).toMatchObject({
      temperature: 0,
      max_completion_tokens: 2048,
    });
  });

  it('normalizes only known dialogue acts misplaced in primaryIntent', async () => {
    const classification = {
      secondaryIntents: [],
      emotionalState: ['neutral'],
      urgency: 'low',
      confidence: 0.94,
      requiresSafetyCheck: false,
      surveyAllowed: true,
      reasoningSummary: 'The employee is wrapping up.',
      reminderRequest: null,
      dialogueAct: 'closing',
      latestUserSubstance: null,
      topicAnchor: 'the release',
    };
    createMock
      .mockResolvedValueOnce({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...classification, primaryIntent: 'closing' }) } }],
      })
      .mockResolvedValueOnce({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...classification, primaryIntent: 'unknown_label' }) } }],
      });
    const provider = makeProvider();

    const normalized = await provider.classifySituation(turns, { userName: 'X' });

    expect(normalized.primaryIntent).toBe('casual_conversation');
    expect(normalized.dialogueAct).toBe('closing');
    await expect(provider.classifySituation(turns, { userName: 'X' })).rejects.toThrow();
  });

  it('promotes an explicit rejection plus corrected request to correction', async () => {
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'casual_conversation',
            secondaryIntents: [],
            emotionalState: [],
            urgency: 'low',
            confidence: 0.9,
            requiresSafetyCheck: false,
            surveyAllowed: true,
            reasoningSummary: 'The employee asks for criteria.',
            reminderRequest: null,
            dialogueAct: 'request',
            latestUserSubstance: 'Give criteria for human-like and relevant answers.',
            topicAnchor: 'chatbot evaluation criteria',
          }),
        },
      }],
    });
    const provider = makeProvider();

    const result = await provider.classifySituation(
      [{
        role: 'user',
        content: 'No, you keep circling. I want you to give me criteria.',
        timestamp: new Date(),
      }],
      { userName: 'Annna' },
    );

    expect(result.dialogueAct).toBe('correction');
    expect(result.latestUserSubstance).toBe('Give criteria for human-like and relevant answers.');
  });

  it('normalizes an explicit stop phrase to closing', async () => {
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'casual_conversation',
            secondaryIntents: [],
            emotionalState: [],
            urgency: 'low',
            confidence: 0.9,
            requiresSafetyCheck: false,
            surveyAllowed: true,
            reasoningSummary: 'The employee gives a short acknowledgement.',
            reminderRequest: null,
            dialogueAct: 'acknowledgement',
            latestUserSubstance: null,
            topicAnchor: 'chatbot evaluation criteria',
          }),
        },
      }],
    });
    const provider = makeProvider();

    const result = await provider.classifySituation(
      [{ role: 'user', content: 'No, forget', timestamp: new Date() }],
      { userName: 'Annna' },
    );

    expect(result.dialogueAct).toBe('closing');
    expect(result.latestUserSubstance).toBeNull();
    expect(result.topicAnchor).toBeNull();
  });
});

function replyPlan(maxQuestions: 0 | 1): NonNullable<ResponseContext['replyPlan']> {
  return {
    dialogueAct: 'new_substance',
    latestUserSubstance: 'chaos',
    topicAnchor: null,
    memoryAnchors: [],
    responseMove: 'address_new_substance',
    mayInferFromBrevity: true,
    questionPolicy: {
      maxQuestions,
      reason: maxQuestions === 0 ? 'acknowledgement_no_new_substance' : 'new_substance_allows_question',
    },
    requiredGrounding: [],
    forbiddenMoves: [],
  };
}

describe('OpenAiProvider.generateResponse opener behavior', () => {
  beforeEach(() => createMock.mockReset());
  const strat = { mode: 'normal', tone: 'warm', includeFollowUpQuestion: true, maxResponseLength: 'medium', forbiddenPatterns: [] } as ReplyStrategy;

  it('does not regenerate when the first draft opens with a reflective label', async () => {
    createMock.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"That, it seems, is the real root: noise.","confidence":0.9,"containsSurveyProbe":false}' } }] });
    const provider = makeProvider();
    const res = await provider.generateResponse([{ role: 'user', content: 'chaos', timestamp: new Date() }], strat, responseContext({ userName: 'X' }));
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(res.text).toBe('That, it seems, is the real root: noise.');
  });

  it('does not regenerate when the first draft is clean', async () => {
    createMock.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"What is stopping you from cutting that off first?","confidence":0.9,"containsSurveyProbe":false}' } }] });
    const provider = makeProvider();
    await provider.generateResponse([{ role: 'user', content: 'chaos', timestamp: new Date() }], strat, responseContext({ userName: 'X' }));
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('does not run the opener gate for confirmation replies (confirmationRequest set)', async () => {
    createMock.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"It seems like autonomy matters more to you — did I get that right?","confidence":0.9,"containsSurveyProbe":false}' } }] });
    const provider = makeProvider();
    const res = await provider.generateResponse(
      [{ role: 'user', content: 'yes', timestamp: new Date() }],
      { mode: 'confirmation', tone: 'warm', includeFollowUpQuestion: false, maxResponseLength: 'medium', forbiddenPatterns: [] },
      responseContext({ userName: 'X', confirmationRequest: { questionGroup: 'autonomy', evidence: [] } }),
    );
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(res.text).toContain('did I get that right');
  });

  it('does not use the reflective-opener regex gate when a typed reply plan is present', async () => {
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: '{"text":"That, it seems, is the real root: noise.","confidence":0.9,"containsSurveyProbe":false}',
        },
      }],
    });
    const provider = makeProvider();
    const context: ResponseContext = {
      userName: 'X',
      languagePolicy: defaultLanguagePolicy,
      replyPlan: replyPlan(1),
    };

    const res = await provider.generateResponse(
      [{ role: 'user', content: 'chaos', timestamp: new Date() }],
      strat,
      context,
    );

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(res.text).toBe('That, it seems, is the real root: noise.');
  });
});

describe('OpenAiProvider.generateResponse length + question gates', () => {
  beforeEach(() => createMock.mockReset());
  const terseContext = responseContext({
    userName: 'X',
    styleAdaptation: { dimensions: { register: 0.5, humor: 0.3, verbosity: 0.08, emoji: 0.2 }, weight: 0.4, phrases: [] },
  });
  const shortNoQuestion = {
    mode: 'normal', tone: 'warm', includeFollowUpQuestion: false, maxResponseLength: 'short', forbiddenPatterns: [],
  } as ReplyStrategy;

  it('regenerates once when a terse short reply overruns the length budget', async () => {
    const tooLong =
      'This is a much longer reply than a terse user warrants, packed with an extra observation, a follow-on thought, and yet another clause that just keeps going well past any short budget.';
    createMock
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: tooLong, confidence: 0.9, containsSurveyProbe: false }) } }] })
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Rough one.', confidence: 0.9, containsSurveyProbe: false }) } }] });
    const provider = makeProvider();
    const res = await provider.generateResponse([{ role: 'user', content: 'tired', timestamp: new Date() }], shortNoQuestion, terseContext);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(res.text).toBe('Rough one.');
  });

  it('does not regenerate a short reply within the terse budget', async () => {
    createMock.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Rough one.', confidence: 0.9, containsSurveyProbe: false }) } }] });
    const provider = makeProvider();
    await provider.generateResponse([{ role: 'user', content: 'tired', timestamp: new Date() }], shortNoQuestion, terseContext);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('regenerates when a no-question turn ends with a question', async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'And what will you change about it?', confidence: 0.9, containsSurveyProbe: false }) } }] })
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Makes sense.', confidence: 0.9, containsSurveyProbe: false }) } }] });
    const provider = makeProvider();
    const res = await provider.generateResponse(
      [{ role: 'user', content: 'ok', timestamp: new Date() }],
      { mode: 'normal', tone: 'warm', includeFollowUpQuestion: false, maxResponseLength: 'medium', forbiddenPatterns: [] },
      responseContext({ userName: 'X' }),
    );
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(res.text).toBe('Makes sense.');
  });

  it('regenerates for an embedded Armenian question mark on a zero-question turn', async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Why՞ I will leave it there.', confidence: 0.9, containsSurveyProbe: false }) } }] })
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'I will leave it there.', confidence: 0.9, containsSurveyProbe: false }) } }] });
    const provider = makeProvider();

    const res = await provider.generateResponse(turns, shortNoQuestion, responseContext({ userName: 'X' }));

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(res.text).toBe('I will leave it there.');
  });

  it('regenerates when a one-question turn contains two question groups', async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'What changed? What comes next?', confidence: 0.9, containsSurveyProbe: false }) } }] })
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'What comes next?', confidence: 0.9, containsSurveyProbe: false }) } }] });
    const provider = makeProvider();

    const res = await provider.generateResponse(
      turns,
      shortNoQuestion,
      responseContext({ userName: 'X', replyPlan: replyPlan(1) }),
    );

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(res.text).toBe('What comes next?');
  });

  it('regenerates a confirmation with more than one Unicode question group', async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Really？？ Did I get that right؟', confidence: 0.9, containsSurveyProbe: false }) } }] })
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Did I get that right؟', confidence: 0.9, containsSurveyProbe: false }) } }] });
    const provider = makeProvider();

    const res = await provider.generateResponse(
      turns,
      { mode: 'confirmation', tone: 'warm', includeFollowUpQuestion: false, maxResponseLength: 'medium', forbiddenPatterns: [] },
      responseContext({ userName: 'X', confirmationRequest: { questionGroup: 'autonomy', evidence: [] } }),
    );

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(res.text).toBe('Did I get that right؟');
  });

  it('uses typed replyPlan question policy instead of the legacy strategy flag', async () => {
    createMock.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'What changes first?', confidence: 0.9, containsSurveyProbe: false }) } }] });
    const provider = makeProvider();
    const res = await provider.generateResponse(
      [{ role: 'user', content: 'chaos', timestamp: new Date() }],
      { mode: 'normal', tone: 'warm', includeFollowUpQuestion: false, maxResponseLength: 'medium', forbiddenPatterns: [] },
      responseContext({ userName: 'X', replyPlan: replyPlan(1) }),
    );
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(res.text).toBe('What changes first?');
  });

  it('enforces typed replyPlan no-question policy even when the legacy strategy allows questions', async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'What changes first?', confidence: 0.9, containsSurveyProbe: false }) } }] })
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'That tracks.', confidence: 0.9, containsSurveyProbe: false }) } }] });
    const provider = makeProvider();
    const res = await provider.generateResponse(
      [{ role: 'user', content: 'ok', timestamp: new Date() }],
      { mode: 'normal', tone: 'warm', includeFollowUpQuestion: true, maxResponseLength: 'medium', forbiddenPatterns: [] },
      responseContext({ userName: 'X', replyPlan: replyPlan(0) }),
    );
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(res.text).toBe('That tracks.');
  });

  it('regenerates a numeric probe that omits the explicit 0-to-10 scale', async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        text: 'How engaged do you feel?', confidence: 0.9, containsSurveyProbe: true,
        surveyProbeQuestionId: 'q-engagement',
      }) } }] })
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        text: 'From 0 to 10, how engaged do you feel?', confidence: 0.9, containsSurveyProbe: true,
        surveyProbeQuestionId: 'q-engagement',
      }) } }] });
    const provider = makeProvider();

    const result = await provider.generateResponse(
      turns,
      { mode: 'survey_probe', tone: 'warm', includeFollowUpQuestion: true, maxResponseLength: 'short', forbiddenPatterns: [] },
      responseContext({
        userName: 'X',
        surveyProbeQuestion: {
          id: 'q-engagement', responseType: 'numeric_0_10', probeStrategies: ['Ask for a rating.'],
        },
      }),
    );

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(result.text).toContain('0 to 10');
  });

  it('fails closed when a numeric probe retry is still noncompliant', async () => {
    createMock.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        text: 'How engaged do you feel?', confidence: 0.9, containsSurveyProbe: true,
        surveyProbeQuestionId: 'q-engagement',
      }) } }],
    });
    const provider = makeProvider();

    await expect(provider.generateResponse(
      turns,
      { mode: 'survey_probe', tone: 'warm', includeFollowUpQuestion: true, maxResponseLength: 'short', forbiddenPatterns: [] },
      responseContext({
        userName: 'X',
        surveyProbeQuestion: {
          id: 'q-engagement', responseType: 'numeric_0_10', probeStrategies: ['Ask for a rating.'],
        },
      }),
    )).rejects.toThrow(/noncompliant numeric survey probe/);
  });
});

describe('OpenAiProvider.extractMemory resilience', () => {
  beforeEach(() => createMock.mockReset());

  it('drops items with an invalid category instead of throwing away the batch', async () => {
    const payload = JSON.stringify({
      memoryItems: [
        { category: 'stressors', content: 'invalid category', confidence: 0.9, importance: 0.5, sensitivity: 'normal', expectedLifetime: 'weeks', sourceMessageIds: [], action: 'create' },
        { category: 'stressor', content: 'valid item', confidence: 0.9, importance: 0.5, sensitivity: 'normal', expectedLifetime: 'weeks', sourceMessageIds: [], action: 'create' },
      ],
      goalProposals: [], commitmentProposals: [], followUpCandidates: [],
    });
    createMock.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: payload } }] });
    const provider = makeProvider();

    const result = await provider.extractMemory(
      [{ role: 'user', content: 'x', timestamp: new Date() }],
      { items: [], goals: [] } as unknown as MemoryContext,
    );

    expect(result.memoryItems).toHaveLength(1);
    expect(result.memoryItems[0].content).toBe('valid item');
  });
});

describe('OpenAiProvider.analyzeStyle', () => {
  beforeEach(() => createMock.mockReset());
  it('parses observed style', async () => {
    createMock.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '{"dimensions":{"register":0.9,"humor":0.6,"verbosity":0.3,"emoji":0.1},"phrases":["eh, so-so"]}' } }] });
    const provider = makeProvider();
    const r = await provider.analyzeStyle(['hey, eh so-so']);
    expect(r.dimensions.register).toBe(0.9);
    expect(r.phrases).toContain('eh, so-so');
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
