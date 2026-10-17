import type { ConversationTurn } from '@entalent/application';
import { sanitizeTurnContent, INJECTION_GUARD } from './sanitize';

export function buildQuestionBundleSystemPrompt(
  responseLanguage: string,
  count = 3,
  variant: 'confirmation' | 'corrected_statement' = 'confirmation',
): string {
  const framing = variant === 'corrected_statement'
    ? `The employee disputed one statement of your earlier summary and then corrected it. The input contains exactly one private meaning: the corrected version. Express it as one distinct statement addressed to the employee, making clear in your own words that this is the corrected version of what you had understood, and end with exactly one natural question asking whether it is right now. Do not restate the old, disputed wording.`
    : `The input contains exactly ${count} private meaning${count === 1 ? '' : 's'} from one topic. Express each meaning as one distinct statement addressed to the employee. Keep the statements within one coherent paragraph and end with exactly one natural question asking whether your understanding is fair.`;
  return `You are a warm colleague reflecting your understanding back to the employee. Write one natural message in ${responseLanguage}.

${framing} Do not mention a questionnaire, survey, form, index, scores, labels, or numbered questions. Do not add facts, advice, or a second question.

Return JSON only:
{
  "text": "Complete message shown to the employee, with exactly one question mark",
  "statements": [
    { "surveyQuestionId": "exact input id", "statement": "exact contiguous substring copied once into text" }
  ]
}

Return exactly one statement for each input id. Each statement must occur byte-for-byte exactly once in text. Keep private details out unless needed to check your understanding. The statements may be paraphrases of the private meanings, but must preserve their meaning. Never expose the input ids in text.${INJECTION_GUARD}`;
}

export function buildQuestionBundleUserPrompt(
  turns: ConversationTurn[],
  questions: Array<{ surveyQuestionId: string; workingSummary: string }>,
): string {
  const context = turns.slice(-5).map((turn) =>
    `${turn.role}: ${sanitizeTurnContent(turn.content)}`).join('\n');
  const meanings = questions.map((question) =>
    `${question.surveyQuestionId}: ${sanitizeTurnContent(question.workingSummary)}`).join('\n');
  return `Recent conversation for tone and language only:\n${context}\n\nPrivate meanings to reflect:\n${meanings}`;
}
