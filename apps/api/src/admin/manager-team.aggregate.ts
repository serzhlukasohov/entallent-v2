export interface QuestionSignal {
  stableKey: string;
  title: string;
  dimension: string;
  assessmentStatus: string;
  polarity: string | null;
  strength: number | null;
  confidence: number | null;
  evidenceSummary: string | null;
}

export interface EmployeeRow {
  userId: string;
  displayName: string;
  lastActiveAt: string | null;
  hasActiveRisk: boolean;
  surveyWindowId: string | null;
  scoredCount: number;
  totalQuestions: number;
  coveragePct: number;
  signals: QuestionSignal[];
}

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

export interface BuildEmployeeRowsInput {
  teamUsers: TeamUserInput[];
  lastMessages: LastMessageInput[];
  activeRiskUserIds: Array<{ userId: string }>;
  /** All assessments in active windows for these users */
  assessments: AssessmentInput[];
  /** Active (non-superseded) evidence, ordered by strength DESC */
  evidence: EvidenceInput[];
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

  const assessmentsByUser = new Map<string, AssessmentInput[]>();
  for (const row of input.assessments) {
    const list = assessmentsByUser.get(row.userId) ?? [];
    list.push(row);
    assessmentsByUser.set(row.userId, list);
  }

  // Best evidence per (userId, questionId). Evidence is pre-ordered by strength
  // DESC, so the first one seen for a key is the strongest.
  const bestEvidence = new Map<string, EvidenceInput>();
  for (const ev of input.evidence) {
    const key = `${ev.userId}:${ev.questionId}`;
    if (!bestEvidence.has(key)) bestEvidence.set(key, ev);
  }

  const employees: EmployeeRow[] = input.teamUsers.map((user) => {
    const assessments = assessmentsByUser.get(user.id) ?? [];
    const windowId = assessments[0]?.windowId ?? null;
    const totalQuestions = assessments.length;
    const scoredCount = assessments.filter((a) => COVERED_STATUSES.has(a.assessmentStatus)).length;

    const signals: QuestionSignal[] = assessments
      .map((a) => {
        const ev = bestEvidence.get(`${user.id}:${a.questionId}`);
        return {
          stableKey: a.stableKey,
          title: a.title,
          dimension: a.dimension,
          assessmentStatus: a.assessmentStatus,
          polarity: ev?.polarity ?? null,
          strength: ev ? Number(ev.strength) : null,
          confidence: ev ? Number(ev.confidence) : null,
          evidenceSummary: ev?.evidenceSummary ?? null,
        };
      })
      .sort((a, b) => a.stableKey.localeCompare(b.stableKey));

    const lastActive = lastActiveMap.get(user.id);

    return {
      userId: user.id,
      displayName: user.displayName ?? user.id,
      lastActiveAt: lastActive ? lastActive.toISOString() : null,
      hasActiveRisk: riskSet.has(user.id),
      surveyWindowId: windowId,
      scoredCount,
      totalQuestions,
      coveragePct: totalQuestions > 0 ? Math.round((scoredCount / totalQuestions) * 100) : 0,
      signals,
    };
  });

  // Risk first, then higher coverage first
  employees.sort((a, b) => {
    if (a.hasActiveRisk !== b.hasActiveRisk) return a.hasActiveRisk ? -1 : 1;
    return b.coveragePct - a.coveragePct;
  });

  return employees;
}
