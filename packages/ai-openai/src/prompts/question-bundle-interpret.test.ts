import { describe, expect, it } from 'vitest';
import { buildQuestionBundleInterpretSystemPrompt, buildQuestionBundleInterpretUserPrompt } from './question-bundle-interpret';
import { buildQuestionClarificationInterpretSystemPrompt, buildQuestionClarificationInterpretUserPrompt } from './question-clarification';

// GC round 3 CAP-4: the delivered message answers the employee first; the interpreter must see
// the whole message so a "yes" to the answer part is not read as agreement with the confirmation.
const bundleText = 'I hear that you can choose your methods. Is that fair?';
const answer = 'Go with the retro notes first; the checklist can wait.';
const turns = [
  { role: 'user' as const, content: 'Retro notes or checklist first?', timestamp: new Date() },
  { role: 'assistant' as const, content: `${answer}\n\n${bundleText}`, timestamp: new Date() },
  { role: 'user' as const, content: 'yes, let us do that', timestamp: new Date() },
];

describe('question bundle interpret prompts with an answer before the confirmation', () => {
  it('shows the full delivered message next to the confirmation part', () => {
    const prompt = buildQuestionBundleInterpretUserPrompt(turns, {
      displayedText: bundleText,
      components: [{ surveyQuestionId: 'q-a', questionVersion: 'v2', statement: 'you can choose your methods.' }],
    });
    expect(prompt).toContain(answer);
    expect(prompt).toMatch(/full message the employee saw/i);
    expect(prompt.indexOf(answer)).toBeLessThan(prompt.indexOf('Latest employee reply'));
  });

  it('tells the interpreter that only the confirmation part can be agreed with', () => {
    expect(buildQuestionBundleInterpretSystemPrompt()).toMatch(/confirmation part/i);
  });
});

describe('question clarification interpret prompts with an answer before the question', () => {
  const clarification = { workingSummary: 'Can choose tasks.', disputedStatement: 'You can choose tasks.' };

  it('shows the full delivered message next to the disputed statement', () => {
    const prompt = buildQuestionClarificationInterpretUserPrompt(turns, clarification);
    expect(prompt).toContain(answer);
    expect(prompt).toMatch(/full message the employee saw/i);
  });

  it('tells the interpreter that a reply to the answer part is not a clarification', () => {
    expect(buildQuestionClarificationInterpretSystemPrompt()).toMatch(/answer part/i);
  });
});
