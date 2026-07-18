import type { ConversationTurn, SurveyQuestionForEvaluation } from '@entalent/application';
import { sanitizeTurnContent, INJECTION_GUARD } from './sanitize';

export function buildSurveySystemPrompt(): string {
  return `You are an impartial survey evidence analyst for an employee engagement platform.

Analyze a conversation transcript to identify evidence relevant to specific survey questions about the employee's work experience, wellbeing, and engagement.

Evidence extraction rules:
- Only extract evidence the employee has directly expressed or clearly implied
- Never infer from absence of topics — silence is not evidence
- polarity: "positive" if the evidence indicates a good outcome, "negative" if bad, "neutral" if factual/ambiguous, "mixed" if contains both
- strength (0–1): clarity of the signal (0.1 = vague hint, 1.0 = explicit clear statement)
- completeness (0–1): how fully the conversation addresses the question (0.1 = brief mention, 1.0 = thorough discussion)
- confidence (0–1): your confidence this evidence is relevant and accurately extracted
- followUpProbeNeeded: true if partial evidence exists that a targeted follow-up question would clarify
- thresholdReached: true when completeness ≥ 0.70 AND confidence ≥ 0.75 simultaneously
- assessmentShouldRemainUnknown: true when there is NO relevant signal at all, or when a contraindication is present (e.g. employee in crisis, actively distressed, discussing the contraindication topic)

evidenceSummary — write a self-contained insight (2-4 sentences) that a manager can read months later without the conversation and fully understand:
1. What the employee said or revealed (the concrete fact or pattern)
2. The situational or emotional context that makes it meaningful
3. What this signals about their experience relevant to this question
Write in the same language as the conversation (Russian if the conversation is in Russian). Do not quote verbatim — synthesize. Do not start with "The employee said" — lead with the substance.

Important:
- Only include a question in evidence[] if there IS a signal — omit questions with no relevant content
- If a question's contraindications are active, always set assessmentShouldRemainUnknown=true
- candidateQuestionIds must list every question ID that has any signal (matches evidence[])

Return JSON only:
{
  "candidateQuestionIds": ["id1", "id2"],
  "evidence": [
    {
      "questionId": "uuid",
      "evidenceSummary": "Self-contained insight in the conversation's language",
      "polarity": "positive|negative|neutral|mixed",
      "strength": 0.0,
      "completeness": 0.0,
      "confidence": 0.0,
      "followUpProbeNeeded": false,
      "thresholdReached": false,
      "assessmentShouldRemainUnknown": false
    }
  ]
}${INJECTION_GUARD}`;
}

export function buildSurveyUserPrompt(
  turns: ConversationTurn[],
  questions: SurveyQuestionForEvaluation[],
): string {
  const transcript = turns
    .slice(-20)
    .map((t) => `[${t.role === 'user' ? 'Employee' : 'AI Mentor'}]: ${sanitizeTurnContent(t.content)}`)
    .join('\n');

  const questionList = questions
    .map(
      (q) => `
Question ID: ${q.id}
Stable key: ${q.stableKey}
What it measures: ${q.canonicalMeaning}
Positive signals to look for: ${q.positiveIndicators.length ? q.positiveIndicators.join('; ') : 'none specified'}
Negative signals to look for: ${q.negativeIndicators.length ? q.negativeIndicators.join('; ') : 'none specified'}
Contraindications (assessment invalid if present): ${q.contraindications.length ? q.contraindications.join('; ') : 'none'}`,
    )
    .join('\n---');

  return `SURVEY QUESTIONS TO EVALUATE:
${questionList}

--- UNTRUSTED CONVERSATION TRANSCRIPT START ---
${transcript}
--- UNTRUSTED CONVERSATION TRANSCRIPT END ---

Analyze the transcript for evidence relevant to each question. Return JSON only.`;
}
