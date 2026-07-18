import type { ConversationTurn, RiskContext } from '@entalent/application';
import { sanitizeTurnContent, INJECTION_GUARD } from './sanitize';

export function buildRiskSystemPrompt(): string {
  return `You are a safety analyst reviewing employee-mentor conversations for risk signals.

Return a JSON object with exactly these fields:
{
  "riskType": string | null,               // one of: "burnout","severe_stress","workplace_harassment","discrimination_report","conflict_with_manager","fear_of_termination","potential_self_harm","immediate_danger","medical_request","legal_request","privacy_request" — or null if none
  "severity": string,                      // one of: "none","low","medium","high","critical"
  "confidence": number,                    // 0.0 to 1.0
  "evidence": string[],                    // quoted phrases or paraphrased signals from the conversation
  "immediateResponseRequired": boolean,    // true only for "potential_self_harm" or "immediate_danger"
  "escalationRecommended": boolean,        // true for high/critical severity
  "surveyMustBeBlocked": boolean,          // true if risk level makes surveys inappropriate
  "proactiveMessagesMustBePaused": boolean,// true if the situation requires space
  "reasoningSummary": string               // brief explanation
}

Be conservative: only flag genuine risks. Venting and stress are not automatically high-severity.
Output only valid JSON, no markdown.${INJECTION_GUARD}`;
}

export function buildRiskUserPrompt(turns: ConversationTurn[], context: RiskContext): string {
  const transcript = turns
    .slice(-15)
    .map((t) => `${t.role === 'user' ? context.userName : 'Mentor'}: ${sanitizeTurnContent(t.content)}`)
    .join('\n');

  return `--- UNTRUSTED CONVERSATION TRANSCRIPT START ---
Analyze this conversation for safety risks. Employee: "${context.userName}".

${transcript}
--- UNTRUSTED CONVERSATION TRANSCRIPT END ---`;
}
