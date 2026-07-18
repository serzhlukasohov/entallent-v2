/**
 * Overlap coefficient over word tokens: |A ∩ B| / min(|A|, |B|).
 * Chosen over Jaccard because re-extracted facts are often subsets of each
 * other ("does small fixes" vs "does small fixes instead of larger work") —
 * the min-denominator catches those as near-duplicates.
 */
export function contentSimilarity(a: string, b: string): number {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  return intersection / Math.min(ta.size, tb.size);
}

const STOPWORDS = new Set([
  // English filler common in extractor summaries
  'the', 'and', 'that', 'this', 'with', 'they', 'their', 'them', 'has', 'have',
  'are', 'was', 'were', 'which', 'says', 'said', 'employee', 'currently', 'now',
  'not', 'but', 'for', 'from', 'about', 'like', 'such', 'also', 'when', 'what',
  // Russian filler
  'это', 'что', 'как', 'его', 'она', 'оно', 'они', 'для', 'при', 'если',
]);

function tokenSet(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      // naive plural/inflection folding so "releases" matches "release"
      .map((w) => (w.length > 4 ? w.replace(/(?:es|s|ing|ed)$/u, '') : w)),
  );
}
