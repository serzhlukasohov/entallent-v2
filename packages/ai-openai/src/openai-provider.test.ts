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
    responseType: 'open_ended' as const,
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

  it('parses an exclusion verdict', async () => {
    createMock.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '{"verdict":"exclude"}' } }],
    });
    const provider = makeProvider();
    const r = await provider.interpretConfirmationResponse(
      [{ role: 'user', content: 'do not include that in reports', timestamp: new Date() }],
      'summary',
    );
    expect(r.verdict).toBe('exclude');
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
            dialogueAct: 'closing',
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

  it('drops reporting explanation inferred from descriptive product context', async () => {
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'reporting_explanation',
            secondaryIntents: ['reporting_explanation'],
            emotionalState: [],
            urgency: 'low',
            confidence: 0.9,
            requiresSafetyCheck: false,
            surveyAllowed: true,
            reasoningSummary: 'The older transcript mentioned pulse reporting.',
            reminderRequest: null,
            dialogueAct: 'request',
            latestUserSubstance: 'Who sees the pulse report?',
            topicAnchor: 'chatbot answer quality',
          }),
        },
      }],
    });
    const provider = makeProvider();

    const result = await provider.classifySituation(
      [{
        role: 'user',
        content: 'The bot builds a report so managers understand mood and who they need to support, mentor, or appreciate more.',
        timestamp: new Date(),
      }],
      { userName: 'Annna' },
    );

    expect(result.primaryIntent).toBe('clarification');
    expect(result.secondaryIntents).toEqual([]);
    expect(result.dialogueAct).toBe('request');
  });

  it('does not treat answer-quality criteria as a reporting usage question', async () => {
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'reporting_explanation',
            secondaryIntents: ['feedback_request'],
            emotionalState: [],
            urgency: 'low',
            confidence: 0.9,
            requiresSafetyCheck: false,
            surveyAllowed: true,
            reasoningSummary: 'The turn mentions pulse reporting before asking how to evaluate answers.',
            reminderRequest: null,
            dialogueAct: 'request',
            latestUserSubstance: 'What criteria should I use to judge answer quality?',
            topicAnchor: 'chatbot answer quality',
          }),
        },
      }],
    });
    const provider = makeProvider();

    const result = await provider.classifySituation(
      [{
        role: 'user',
        content: 'It builds a manager report, but that is only background. What criteria should I use to judge whether its answers sound human and stay relevant?',
        timestamp: new Date(),
      }],
      { userName: 'Annna' },
    );

    expect(result.primaryIntent).toBe('clarification');
    expect(result.secondaryIntents).toEqual(['feedback_request']);
    expect(result.dialogueAct).toBe('request');
  });

  it('keeps an explicit reporting destination question', async () => {
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'reporting_explanation',
            secondaryIntents: [],
            emotionalState: [],
            urgency: 'low',
            confidence: 0.9,
            requiresSafetyCheck: false,
            surveyAllowed: true,
            reasoningSummary: 'The employee explicitly asks where confirmed information goes.',
            reminderRequest: null,
            dialogueAct: 'request',
            latestUserSubstance: 'Куда пойдёт подтверждённая информация?',
            topicAnchor: null,
          }),
        },
      }],
    });
    const provider = makeProvider();

    const result = await provider.classifySituation(
      [{ role: 'user', content: 'Куда пойдёт подтверждённая информация?', timestamp: new Date() }],
      { userName: 'Игорь' },
    );

    expect(result.primaryIntent).toBe('reporting_explanation');
  });

  it.each([
    [
      "We're in EnTalent on Slack. I mean my manager's EnTalent access: can they open my messages, personal summary or tasks?",
      'clarification',
    ],
    [
      'If I confirm a pulse summary, does that let HR read my own answers?',
      'reporting_explanation',
    ],
  ] as const)('recognizes the D02-01 individual-access question: %s', async (content, primaryIntent) => {
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent,
            secondaryIntents: [],
            emotionalState: [],
            urgency: 'low',
            confidence: 0.9,
            requiresSafetyCheck: false,
            surveyAllowed: true,
            reasoningSummary: 'The employee asks about individual access.',
            reminderRequest: null,
            dialogueAct: 'request',
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });
    const provider = makeProvider();

    const result = await provider.classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe('reporting_explanation');
  });

  it('recognizes the exact D02-02 unconfirmed-reportability question', async () => {
    const content = "And if I don't confirm it, can my answers still be used in team reports?";
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
            reasoningSummary: 'The employee asks about unconfirmed answers.',
            reminderRequest: null,
            dialogueAct: 'new_substance',
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });
    const provider = makeProvider();

    const result = await provider.classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe('reporting_explanation');
    expect(result.surveyAllowed).toBe(false);
  });

  it('recognizes the exact D02-03 product data-use question', async () => {
    const content = 'What do you use my messages for? Are you a real person?';
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
            reasoningSummary: 'The employee asks about the mentor.',
            reminderRequest: { intent: 'hallucinated reminder', dueAt: '2026-09-17T09:00:00.000Z' },
            dialogueAct: 'new_substance',
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });
    const provider = makeProvider();

    const result = await provider.classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe('data_use_explanation');
    expect(result.surveyAllowed).toBe(false);
    expect(result.reminderRequest).toBeNull();
  });

  it('keeps a reporting-specific message-use question on the reporting route', async () => {
    const content = 'How do you use my messages in team reports?';
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'data_use_explanation',
            secondaryIntents: [],
            emotionalState: [],
            urgency: 'low',
            confidence: 0.9,
            requiresSafetyCheck: false,
            surveyAllowed: true,
            reasoningSummary: 'The employee asks how messages enter team reports.',
            reminderRequest: null,
            dialogueAct: 'request',
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });

    const result = await makeProvider().classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe('reporting_explanation');
    expect(result.secondaryIntents).not.toContain('data_use_explanation');
  });

  it('recognizes the explicit D02-03 follow-up about memory, tasks, pulse, and safety', async () => {
    const content = 'Do you also use what I say for memory, tasks, pulse reporting or safety checks?';
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'clarification',
            secondaryIntents: [],
            emotionalState: [],
            urgency: 'low',
            confidence: 0.9,
            requiresSafetyCheck: false,
            surveyAllowed: true,
            reasoningSummary: 'The employee asks a follow-up.',
            reminderRequest: null,
            dialogueAct: 'request',
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });

    const result = await makeProvider().classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe('data_use_explanation');
    expect(result.surveyAllowed).toBe(false);
  });

  it('keeps safety primary when an unsafe turn also asks exact D02-03', async () => {
    const content = 'I might hurt myself. What do you use my messages for? Are you a real person?';
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'potential_crisis',
            secondaryIntents: [],
            emotionalState: ['unsafe'],
            urgency: 'critical',
            confidence: 0.9,
            requiresSafetyCheck: true,
            surveyAllowed: false,
            reasoningSummary: 'The employee may be in immediate danger.',
            reminderRequest: null,
            dialogueAct: 'emotional_disclosure',
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });

    const result = await makeProvider().classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe('potential_crisis');
    expect(result.secondaryIntents).toContain('data_use_explanation');
    expect(result.surveyAllowed).toBe(false);
  });

  it.each([
    'Для чего ты используешь мои сообщения? Ты настоящий человек?',
    'Для чого ти використовуєш мої повідомлення? Ти справжня людина?',
  ])('keeps a localized direct data-use request on the typed route: %s', async (content) => {
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
            reasoningSummary: 'The employee directly asks how their messages are used.',
            reminderRequest: null,
            dialogueAct: 'request',
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });

    const result = await makeProvider().classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe('data_use_explanation');
    expect(result.surveyAllowed).toBe(false);
  });

  it.each([
    ['Translate: "What do you use my messages for? Are you a real person?"', 'request', 'clarification'],
    ['Could you translate: "What do you use my messages for? Are you a real person?"', 'request', 'clarification'],
    ['Could you please translate: "What do you use my messages for?"', 'request', 'clarification'],
    ['Evaluate another chatbot\'s reply: "What do you use my messages for? Are you a real person?"', 'request', 'clarification'],
    ['Could you review another chatbot\'s reply: "What do you use my messages for?"', 'request', 'clarification'],
    ['Review this response from another chatbot: "What do you use my messages for?"', 'request', 'clarification'],
    ['Переведи: «Для чего ты используешь мои сообщения?»', 'request', 'clarification'],
    ['Переклади: «Для чого ти використовуєш мої повідомлення?»', 'request', 'clarification'],
    ['The transcript says, "What do you use my messages for?"', 'new_substance', 'casual_conversation'],
    ['This assistant uses my messages for memory and safety checks.', 'new_substance', 'casual_conversation'],
  ] as const)('does not promote quoted, evaluated, or descriptive D02-03 content: %s', async (content, dialogueAct, expectedIntent) => {
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'data_use_explanation',
            secondaryIntents: [],
            emotionalState: [],
            urgency: 'low',
            confidence: 0.9,
            requiresSafetyCheck: false,
            surveyAllowed: true,
            reasoningSummary: 'The employee is discussing text.',
            reminderRequest: null,
            dialogueAct,
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });

    const result = await makeProvider().classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe(expectedIntent);
    expect(result.surveyAllowed).toBe(true);
  });

  it('does not take over a mixed reminder action', async () => {
    const content = 'What do you use my messages for? Also remind me to send the report tomorrow.';
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'goal_setting',
            secondaryIntents: [],
            emotionalState: [],
            urgency: 'low',
            confidence: 0.9,
            requiresSafetyCheck: false,
            surveyAllowed: true,
            reasoningSummary: 'The employee asks for a reminder.',
            reminderRequest: { intent: 'send the report', dueAt: '2026-09-17T09:00:00.000Z' },
            dialogueAct: 'request',
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });

    const result = await makeProvider().classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe('goal_setting');
    expect(result.reminderRequest).not.toBeNull();
  });

  it.each([
    'What do you use my messages for; help me draft a privacy note.',
    'Help me draft a privacy note. What do you use my messages for?',
    'What do you use my messages for?\nCreate a task for tomorrow.',
    'Send this summary, and tell me what you use my messages for.',
  ])('does not take over a mixed non-reminder action: %s', async (content) => {
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'coaching',
            secondaryIntents: [],
            emotionalState: [],
            urgency: 'low',
            confidence: 0.9,
            requiresSafetyCheck: false,
            surveyAllowed: true,
            reasoningSummary: 'The employee asks for drafting help.',
            reminderRequest: null,
            dialogueAct: 'request',
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });

    const result = await makeProvider().classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe('coaching');
    expect(result.surveyAllowed).toBe(true);
  });

  it('restores safety primary when a mixed action is misclassified as data use', async () => {
    const content = 'What do you use my messages for, and help me write a note? I might hurt myself.';
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'data_use_explanation',
            secondaryIntents: ['potential_crisis'],
            emotionalState: ['unsafe'],
            urgency: 'critical',
            confidence: 0.9,
            requiresSafetyCheck: true,
            surveyAllowed: false,
            reasoningSummary: 'The employee may be in immediate danger.',
            reminderRequest: null,
            dialogueAct: 'emotional_disclosure',
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });

    const result = await makeProvider().classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe('potential_crisis');
    expect(result.secondaryIntents).not.toContain('data_use_explanation');
    expect(result.surveyAllowed).toBe(false);
  });

  it('keeps safety primary when D02-02 is misclassified as the primary intent', async () => {
    const content = "I might hurt myself. And if I don't confirm it, can my answers still be used in team reports?";
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'reporting_explanation',
            secondaryIntents: ['potential_crisis'],
            emotionalState: ['unsafe'],
            urgency: 'critical',
            confidence: 0.9,
            requiresSafetyCheck: true,
            surveyAllowed: false,
            reasoningSummary: 'The employee may be in immediate danger.',
            reminderRequest: null,
            dialogueAct: 'emotional_disclosure',
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });
    const provider = makeProvider();

    const result = await provider.classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe('potential_crisis');
    expect(result.secondaryIntents).toContain('reporting_explanation');
  });

  it('does not promote a descriptive statement about unconfirmed reporting', async () => {
    const content = 'Unconfirmed answers are not used in team reports.';
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'reporting_explanation',
            secondaryIntents: [],
            emotionalState: [],
            urgency: 'low',
            confidence: 0.9,
            requiresSafetyCheck: false,
            surveyAllowed: true,
            reasoningSummary: 'The employee states the reporting boundary.',
            reminderRequest: null,
            dialogueAct: 'new_substance',
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });
    const provider = makeProvider();

    const result = await provider.classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe('casual_conversation');
    expect(result.secondaryIntents).toEqual([]);
  });

  it('does not promote the quoted D02-02 question inside a translation request', async () => {
    const content = 'Translate: "And if I don\'t confirm it, can my answers still be used in team reports?"';
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'reporting_explanation',
            secondaryIntents: [],
            emotionalState: [],
            urgency: 'low',
            confidence: 0.9,
            requiresSafetyCheck: false,
            surveyAllowed: true,
            reasoningSummary: 'The quoted sentence asks about reporting.',
            reminderRequest: null,
            dialogueAct: 'request',
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });
    const provider = makeProvider();

    const result = await provider.classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe('clarification');
  });

  it('demotes a descriptive statement that matches the generic reporting pattern', async () => {
    const content = 'I did not confirm it, but my answers were used in team reports.';
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'reporting_explanation',
            secondaryIntents: [],
            emotionalState: [],
            urgency: 'low',
            confidence: 0.9,
            requiresSafetyCheck: false,
            surveyAllowed: true,
            reasoningSummary: 'The employee describes prior reporting.',
            reminderRequest: null,
            dialogueAct: 'new_substance',
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });
    const provider = makeProvider();

    const result = await provider.classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe('casual_conversation');
    expect(result.secondaryIntents).toEqual([]);
  });

  it('keeps safety primary when an unsafe turn also asks about individual manager access', async () => {
    const content = 'I might hurt myself. Can my manager open my messages?';
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'potential_crisis',
            secondaryIntents: [],
            emotionalState: ['unsafe'],
            urgency: 'critical',
            confidence: 0.9,
            requiresSafetyCheck: true,
            surveyAllowed: false,
            reasoningSummary: 'The employee may be in immediate danger.',
            reminderRequest: null,
            dialogueAct: 'emotional_disclosure',
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });
    const provider = makeProvider();

    const result = await provider.classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe('potential_crisis');
    expect(result.secondaryIntents).toContain('reporting_explanation');
  });

  it('restores safety primary when the classifier puts it behind reporting', async () => {
    const content = 'I might hurt myself. Can my manager open my messages?';
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            primaryIntent: 'reporting_explanation',
            secondaryIntents: ['potential_crisis'],
            emotionalState: ['unsafe'],
            urgency: 'critical',
            confidence: 0.9,
            requiresSafetyCheck: true,
            surveyAllowed: false,
            reasoningSummary: 'The employee may be in immediate danger.',
            reminderRequest: null,
            dialogueAct: 'emotional_disclosure',
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });
    const provider = makeProvider();

    const result = await provider.classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe('potential_crisis');
    expect(result.secondaryIntents).toContain('reporting_explanation');
  });

  it('does not promote a descriptive manager-access statement', async () => {
    const content = 'My manager can access weekly updates in my personal summary.';
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
            reasoningSummary: 'The employee describes their current setup.',
            reminderRequest: null,
            dialogueAct: 'new_substance',
            latestUserSubstance: content,
            topicAnchor: null,
          }),
        },
      }],
    });
    const provider = makeProvider();

    const result = await provider.classifySituation(
      [{ role: 'user', content, timestamp: new Date() }],
      { userName: 'Ed' },
    );

    expect(result.primaryIntent).toBe('casual_conversation');
    expect(result.secondaryIntents).toEqual([]);
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
    createMock.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"Autonomy matters more to you — did I get that right?","confirmationSummary":"Autonomy matters more to you","confidence":0.9,"containsSurveyProbe":false}' } }] });
    const provider = makeProvider();
    const res = await provider.generateResponse(
      [{ role: 'user', content: 'yes', timestamp: new Date() }],
      { mode: 'confirmation', tone: 'warm', includeFollowUpQuestion: false, maxResponseLength: 'medium', forbiddenPatterns: [] },
      responseContext({ userName: 'X', confirmationRequest: { questionGroup: 'autonomy', evidence: [] } }),
    );
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(res.text).toContain('did I get that right');
  });

  it('regenerates once when a confirmation draft omits its exact reportable summary', async () => {
    createMock
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: 'stop',
          message: { content: '{"text":"Did I get that right?","confidence":0.9,"containsSurveyProbe":false}' },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              text: 'You value ownership. Did I get that right?',
              confirmationSummary: 'You value ownership.',
              confidence: 0.9,
              containsSurveyProbe: false,
            }),
          },
        }],
      });
    const provider = makeProvider();

    const response = await provider.generateResponse(
      turns,
      { mode: 'confirmation', tone: 'warm', includeFollowUpQuestion: false, maxResponseLength: 'medium', forbiddenPatterns: [] },
      responseContext({ userName: 'X', confirmationRequest: { questionGroup: 'autonomy', evidence: [] } }),
    );

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(response.confirmationSummary).toBe('You value ownership.');
  });

  it('rejects a confirmation after one corrective draft still lacks a verbatim summary', async () => {
    createMock
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: 'stop',
          message: {
            content: '{"text":"You value ownership. Did I get that right?","confirmationSummary":"Different text","confidence":0.9,"containsSurveyProbe":false}',
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: 'stop',
          message: { content: '{"text":"Did I get that right?","confidence":0.9,"containsSurveyProbe":false}' },
        }],
      });
    const provider = makeProvider();

    await expect(provider.generateResponse(
      turns,
      { mode: 'confirmation', tone: 'warm', includeFollowUpQuestion: false, maxResponseLength: 'medium', forbiddenPatterns: [] },
      responseContext({ userName: 'X', confirmationRequest: { questionGroup: 'autonomy', evidence: [] } }),
    )).rejects.toThrow(/confirmationSummary/);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('strips an exposed confirmationSummary label before validating a confirmation draft', async () => {
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            text: 'confirmationSummary: You value ownership. Did I get that right?',
            confirmationSummary: 'You value ownership.',
            confidence: 0.9,
            containsSurveyProbe: false,
          }),
        },
      }],
    });
    const provider = makeProvider();

    const response = await provider.generateResponse(
      turns,
      { mode: 'confirmation', tone: 'warm', includeFollowUpQuestion: false, maxResponseLength: 'medium', forbiddenPatterns: [] },
      responseContext({ userName: 'X', confirmationRequest: { questionGroup: 'autonomy', evidence: [] } }),
    );

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(response.text).toBe('You value ownership. Did I get that right?');
    expect(response.confirmationSummary).toBe('You value ownership.');
  });

  it('rejects a confirmation when the reportable summary is the whole reply', async () => {
    const wholeReply = 'You value ownership. Did I get that right?';
    createMock.mockResolvedValue({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            text: wholeReply,
            confirmationSummary: wholeReply,
            confidence: 0.9,
            containsSurveyProbe: false,
          }),
        },
      }],
    });
    const provider = makeProvider();

    await expect(provider.generateResponse(
      turns,
      { mode: 'confirmation', tone: 'warm', includeFollowUpQuestion: false, maxResponseLength: 'medium', forbiddenPatterns: [] },
      responseContext({ userName: 'X', confirmationRequest: { questionGroup: 'autonomy', evidence: [] } }),
    )).rejects.toThrow(/confirmationSummary/);
    expect(createMock).toHaveBeenCalledTimes(2);
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

  it('rejects a corrected draft that still violates the zero-question policy', async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'What changes first?', confidence: 0.9, containsSurveyProbe: false }) } }] })
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'What comes next?', confidence: 0.9, containsSurveyProbe: false }) } }] });
    const provider = makeProvider();

    await expect(provider.generateResponse(
      [{ role: 'user', content: 'ok', timestamp: new Date() }],
      { mode: 'normal', tone: 'warm', includeFollowUpQuestion: false, maxResponseLength: 'medium', forbiddenPatterns: [] },
      responseContext({ userName: 'X' }),
    )).rejects.toThrow(/question/i);
    expect(createMock).toHaveBeenCalledTimes(2);
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
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Ownership matters. Really？？ Did I get that right؟', confirmationSummary: 'Ownership matters.', confidence: 0.9, containsSurveyProbe: false }) } }] })
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Ownership matters. Did I get that right؟', confirmationSummary: 'Ownership matters.', confidence: 0.9, containsSurveyProbe: false }) } }] });
    const provider = makeProvider();

    const res = await provider.generateResponse(
      turns,
      { mode: 'confirmation', tone: 'warm', includeFollowUpQuestion: false, maxResponseLength: 'medium', forbiddenPatterns: [] },
      responseContext({ userName: 'X', confirmationRequest: { questionGroup: 'autonomy', evidence: [] } }),
    );

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(res.text).toBe('Ownership matters. Did I get that right؟');
  });

  it('regenerates a confirmation with no question group', async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Ownership matters. I got that right.', confirmationSummary: 'Ownership matters.', confidence: 0.9, containsSurveyProbe: false }) } }] })
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Ownership matters. Did I get that right?', confirmationSummary: 'Ownership matters.', confidence: 0.9, containsSurveyProbe: false }) } }] });
    const provider = makeProvider();

    const res = await provider.generateResponse(
      turns,
      { mode: 'confirmation', tone: 'warm', includeFollowUpQuestion: false, maxResponseLength: 'medium', forbiddenPatterns: [] },
      responseContext({ userName: 'X', confirmationRequest: { questionGroup: 'autonomy', evidence: [] } }),
    );

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(res.text).toBe('Ownership matters. Did I get that right?');
  });

  it('rejects a corrected confirmation that still has more than one question group', async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Ownership matters. Really? Did I get that right?', confirmationSummary: 'Ownership matters.', confidence: 0.9, containsSurveyProbe: false }) } }] })
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Ownership matters. Sure? Did I get that right?', confirmationSummary: 'Ownership matters.', confidence: 0.9, containsSurveyProbe: false }) } }] });
    const provider = makeProvider();

    await expect(provider.generateResponse(
      turns,
      { mode: 'confirmation', tone: 'warm', includeFollowUpQuestion: false, maxResponseLength: 'medium', forbiddenPatterns: [] },
      responseContext({ userName: 'X', confirmationRequest: { questionGroup: 'autonomy', evidence: [] } }),
    )).rejects.toThrow(/confirmation/i);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('regenerates when confirmationSummary contains a question group', async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Does ownership matter? Tell me if that is right.', confirmationSummary: 'Does ownership matter?', confidence: 0.9, containsSurveyProbe: false }) } }] })
      .mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Ownership matters. Is that right?', confirmationSummary: 'Ownership matters.', confidence: 0.9, containsSurveyProbe: false }) } }] });
    const provider = makeProvider();

    const res = await provider.generateResponse(
      turns,
      { mode: 'confirmation', tone: 'warm', includeFollowUpQuestion: false, maxResponseLength: 'medium', forbiddenPatterns: [] },
      responseContext({ userName: 'X', confirmationRequest: { questionGroup: 'autonomy', evidence: [] } }),
    );

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(res.confirmationSummary).toBe('Ownership matters.');
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
