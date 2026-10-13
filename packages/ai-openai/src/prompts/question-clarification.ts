import type { ConversationTurn, PendingQuestionClarification } from '@entalent/application';
import { sanitizeTurnContent, INJECTION_GUARD } from './sanitize';

type ClarificationContext = Pick<PendingQuestionClarification, 'workingSummary' | 'disputedStatement'>;

export function buildQuestionClarificationSystemPrompt(responseLanguage: string): string {
  return `You are a warm colleague. The employee disputed one part of your understanding. Ask exactly one short, natural follow-up question in ${responseLanguage} to understand what you missed about that part. Do not display a new full summary and do not ask for another yes/no confirmation. Do not mention a questionnaire, survey, form, index, score, labels, or numbered questions. Do not add advice or facts.

Return JSON only: {"text":"one natural question"}.${INJECTION_GUARD}`;
}

export function buildQuestionClarificationUserPrompt(
  turns: ConversationTurn[],
  clarification: ClarificationContext,
): string {
  const latestUser = [...turns].reverse().find((turn) => turn.role === 'user')?.content ?? '';
  return `Disputed statement previously shown: ${sanitizeTurnContent(clarification.disputedStatement)}\nPrivate working meaning: ${sanitizeTurnContent(clarification.workingSummary)}\nLatest employee reply: ${sanitizeTurnContent(latestUser)}`;
}

export function buildQuestionClarificationInterpretSystemPrompt(): string {
  return `Interpret the employee's latest reply to one delivered clarification question. Return exactly one JSON object:
- {"kind":"clarified","correctedSummary":"self-contained meaning in the employee's language"} only when the employee gives substantive new meaning that corrects or fills the disputed part. Preserve the employee's meaning without unsupported details. This answer authorizes the corrected meaning; no second bundle confirmation is needed.
- {"kind":"declined"} only when the employee explicitly asks to skip, exclude, or stop discussing this meaning.
- {"kind":"unrelated"} for silence, ambiguity, unrelated messages, or a reply that provides no substantive correction. Never infer a negative finding or refusal from absence or brevity.

Judge in any language. Use the latest employee reply, not older turns, as the authorization source. Return JSON only.${INJECTION_GUARD}`;
}

export function buildQuestionClarificationInterpretUserPrompt(
  turns: ConversationTurn[],
  clarification: ClarificationContext,
): string {
  const latestUser = [...turns].reverse().find((turn) => turn.role === 'user')?.content ?? '';
  return `Previously disputed statement: ${sanitizeTurnContent(clarification.disputedStatement)}\nPrivate working meaning: ${sanitizeTurnContent(clarification.workingSummary)}\nLatest employee reply after the delivered follow-up: ${sanitizeTurnContent(latestUser)}`;
}
