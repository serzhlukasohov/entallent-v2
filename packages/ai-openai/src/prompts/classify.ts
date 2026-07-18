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
  "reminderRequest": null        // see reminder rules below; null unless explicitly requested
}

Reminder detection:
- Set "reminderRequest" ONLY when the employee explicitly asks to be reminded of something ("напомни мне…", "remind me to…", "ping me when…", "не дай забыть…").
- Never infer a reminder from a vague intention ("надо бы созвониться", "хочу это сделать") — those are not reminder requests, keep reminderRequest null.
- When a reminder IS requested, return:
  {
    "intent": string,   // what to remind them about, phrased in the employee's own language
    "dueAt": string     // absolute ISO 8601 timestamp computed from the current time below
  }
- Interpret relative times ("завтра в 10", "через неделю", "в пятницу") against the current time and timezone provided in the prompt. If no time is given, default to the next morning (09:00 local).

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
