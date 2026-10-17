import type { ConversationTurn, AwaitingQuestionBundle } from '@entalent/application';
import { sanitizeTurnContent, INJECTION_GUARD } from './sanitize';

export function buildQuestionBundleInterpretSystemPrompt(count = 3): string {
  return `Interpret the employee's latest reply to a displayed confirmation message. The confirmation has ${count} separately mapped meaning${count === 1 ? '' : 's'}. Decide by meaning in any language, not keywords.

Return one JSON object:
- {"kind":"agree"} only for an unqualified agreement with all displayed meanings.
- {"kind":"reject"} only when the employee rejects the entire understanding and wants it discarded. This resets all displayed meanings.
- {"kind":"partial","acceptedQuestionIds":[],"disputedQuestionIds":[],"declinedQuestionIds":[]} when the employee accepts, disputes, or explicitly asks to skip individual meanings. Include every input question id exactly once across the three arrays. A disputed meaning needs clarification; a declined meaning must not be raised again in this cycle.
- {"kind":"unrelated"} when the reply is unrelated, ambiguous, or does not authorize any of the above. Silence is unrelated, never refusal.

Do not infer negative sentiment or refusal from brevity. An employee saying a meaning is inaccurate is a dispute, not a decline. Do not fabricate ids or decide from older conversation turns.

The delivered message may begin with an answer to the employee's previous message; only its final confirmation part can be agreed with, disputed, or declined. A reply that addresses only the answer part (for example accepting a suggestion made there) is unrelated. Return JSON only.${INJECTION_GUARD}`;
}

export function buildQuestionBundleInterpretUserPrompt(
  turns: ConversationTurn[],
  bundle: Pick<AwaitingQuestionBundle, 'displayedText' | 'components'>,
): string {
  const statements = bundle.components.map((component) =>
    `${component.surveyQuestionId}: ${sanitizeTurnContent(component.statement)}`).join('\n');
  const latestUser = [...turns].reverse().find((turn) => turn.role === 'user')?.content ?? '';
  const delivered = deliveredMessageBlock(turns, bundle.displayedText);
  return `Displayed confirmation (the confirmation part):\n${sanitizeTurnContent(bundle.displayedText)}${delivered}\n\nMapped meanings:\n${statements}\n\nLatest employee reply:\n${sanitizeTurnContent(latestUser)}`;
}

/** The whole message the employee saw when it carried an answer before the fixed text (GC round 3 CAP-4). */
export function deliveredMessageBlock(turns: ConversationTurn[], fixedText: string): string {
  const latestUserIndex = turns.map((turn) => turn.role).lastIndexOf('user');
  const prior = [...turns.slice(0, Math.max(latestUserIndex, 0))].reverse().find((turn) => turn.role === 'assistant');
  if (!prior || prior.content === fixedText || !prior.content.includes(fixedText)) return '';
  return `\n\nFull message the employee saw (its final part is the fixed text above):\n${sanitizeTurnContent(prior.content)}`;
}
