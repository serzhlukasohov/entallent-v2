/**
 * Internal product vocabulary a coach reply must not show the employee. Matched as whole
 * words, case-insensitive, singular or plural. Suite data only: nothing outside `suite/`
 * imports it (architecture AD-6).
 */
export const INTERNAL_TERMS: readonly string[] = Object.freeze([
  'topic',
  'topics',
  'index',
  'indexes',
  'pulse',
  'pulses',
  'cycle',
  'cycles',
]);
