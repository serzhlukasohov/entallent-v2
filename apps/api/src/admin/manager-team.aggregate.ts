import type { AdminManagerTeamEmployee, AdminManagerTeamQuestionSignal } from '@entalent/contracts';

export type QuestionSignal = AdminManagerTeamQuestionSignal;
export type EmployeeRow = AdminManagerTeamEmployee;

export interface TeamUserInput {
  id: string;
  displayName: string | null;
}
export interface LastMessageInput {
  userId: string;
  occurredAt: Date;
}
export interface AssessmentInput {
  userId: string;
  windowId: string;
  questionId: string;
  stableKey: string;
  title: string;
  dimension: string;
  assessmentStatus: string;
}
export interface EvidenceInput {
  userId: string;
  questionId: string;
  polarity: string;
  strength: string | number;
  confidence: string | number;
  evidenceSummary: string;
}
export interface PreviousWindowInput {
  userId: string;
  windowId: string;
  completedAt: Date | null;
}

export interface BuildEmployeeRowsInput {
  teamUsers: TeamUserInput[];
  lastMessages: LastMessageInput[];
  activeRiskUserIds: Array<{ userId: string }>;
  /** All assessments in active windows for these users */
  assessments: AssessmentInput[];
  /** Active (non-superseded) evidence, ordered by strength DESC */
  evidence: EvidenceInput[];
  /** Latest closed window with assessments for each user */
  previousWindows: PreviousWindowInput[];
  previousAssessments: AssessmentInput[];
  /** Active evidence from the selected closed windows, ordered by strength DESC */
  previousEvidence: EvidenceInput[];
}

/** Statuses that count as "we have a usable read on this question" */
const COVERED_STATUSES = new Set(['scored', 'partially_covered']);

/**
 * Pure aggregation for the manager team view. Turns the raw query results into
 * per-employee rows: attaches the strongest evidence to each assessed question,
 * computes coverage, and sorts risk-first then by coverage. Kept separate from
 * the controller so the logic is unit-testable without a database.
 */
export function buildEmployeeRows(input: BuildEmployeeRowsInput): EmployeeRow[] {
  const lastActiveMap = new Map(input.lastMessages.map((m) => [m.userId, m.occurredAt]));
  const riskSet = new Set(input.activeRiskUserIds.map((r) => r.userId));
  const previousWindowMap = new Map(input.previousWindows.map((window) => [window.userId, window]));

  const assessmentsByUser = groupAssessments(input.assessments);
  const previousAssessmentsByUser = groupAssessments(input.previousAssessments);
  const bestEvidence = indexEvidence(input.evidence);
  const previousBestEvidence = indexEvidence(input.previousEvidence);

  const employees: EmployeeRow[] = input.teamUsers.map((user) => {
    const current = buildInsightSummary(user.id, assessmentsByUser, bestEvidence);
    const previousWindow = previousWindowMap.get(user.id);
    const lastActive = lastActiveMap.get(user.id);

    return {
      userId: user.id,
      displayName: user.displayName ?? user.id,
      lastActiveAt: lastActive ? lastActive.toISOString() : null,
      hasActiveRisk: riskSet.has(user.id),
      ...current,
      previousWindow: previousWindow
        ? {
            completedAt: previousWindow.completedAt?.toISOString() ?? null,
            ...buildInsightSummary(user.id, previousAssessmentsByUser, previousBestEvidence),
            surveyWindowId: previousWindow.windowId,
          }
        : null,
    };
  });

  // Risk first, then higher coverage first
  employees.sort((a, b) => {
    if (a.hasActiveRisk !== b.hasActiveRisk) return a.hasActiveRisk ? -1 : 1;
    return b.coveragePct - a.coveragePct;
  });

  return employees;
}

function groupAssessments(rows: AssessmentInput[]): Map<string, AssessmentInput[]> {
  const byUser = new Map<string, AssessmentInput[]>();
  for (const row of rows) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }
  return byUser;
}

function indexEvidence(rows: EvidenceInput[]): Map<string, EvidenceInput> {
  const best = new Map<string, EvidenceInput>();
  for (const row of rows) {
    const key = `${row.userId}:${row.questionId}`;
    if (!best.has(key)) best.set(key, row);
  }
  return best;
}

function buildInsightSummary(
  userId: string,
  assessmentsByUser: Map<string, AssessmentInput[]>,
  bestEvidence: Map<string, EvidenceInput>,
) {
  const assessments = assessmentsByUser.get(userId) ?? [];
  const scoredCount = assessments.filter((assessment) => COVERED_STATUSES.has(assessment.assessmentStatus)).length;
  const totalQuestions = assessments.length;
  const signals: QuestionSignal[] = assessments
    .map((assessment) => {
      const evidence = bestEvidence.get(`${userId}:${assessment.questionId}`);
      return {
        stableKey: assessment.stableKey,
        title: assessment.title,
        dimension: assessment.dimension,
        assessmentStatus: assessment.assessmentStatus,
        polarity: evidence?.polarity ?? null,
        strength: evidence ? Number(evidence.strength) : null,
        confidence: evidence ? Number(evidence.confidence) : null,
        evidenceSummary: evidence?.evidenceSummary ?? null,
      };
    })
    .sort((a, b) => a.stableKey.localeCompare(b.stableKey));

  return {
    surveyWindowId: assessments[0]?.windowId ?? null,
    scoredCount,
    totalQuestions,
    coveragePct: totalQuestions > 0 ? Math.round((scoredCount / totalQuestions) * 100) : 0,
    signals,
  };
}
