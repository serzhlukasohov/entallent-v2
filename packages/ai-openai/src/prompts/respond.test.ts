import { describe, it, expect } from 'vitest';
import { buildRespondSystemPrompt } from './respond';
import type { ReplyStrategy } from '@entalent/contracts';

const strategy: ReplyStrategy = {
  mode: 'confirmation',
  tone: 'warm',
  includeFollowUpQuestion: false,
  maxResponseLength: 'medium',
  forbiddenPatterns: [],
};

describe('buildRespondSystemPrompt confirmation branch', () => {
  it('emits confirm-only instructions when confirmationRequest is set', () => {
    const prompt = buildRespondSystemPrompt(strategy, {
      userName: 'Test',
      confirmationRequest: {
        questionGroup: 'autonomy',
        evidence: [{ stableKey: 'q12', evidenceSummary: 'values ownership', polarity: 'positive' }],
      },
    });
    expect(prompt).toMatch(/only one question/i);
    expect(prompt).toContain('autonomy');
  });

  it('does not emit confirm instructions otherwise', () => {
    const prompt = buildRespondSystemPrompt(strategy, { userName: 'Test' });
    expect(prompt).not.toMatch(/did i get that right/i);
  });
});
