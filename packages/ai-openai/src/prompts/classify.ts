import type { ConversationTurn, ClassifyContext } from '@entalent/application';
import { sanitizeTurnContent, INJECTION_GUARD } from './sanitize';

export function buildClassifySystemPrompt(): string {
  return `You are an expert analyst of employee-mentor conversations. Classify the situation based on the conversation transcript.

Return a JSON object with exactly these fields:
{
  "primaryIntent": string,       // one of: "support","coaching","goal_setting","progress_update","casual_conversation","clarification","survey_opportunity","conflict","burnout_signal","harassment_signal","potential_crisis","celebration","onboarding","feedback_request"
  "secondaryIntents": string[],  // zero or more of the same values
  "emotionalState": string[],    // descriptors like "stressed","excited","anxious","neutral","frustrated","hopeful"
  "urgency": string,             // one of: "low","medium","high","critical"
  "confidence": number,          // 0.0 to 1.0
  "requiresSafetyCheck": boolean,// true if potential self-harm, crisis, harassment, or immediate danger signals
  "surveyAllowed": boolean,      // false if user appears distressed, in crisis, or if topic is sensitive
  "reasoningSummary": string,    // 1-2 sentence explanation
  "reminderRequest": null,       // see reminder rules below; null unless explicitly requested
  "dialogueAct": string,         // one of: "new_substance","acknowledgement","continuation","correction","request","emotional_disclosure","closing"
  "latestUserSubstance": string|null, // what the latest employee message newly contributes; null for pure acknowledgements/backchannels
  "topicAnchor": string|null     // existing topic to continue when latestUserSubstance is null
}

Dialogue act rules:
- Classify the LATEST employee message's contribution, not their personality or writing style.
- Use "acknowledgement" for backchannels / minimal replies that add no new work substance ("ok", "yeah", "fine", "a bit", "sure", "thanks").
- Use "continuation" when the latest message continues a known topic with some new detail.
- Use "new_substance" when it introduces a new concrete fact, event, task, blocker, preference, or concern.
- Use "emotional_disclosure" when the latest message primarily discloses feelings or wellbeing.
- Use "request" for explicit asks to the mentor; "correction" for correcting the mentor; "closing" for ending/wrapping.
- Never infer impatience, hidden meaning, depth, or personality from brevity itself.
- When dialogueAct is "acknowledgement", latestUserSubstance MUST be null and topicAnchor should name the active topic from the prior turns.

Reminder detection:
- Set "reminderRequest" ONLY when the employee explicitly asks to be reminded of something ("remind me to…", "ping me when…", "don't let me forget to…").
- Never infer a reminder from a vague intention ("I should give them a call", "I want to get this done") — those are not reminder requests, keep reminderRequest null.
- When a reminder IS requested, return:
  {
    "intent": string,   // what to remind them about, phrased in the employee's own language
    "dueAt": string     // absolute ISO 8601 timestamp computed from the current time below
  }
- Interpret relative times ("tomorrow at 10", "in a week", "on Friday") against the current time and timezone provided in the prompt. If no time is given, default to the next morning (09:00 local).

Output only valid JSON, no markdown.${INJECTION_GUARD}`;
}

export function buildClassifyUserPrompt(turns: ConversationTurn[], context: ClassifyContext): string {
  const transcript = turns
    .slice(-15)
    .map((t) => `${t.role === 'user' ? context.userName : 'Mentor'}: ${sanitizeTurnContent(t.content)}`)
    .join('\n');

  const timeContext = context.now
    ? `Current time: ${context.now}${context.timezone ? ` (timezone: ${context.timezone})` : ' (timezone: UTC)'}\n`
    : '';

  return `${timeContext}--- UNTRUSTED CONVERSATION TRANSCRIPT START ---
Classify this conversation for employee "${context.userName}":

${transcript || '(no prior messages — this is the first message)'}
--- UNTRUSTED CONVERSATION TRANSCRIPT END ---`;
}
