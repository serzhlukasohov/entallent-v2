import { describe, expect, it } from 'vitest';
import { buildConfirmInterpretSystemPrompt } from './confirm-interpret';

describe('buildConfirmInterpretSystemPrompt', () => {
  it('defines exclusion as a withdrawal/reporting intent', () => {
    const prompt = buildConfirmInterpretSystemPrompt();

    expect(prompt).toContain('"exclude"');
    expect(prompt).toContain('not to include');
    expect(prompt).toContain('report');
  });
});
