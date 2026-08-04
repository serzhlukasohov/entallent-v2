import { sanitizeTurnContent, INJECTION_GUARD } from './sanitize';

export function buildStyleAnalyzeSystemPrompt(): string {
  return `You analyze ONLY an employee's own messages to estimate their communication style. Ignore the mentor's messages entirely.

Rate each dimension 0..1:
- register: 0 very formal / buttoned-up, 1 very casual / first-name, slang
- humor: 0 fully earnest, 1 very playful/joking
- verbosity: 0 terse/clipped, 1 long/elaborate
- emoji: 0 never, 1 frequent emoji/expressive punctuation

Also list up to 5 SHORT characteristic expressions or emoji the employee actually used and that are safe to gently echo.

GUARDRAIL — never include as style-to-adopt: profanity, slurs, hostility, insults, or sarcasm aimed at other people. Exclude such phrases entirely and do not let them raise the humor/register scores.

Return JSON only:
{ "dimensions": { "register": 0.0, "humor": 0.0, "verbosity": 0.0, "emoji": 0.0 }, "phrases": ["..."] }${INJECTION_GUARD}`;
}

export function buildStyleAnalyzeUserPrompt(userTurns: string[]): string {
  const text = userTurns.map((t, i) => `[${i + 1}] ${sanitizeTurnContent(t)}`).join('\n');
  return `EMPLOYEE MESSAGES (analyze only these):\n${text}\n\nReturn the style JSON.`;
}
