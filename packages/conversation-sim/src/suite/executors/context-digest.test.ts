import { describe, expect, it } from 'vitest';
import { contextDigest } from './context-digest';

const at = new Date('2026-01-05T09:00:00Z');

describe('contextDigest', () => {
  it('summarises a generateResponse call without any message or memory text', () => {
    const digest = contextDigest('generateResponse', [
      [
        { role: 'user', content: 'secret one', timestamp: at },
        { role: 'assistant', content: 'secret two', timestamp: at },
        { role: 'user', content: 'secret three', timestamp: at },
      ],
      { mode: 'coaching' },
      {
        userName: 'Ann',
        languagePolicy: { responseLanguage: 'en', source: 'product_default' },
        memoryContext: {
          items: [
            { id: 'mem-1', category: 'commitment', content: 'secret fact', importance: 8 },
            { id: 'mem-2', category: 'commitment', content: 'another', importance: 5 },
          ],
          goals: [{ id: 'goal-1', title: 'secret goal', status: 'active' }],
        },
        isSessionStart: false,
        localTime: '22:30',
        surveyProbeQuestion: { id: 'q12_expectations', probeStrategies: [] },
        trailingBundle: { text: 'secret summary' },
        followUpIntent: undefined,
      },
    ]);
    expect(digest).toEqual({
      history: { turns: 3, user: 2, assistant: 1, lastRole: 'user' },
      memory: { items: 2, categories: ['commitment'], goals: 1 },
      mode: 'coaching',
      sessionStart: false,
      localTime: '22:30',
      responseLanguage: 'en',
      surveyQuestionId: 'q12_expectations',
      sections: ['surveyProbeQuestion', 'trailingBundle'],
    });
    expect(JSON.stringify(digest)).not.toMatch(/secret|Ann/);
  });

  it('records an empty context as zero history and zero memory', () => {
    expect(contextDigest('generateResponse', [[], { mode: 'normal' }, { userName: 'Ann', languagePolicy: { responseLanguage: 'en', source: 'product_default' } }])).toEqual({
      history: { turns: 0, user: 0, assistant: 0, lastRole: null },
      memory: { items: 0, categories: [], goals: 0 },
      mode: 'normal',
      responseLanguage: 'en',
      sections: [],
    });
  });

  it('ignores other methods and unrecognised arguments', () => {
    expect(contextDigest('classifySituation', [[], {}, {}])).toBeUndefined();
    expect(contextDigest('generateResponse', ['not turns'])).toBeUndefined();
  });
});
