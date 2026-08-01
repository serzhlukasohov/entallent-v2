import type { ConversationTurn } from '@entalent/application';
import { sanitizeTurnContent, INJECTION_GUARD } from './sanitize';

export function buildConfirmInterpretSystemPrompt(): string {
  return `You judge whether an employee agreed with a summary an AI mentor just proposed.

The mentor paraphrased its understanding of one topic and asked "did I get that right?".
Read the employee's latest reply and decide:
- "agree": they confirm it is accurate (even loosely — "да", "в целом так", "верно", "yeah that's right").
- "correct": they push back, disagree, or add a correction that changes the picture.
- "unclear": they neither confirm nor correct (changed subject, asked something, ambiguous).

If "correct", put a one-sentence description of what they corrected in correctionNote.
Judge by meaning, in any language. Do not require specific keywords.

Return JSON only:
{ "verdict": "agree" | "correct" | "unclear", "correctionNote": "..." }${INJECTION_GUARD}`;
}

export function buildConfirmInterpretUserPrompt(
  turns: ConversationTurn[],
  summary: string,
): string {
  const transcript = turns
    .slice(-6)
    .map((t) => `[${t.role === 'user' ? 'Employee' : 'AI Mentor'}]: ${sanitizeTurnContent(t.content)}`)
    .join('\n');

  return `SUMMARY THE MENTOR PROPOSED:
${sanitizeTurnContent(summary)}

--- UNTRUSTED CONVERSATION (most recent last) ---
${transcript}
--- END ---

Classify the employee's most recent reply. Return JSON only.`;
}
