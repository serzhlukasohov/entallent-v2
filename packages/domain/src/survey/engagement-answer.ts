/** A literal reply, never a sentiment-derived score. Restrict the whole reply to one rating. */
export function parseLiteralEngagementAnswer(text: string): number | null {
  const match = /^(10|[1-9])(?:\s*\/\s*10)?[.!]?$/u.exec(text.trim());
  return match ? Number(match[1]) : null;
}
