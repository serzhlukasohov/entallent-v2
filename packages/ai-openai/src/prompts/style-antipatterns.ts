/**
 * Reflective "verdict-on-their-words" opener patterns — the formulaic way the model
 * opens a reply by labeling/characterizing what the employee just said instead of
 * leading with substance ("That's starting to sound like…", "Sounds like…", "What
 * you're describing is…"). Single source of truth for both the runtime gate and evals.
 * Matched ONLY against the reply's first sentence/line.
 */
export const OPENER_ANTIPATTERNS: RegExp[] = [
  /^that(?:'s|\s+is)?\s+(?:already\s+|starting\s+to\s+)?sound(?:s|ing)?\s+like\b/i,
  /^(?:it\s+)?sounds\s+like\b/i,
  /^(?:it\s+)?seems\s+like\b/i,
  /^what\s+you(?:'re|\s+are)\s+(?:describing|saying)\b/i,
  /^so,?\s+(?:what\s+)?you(?:'re|\s+are)\s+saying\b/i,
  /^that,\s+it\s+seems,\s+is\b/i,
  /^that(?:'s|\s+is)\s+(?:really\s+|probably\s+)?(?:the\s+)?(?:real\s+)?(?:root|core|crux|heart|problem|issue)\b/i,
];

/** True if the reply OPENS with a reflective label on the user's own words. */
export function hasReflectiveOpener(text: string): boolean {
  if (!text) return false;
  const firstLine = text.trimStart().split(/(?<=[.!?…])\s|\n/)[0] ?? '';
  const opener = firstLine.trim();
  return OPENER_ANTIPATTERNS.some((re) => re.test(opener));
}
