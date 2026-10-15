import { describe, expect, it } from 'vitest';
import { buildQuestionBundleSystemPrompt } from './question-bundle';

describe('buildQuestionBundleSystemPrompt', () => {
  it('asks for a fair-understanding question for an ordinary bundle', () => {
    const prompt = buildQuestionBundleSystemPrompt('en', 3);
    expect(prompt).toContain('exactly 3 private meanings');
    expect(prompt).toMatch(/whether your understanding is fair/);
    expect(prompt).not.toMatch(/corrected version/);
  });

  it('frames the corrected-statement variant as the corrected version of a disputed statement (GC round 3 CAP-3)', () => {
    const prompt = buildQuestionBundleSystemPrompt('en', 1, 'corrected_statement');
    expect(prompt).toMatch(/corrected version/);
    expect(prompt).toMatch(/whether it is right now/);
    expect(prompt).toMatch(/Do not restate the old, disputed wording/);
    expect(prompt).toContain('Return exactly one statement for each input id');
  });
});
