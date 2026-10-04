export interface V2CohortQuestionInput {
  id: string;
  userId: string;
  surveyWindowId: string;
  questionId: string;
  questionVersion: string;
  deidentifiedSummary: string;
  outcome: 'scored' | 'insufficient_evidence';
  score: number | null;
  scoringPolicyVersion: string;
  confirmedAt: Date;
}

export interface V2CohortReportScope {
  tenantId: string;
  reportingCohortId: string;
  teamId: string;
  surveyDefinitionId: string;
  periodStart: Date;
  periodEnd: Date;
  rosterUserIds: string[];
  policyVersion: string;
  requiredQuestionIds: string[];
  questionTitlesById: Record<string, string>;
  questionVersionsById: Record<string, string>;
  windowIdsByUser: Array<{ userId: string; windowId: string; policyVersion: string }>;
  questions: V2CohortQuestionInput[];
}

export type V2CohortReportInputSelection = {
  eligible: boolean;
  reason?: 'invalid_scope' | 'before_cutoff' | 'insufficient_contributors';
  requiredContributorCount: number;
  contributorUserIds: string[];
  scoredContributorUserIds: string[];
  questionInsightIds: string[];
  questions: V2CohortQuestionInput[];
};

/** No employee Index or manager payload is computed until the Product formula is approved. */
export function selectV2CohortReportInputs(
  scope: V2CohortReportScope | null,
  reportKind: 'intermediate' | 'final',
  now: Date,
): V2CohortReportInputSelection {
  const empty = (reason: NonNullable<V2CohortReportInputSelection['reason']>, requiredContributorCount = 5): V2CohortReportInputSelection => ({
    eligible: false, reason, requiredContributorCount, contributorUserIds: [], scoredContributorUserIds: [], questionInsightIds: [], questions: [],
  });
  if (!scope || !['intermediate', 'final'].includes(reportKind) || !Number.isFinite(now.getTime())) return empty('invalid_scope');
  const roster = new Set(scope.rosterUserIds);
  const required = new Set(scope.requiredQuestionIds);
  const requiredContributorCount = reportKind === 'intermediate'
    ? Math.max(5, Math.ceil(0.8 * scope.rosterUserIds.length)) : 5;
  if (!scope.tenantId || !scope.reportingCohortId || !scope.teamId || !scope.surveyDefinitionId
    || !scope.policyVersion.trim() || !Number.isFinite(scope.periodStart.getTime())
    || !Number.isFinite(scope.periodEnd.getTime()) || scope.periodEnd <= scope.periodStart
    || roster.size !== scope.rosterUserIds.length || roster.size < 5
    || required.size !== 3 || scope.requiredQuestionIds.some((id) => !id.trim()
      || !scope.questionTitlesById[id]?.trim() || !scope.questionVersionsById[id]?.trim())) return empty('invalid_scope', requiredContributorCount);
  if (reportKind === 'final' && now < scope.periodEnd) return empty('before_cutoff', requiredContributorCount);
  const windows = new Map<string, string>();
  for (const window of scope.windowIdsByUser) {
    if (!roster.has(window.userId) || !window.windowId || window.policyVersion !== scope.policyVersion
      || windows.has(window.userId)) return empty('invalid_scope', requiredContributorCount);
    windows.set(window.userId, window.windowId);
  }
  const seen = new Set<string>();
  for (const row of scope.questions) {
    const key = `${row.userId}:${row.questionId}`;
    if (!roster.has(row.userId) || windows.get(row.userId) !== row.surveyWindowId
      || !required.has(row.questionId) || seen.has(key)
      || !row.id || row.questionVersion !== scope.questionVersionsById[row.questionId]
      || !row.deidentifiedSummary.trim()
      || row.scoringPolicyVersion !== scope.policyVersion
      || !Number.isFinite(row.confirmedAt.getTime())
      || row.confirmedAt < scope.periodStart || row.confirmedAt >= scope.periodEnd
      || (row.outcome === 'scored'
        ? row.score === null || !Number.isInteger(row.score) || row.score < 0 || row.score > 100
        : row.outcome !== 'insufficient_evidence' || row.score !== null)) return empty('invalid_scope', requiredContributorCount);
    seen.add(key);
  }
  const rowsByUser = new Map<string, V2CohortQuestionInput[]>();
  for (const row of scope.questions) rowsByUser.set(row.userId, [...(rowsByUser.get(row.userId) ?? []), row]);
  const contributors = [...rowsByUser.entries()].filter(([, rows]) => reportKind === 'final'
    ? rows.length > 0
    : rows.length === 3 && rows.every((row) => row.outcome === 'scored'))
    .sort(([a], [b]) => a.localeCompare(b));
  if (contributors.length < requiredContributorCount) return empty('insufficient_contributors', requiredContributorCount);
  const questions = contributors.flatMap(([, rows]) => [...rows]
    .sort((a, b) => a.questionId.localeCompare(b.questionId)));
  return { eligible: true, requiredContributorCount,
    contributorUserIds: contributors.map(([id]) => id),
    scoredContributorUserIds: contributors.filter(([, rows]) => rows.some((row) => row.outcome === 'scored'))
      .map(([id]) => id), questionInsightIds: questions.map((row) => row.id), questions };
}
