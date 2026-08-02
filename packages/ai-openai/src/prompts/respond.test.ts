import { describe, it, expect } from 'vitest';
import { buildRespondSystemPrompt } from './respond';
import { RESPOND_STYLE_EXAMPLES } from './respond-examples';
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

describe('buildRespondSystemPrompt few-shot exemplars', () => {
  const strat: ReplyStrategy = {
    mode: 'normal', tone: 'warm', includeFollowUpQuestion: true,
    maxResponseLength: 'medium', forbiddenPatterns: [],
  };
  it('includes the BAD→GOOD exemplars block', () => {
    const prompt = buildRespondSystemPrompt(strat, { userName: 'Test' });
    expect(prompt).toContain(RESPOND_STYLE_EXAMPLES.trim().slice(0, 24));
  });
  it('exemplars demonstrate leading with substance, not labeling', () => {
    expect(RESPOND_STYLE_EXAMPLES.toLowerCase()).toContain('вот это');   // shown as the BAD pattern
    expect(RESPOND_STYLE_EXAMPLES).toMatch(/BAD|ПЛОХО/);
    expect(RESPOND_STYLE_EXAMPLES).toMatch(/GOOD|ХОРОШО/);
  });
});

describe('buildRespondSystemPrompt question gating (includeFollowUpQuestion)', () => {
  const normal = (includeFollowUpQuestion: boolean): ReplyStrategy => ({
    mode: 'normal', tone: 'warm', includeFollowUpQuestion, maxResponseLength: 'short', forbiddenPatterns: [],
  });

  it('encourages a question when includeFollowUpQuestion is true', () => {
    const p = buildRespondSystemPrompt(normal(true), { userName: 'T' });
    expect(p).toMatch(/one sharp question/i);
    expect(p).toContain('Что ещё сейчас занимает голову'); // rhythm exit question available
  });

  it('suppresses questions across the persona body when false (not just the trailing note)', () => {
    const p = buildRespondSystemPrompt(normal(false), { userName: 'T' });
    expect(p).toMatch(/Do NOT ask a question this turn/i);
    expect(p).not.toMatch(/one sharp question/i);
    expect(p).not.toContain('Что ещё сейчас занимает голову');
  });
});
