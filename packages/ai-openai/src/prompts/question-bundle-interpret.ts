import type { ConversationTurn, AwaitingQuestionBundle } from '@entalent/application';
import { sanitizeTurnContent, INJECTION_GUARD } from './sanitize';

export function buildQuestionBundleInterpretSystemPrompt(count = 3): string {
  return `Interpret the employee's latest reply to a displayed confirmation message. The confirmation has ${count} separately mapped meaning${count === 1 ? '' : 's'}. Decide by meaning in any language, not keywords.

Return one JSON object:
- {"kind":"agree"} only for an unqualified agreement with all displayed meanings.
- {"kind":"reject"} only when the employee rejects the entire understanding and wants it discarded. This resets all displayed meanings.
- {"kind":"partial","acceptedQuestionIds":[],"disputedQuestionIds":[],"declinedQuestionIds":[]} when the employee accepts, disputes, or explicitly asks to skip individual meanings. Include every input question id exactly once across the three arrays. A disputed meaning needs clarification; a declined meaning must not be raised again in this cycle.
- {"kind":"unrelated"} when the reply is unrelated, ambiguous, or does not authorize any of the above. Silence is unrelated, never refusal.

Do not infer negative sentiment or refusal from brevity. An employee saying a meaning is inaccurate is a dispute, not a decline. Do not fabricate ids or decide from older conversation turns. Return JSON only.${INJECTION_GUARD}`;
}

export function buildQuestionBundleInterpretUserPrompt(
  turns: ConversationTurn[],
  bundle: Pick<AwaitingQuestionBundle, 'displayedText' | 'components'>,
): string {
  const statements = bundle.components.map((component) =>
    `${component.surveyQuestionId}: ${sanitizeTurnContent(component.statement)}`).join('\n');
  const latestUser = [...turns].reverse().find((turn) => turn.role === 'user')?.content ?? '';
  return `Displayed confirmation:\n${sanitizeTurnContent(bundle.displayedText)}\n\nMapped meanings:\n${statements}\n\nLatest employee reply:\n${sanitizeTurnContent(latestUser)}`;
}
