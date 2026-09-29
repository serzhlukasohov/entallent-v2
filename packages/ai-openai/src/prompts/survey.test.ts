import { describe, expect, it } from 'vitest';
import { buildSurveySystemPrompt, buildSurveyUserPrompt } from './survey';

describe('survey evidence numeric ratings', () => {
  it('requires explicit 0-10 values without polarity inference', () => {
    const prompt = buildSurveySystemPrompt();

    expect(prompt).toContain('numericValue');
    expect(prompt).toContain('between 0 and 10 inclusive');
    expect(prompt).toContain('Never infer a rating from sentiment or polarity');
    expect(prompt).not.toContain('"numericValue": 7');
  });

  it('includes the question response type in evaluator input', () => {
    const prompt = buildSurveyUserPrompt(
      [{ role: 'user', content: 'Seven out of ten.', timestamp: new Date() }],
      [{
        id: 'q-1', stableKey: 'engagement_current',
        canonicalMeaning: 'Current engagement rating', responseType: 'numeric_0_10',
        positiveIndicators: [], negativeIndicators: [], contraindications: [],
      }],
    );

    expect(prompt).toContain('Response type: numeric_0_10');
  });

  it('limits V2 evidence to the latest employee message while retaining context', () => {
    const v2Prompt = buildSurveySystemPrompt({ focusLatestEmployeeMessage: true });
    expect(v2Prompt).toContain('latest employee message');
    expect(v2Prompt).toContain('Earlier turns are context only');
    expect(buildSurveySystemPrompt()).not.toContain('Earlier turns are context only');
  });
});
