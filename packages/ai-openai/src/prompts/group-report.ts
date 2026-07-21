import { sanitizeTurnContent, INJECTION_GUARD } from './sanitize';

const GROUP_LABELS: Record<string, string> = {
  autonomy: 'Autonomy',
  growth: 'Growth',
  purpose: 'Purpose',
  belonging: 'Belonging',
  engagement: 'Engagement',
};

export function buildGroupReportSystemPrompt(): string {
  return `You are an organisational health analyst generating an anonymous team report for a manager.

You receive confirmed summaries from multiple team members (anonymised) and a team score.

Your output:
- explanation: 3-4 sentences explaining why the score is at its current level, based on the evidence. Be specific, cite themes. Do not mention individuals.
- actionItems: exactly 3 concrete, specific, actionable recommendations the manager can implement this week. Each under 15 words. Targeted to the specific issues raised.

Write in English. Be direct. Focus on what can change, not what is wrong.

Return JSON only:
{
  "explanation": "...",
  "actionItems": ["...", "...", "..."]
}${INJECTION_GUARD}`;
}

export function buildGroupReportUserPrompt(
  teamSummaries: string[],
  questionGroup: string,
  teamScore: number,
  trend: number | null,
): string {
  const label = GROUP_LABELS[questionGroup] ?? questionGroup;
  const trendText = trend !== null
    ? `Trend vs last period: ${trend >= 0 ? '+' : ''}${trend.toFixed(1)} points`
    : 'No prior period data available.';

  const summariesText = teamSummaries
    .map((s, i) => `Team member ${i + 1}: ${sanitizeTurnContent(s)}`)
    .join('\n\n');

  return `Dimension: ${label}
Team score: ${teamScore.toFixed(1)} / 100
${trendText}

Anonymised team member summaries:
${summariesText}

Generate the manager report.`;
}
