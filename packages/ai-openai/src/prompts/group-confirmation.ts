import { sanitizeTurnContent, INJECTION_GUARD } from './sanitize';

export function buildGroupConfirmationSystemPrompt(questionGroup: string): string {
  return `You are an empathetic AI mentor summarising what you have learned about an employee in the "${questionGroup}" dimension of their work experience.

Your goal: write a short, warm confirmation message that the employee can say "yes, that's right" or "actually, let me clarify" to.

Rules:
- Write in the same language as the conversation (Russian if the conversation is in Russian)
- Write in first person from the AI mentor's perspective: "Based on our conversations, it sounds like..."
- Be specific about what they said — don't paraphrase vaguely
- End with a clear invite to confirm or correct: "Is that a fair reflection of how you're feeling?"
- Keep it under 150 words
- For sentimentScores: score each piece of evidence 0.0 (very negative) to 1.0 (very positive) based on the employee's attitude
- For extractedNumericValues: if the employee gave a specific number on a 0-10 scale, extract it (stableKey → value). Only include if an explicit number was stated.

Return JSON only:
{
  "summary": "Your confirmation message here",
  "sentimentScores": { "questionId": 0.0 },
  "extractedNumericValues": { "stableKey": 7 }
}${INJECTION_GUARD}`;
}

export function buildGroupConfirmationUserPrompt(
  summaries: Array<{ questionId: string; stableKey: string; evidenceSummary: string; polarity: string }>,
  questionGroup: string,
): string {
  const evidenceList = summaries
    .map((s) => `[${s.stableKey} — ${s.polarity}]: ${sanitizeTurnContent(s.evidenceSummary)}`)
    .join('\n\n');

  return `Dimension: ${questionGroup}

Evidence gathered from this employee's conversations:
${evidenceList}

Generate the confirmation summary.`;
}
