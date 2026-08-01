/**
 * Reflective "verdict-on-their-words" opener patterns — the formulaic way the model
 * opens a reply by labeling/characterizing what the employee just said instead of
 * leading with substance ("Вот это уже звучит как…", "Звучит как…", "То, что ты
 * описываешь — это…"). Single source of truth for both the runtime gate and evals.
 * Matched ONLY against the reply's first sentence/line.
 */
export const OPENER_ANTIPATTERNS: RegExp[] = [
  /^вот это(?:\s|,)/i,
  /^(?:ну\s+)?это\s+(?:уже\s+)?звучит\s+как/i,
  /^звучит\s+как/i,
  /^похоже,/i,
  /^то,?\s*что\s+ты\s+(?:опис|говор|расск)/i,
  /^получается,\s*(?:что\s+)?ты(?:\s|$)/i,
];

/** True if the reply OPENS with a reflective label on the user's own words. */
export function hasReflectiveOpener(text: string): boolean {
  if (!text) return false;
  const firstLine = text.trimStart().split(/(?<=[.!?…])\s|\n/)[0] ?? '';
  const opener = firstLine.trim();
  return OPENER_ANTIPATTERNS.some((re) => re.test(opener));
}
