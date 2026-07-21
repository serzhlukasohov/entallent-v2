const STRUCTURED_WEIGHT = 0.7;
const SENTIMENT_WEIGHT = 0.3;

const POLARITY_STRUCTURED: Record<string, number> = {
  positive: 1.0,
  neutral: 0.5,
  negative: 0.0,
};

export function computeEngagementIndex(q1: number, q2: number, q3: number): number {
  return Math.round(((q1 + q2 + q3) / 3) * 10 * 100) / 100;
}

export function computeOpenEndedQuestionScore(
  polarity: string,
  sentimentScore: number,
): number {
  const structured = POLARITY_STRUCTURED[polarity] ?? 0.5;
  const raw = STRUCTURED_WEIGHT * structured + SENTIMENT_WEIGHT * sentimentScore;
  return Math.min(1, Math.max(0, raw));
}

export function computeGroupIndex(questionScores: number[]): number {
  if (questionScores.length === 0) return 0;
  const mean = questionScores.reduce((a, b) => a + b, 0) / questionScores.length;
  return Math.round(mean * 100 * 100) / 100;
}
