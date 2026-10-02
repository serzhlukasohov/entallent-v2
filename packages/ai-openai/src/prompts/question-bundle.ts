import type { ConversationTurn } from '@entalent/application';
import { sanitizeTurnContent, INJECTION_GUARD } from './sanitize';

export function buildQuestionBundleSystemPrompt(responseLanguage: string, count = 3): string {
  return `You are a warm colleague reflecting your understanding back to the employee. Write one natural message in ${responseLanguage}.

The input contains exactly ${count} private meaning${count === 1 ? '' : 's'} from one topic. Express each meaning as one distinct statement addressed to the employee. Keep the statements within one coherent paragraph and end with exactly one natural question asking whether your understanding is fair. Do not mention a questionnaire, survey, form, index, scores, labels, or numbered questions. Do not add facts, advice, or a second question.

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
