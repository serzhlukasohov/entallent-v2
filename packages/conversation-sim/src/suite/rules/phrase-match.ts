/**
 * The phrases of `phrases` that occur in `text` as whole words, case-insensitive, in list
 * order. Inner spaces match any whitespace and a typographic apostrophe matches `'`.
 */
export function findPhrases(text: string, phrases: readonly string[]): string[] {
  const normalized = text.replace(/[‘’]/g, "'");
  return phrases.filter((phrase) => phrasePattern(phrase).test(normalized));
}

function phrasePattern(phrase: string): RegExp {
  const body = phrase
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?<!\\p{L}')${body}(?![\\p{L}\\p{N}])`, 'iu');
}
