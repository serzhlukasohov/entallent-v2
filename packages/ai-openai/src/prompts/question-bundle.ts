import type { BundleCompositionInvalidReason, ConversationTurn } from '@entalent/application';
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

const REPAIR_INSTRUCTIONS: Record<BundleCompositionInvalidReason, string> = {
  draft_unparseable: 'Your previous draft was not valid JSON. Return exactly the JSON object described above and nothing else.',
  text_missing: 'Your previous draft had no message text. Put the complete message shown to the employee in "text".',
  text_list_markers: 'Your previous draft used line breaks, numbering, or bullet characters. Write one flowing paragraph with no line breaks, numbers, or bullets.',
  questionnaire_label: 'Your previous draft mentioned a questionnaire, survey, form, index, scores, labels, or numbered questions. Remove every such word and speak as a colleague.',
  question_count: 'Your previous draft did not contain exactly one question mark. End with exactly one natural question and use no other question mark anywhere.',
  statements_missing: 'Your previous draft had no "statements" array. Return exactly one statement object per input id.',
  question_ids_invalid: 'Return exactly one statement object per input id, each with the "surveyQuestionId" copied from the input.',
  statement_count: 'Your previous draft did not return exactly one statement per input id. Return one statement object for each input id and no others.',
  statement_malformed: 'Your previous draft had a malformed statement entry. Each entry needs the "surveyQuestionId" copied from the input and a non-empty "statement".',
  statement_question: 'Your previous draft put a question mark inside a statement. Statements are plain declarative sentences; the only question is the closing one.',
  statement_not_in_text: 'Your previous draft had a statement that does not appear byte-for-byte exactly once in "text". Copy each statement verbatim from the message, exactly once.',
  question_mapping_invalid: 'Your previous draft did not map every input id to one distinct statement. Use each input id once with its own distinct statement.',
  statements_overlap: 'Your previous draft had statements that overlap in "text". Make each statement a separate span that does not share words with another statement.',
};

/** Appended to the system prompt for the one corrective recomposition; names the broken rule. */
export function buildQuestionBundleRepairInstruction(reason: BundleCompositionInvalidReason | undefined): string {
  const instruction = reason ? REPAIR_INSTRUCTIONS[reason] : 'Your previous draft broke the contract above. Follow every rule exactly.';
  return `\n\n${instruction}`;
}
