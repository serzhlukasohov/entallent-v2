import type {
  V2CohortQuestionInput, V2CohortReportInputSelection, V2CohortReportScope,
} from './select-v2-cohort-report-inputs.use-case';

export const V2_REPORT_CALCULATION_VERSION = 'equal-weight-1.0.0';
// Set to the reviewed decision packet ID only after Product approval.
export const V2_REPORT_APPROVED_DECISION_ID: string | null = null;

export interface V2IndexReport {
  questionGroup: string;
  message: string;
  contributorUserIds: string[];
  sourceQuestionInsightIds: string[];
  sourceQuestionInsightIdsByUser: Record<string, string[]>;
  policyVersion: string;
  calculationVersion: typeof V2_REPORT_CALCULATION_VERSION;
}

/** Proposed MVP calculation; keep production delivery disabled until Product approves it. */
export function buildV2IndexReport(input: {
  scope: V2CohortReportScope;
  selection: V2CohortReportInputSelection;
  questionGroup: string;
  reportKind: 'intermediate' | 'final';
}): V2IndexReport | null {
  const { scope, selection, questionGroup, reportKind } = input;
  if (!selection.eligible || !questionGroup.trim()) return null;
  const byUser = new Map<string, V2CohortQuestionInput[]>();
  for (const row of selection.questions) {
    if (row.outcome !== 'scored' || row.score === null) continue;
    byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
  }
  const complete = [...byUser].filter(([, rows]) => rows.length === 3
    && new Set(rows.map((row) => row.questionId)).size === 3);
  const indexContributors = complete.length >= selection.requiredContributorCount ? complete : [];
  const indexScore = indexContributors.length
    ? indexContributors.reduce((sum, [, rows]) => sum + rows.reduce((total, row) => total + row.score!, 0) / 3, 0)
      / indexContributors.length : null;
  const questionScores = scope.requiredQuestionIds.flatMap((id) => {
    const rows = selection.questions.filter((row) => row.questionId === id && row.outcome === 'scored');
    if (rows.length < (reportKind === 'intermediate' ? selection.requiredContributorCount : 5)) return [];
    return [{ id, title: scope.questionTitlesById[id]!, rows,
      score: rows.reduce((sum, row) => sum + row.score!, 0) / rows.length }];
  });
  if (indexScore === null && questionScores.length === 0) return null;

  const shownRows = [...new Map([
    ...indexContributors.flatMap(([, rows]) => rows),
    ...questionScores.flatMap((question) => question.rows),
  ].map((row) => [row.id, row])).values()];
  const contributorUserIds = [...new Set(shownRows.map((row) => row.userId))].sort();
  const sourceQuestionInsightIdsByUser = Object.fromEntries(contributorUserIds.map((userId) => [
    userId, shownRows.filter((row) => row.userId === userId).map((row) => row.id).sort(),
  ]));
  const title = questionGroup.charAt(0).toUpperCase() + questionGroup.slice(1);
  const lines = [`${title} team report${reportKind === 'final' ? ' — final' : ''}`];
  if (indexScore !== null) lines.push(`Index: ${indexScore.toFixed(1)}/100 (${indexContributors.length} contributors)`);
  for (const question of questionScores) {
    lines.push(`${question.title}: ${question.score.toFixed(1)}/100 (${question.rows.length} contributors)`);
  }
  lines.push('Team action: Discuss the lowest-scoring topic together and agree on one practical improvement.');
  return {
    questionGroup, message: lines.join('\n'), contributorUserIds,
    sourceQuestionInsightIds: shownRows.map((row) => row.id).sort(),
    sourceQuestionInsightIdsByUser,
    policyVersion: scope.policyVersion,
    calculationVersion: V2_REPORT_CALCULATION_VERSION,
  };
}
