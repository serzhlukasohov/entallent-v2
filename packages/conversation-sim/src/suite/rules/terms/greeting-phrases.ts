/**
 * Greeting and self-introduction phrases that restart a conversation already under way.
 * Matched as whole words, case-insensitive, in the first sentence of a reply only.
 * Suite data only: nothing outside `suite/` imports it (architecture AD-6).
 */
export const GREETING_PHRASES: readonly string[] = Object.freeze([
  'hi',
  'hello',
  'hey',
  'good morning',
  "I'm your coach",
  'my name is',
]);
