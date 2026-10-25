import {
  systemClock,
  type ClockPort,
  type PulseBacklogService,
  type SaveSurveyEvidenceParams,
  type SurveyEvidenceRecord,
  type SurveyGroupStateRecord,
  type SurveyQuestionRecord,
  type SurveyRepositoryPort,
  type SurveyWindowRecord,
  type UpsertAssessmentParams,
  type UpsertGroupStateParams,
} from '@entalent/application';

/** The assessment statuses that close a question for topic selection (survey-evidence use case). */
const COMPLETED_ASSESSMENT_STATUSES = new Set(['partially_covered', 'covered', 'scored']);

interface StoredEvidence extends SurveyEvidenceRecord {
  superseded: boolean;
}

interface StoredAssessment {
  surveyQuestionId: string;
  status: string;
  score: number | null;
}

/** What a fixture seeds: the active window, its questions and the topic-selection inputs. */
export interface SurveyWindowSeed {
  window: SurveyWindowRecord;
  questions: SurveyQuestionRecord[];
  /** Topic groups the pulse backlog still steers toward, in order. */
  uncoveredTopics?: string[];
  /** Questions that are already closed (confirmed or declined) and never asked again. */
  closedQuestionIds?: string[];
}

/**
 * Stateful in-memory `SurveyRepositoryPort` for one tenant and one user (the seeded window's).
 * It stores evidence, assessments and group states so `SurveyEvidenceExtractionUseCase` runs
 * its v1 path end to end; every other port method is a safe empty (`[]`, `null`, `false`, `0`).
 * Timestamps come from the injected clock. A simulation of the repository contract, not of its SQL.
 */
export class InMemorySurveyRepository implements SurveyRepositoryPort {
  private window: SurveyWindowRecord | null = null;
  private readonly questions: SurveyQuestionRecord[] = [];
  private uncoveredTopics: string[] = [];
  private closedQuestionIds = new Set<string>();
  private readonly evidence: StoredEvidence[] = [];
  private readonly assessments = new Map<string, StoredAssessment>();
  private readonly groupStates: SurveyGroupStateRecord[] = [];
  private sequence = 0;

  constructor(private readonly clock: ClockPort = systemClock) {}

  // ---------------------------------------------------------------------------
  // Fixture seeding and reads (not part of the port)
  // ---------------------------------------------------------------------------

  /** Opens the active window with its questions; replaces any earlier window. */
  seedWindow(seed: SurveyWindowSeed): void {
    this.window = { ...seed.window };
    this.questions.splice(0, this.questions.length, ...seed.questions.map((question) => ({ ...question })));
    this.uncoveredTopics = [...(seed.uncoveredTopics ?? [])];
    this.closedQuestionIds = new Set(seed.closedQuestionIds ?? []);
  }

  hasWindow(): boolean {
    return this.window !== null;
  }

  /** Saved evidence rows that no later row superseded. */
  evidenceCount(): number {
    return this.evidence.filter((row) => !row.superseded).length;
  }

  /**
   * A minimal `PulseBacklogService.getNextProbeQuestion`: the first open question (not closed,
   * no completed assessment) of the first uncovered topic group, `focus: 'open'`, or null.
   */
  pulseBacklog(): Pick<PulseBacklogService, 'getNextProbeQuestion'> {
    return {
      getNextProbeQuestion: async (userId: string, tenantId: string) => {
        const window = await this.findOrCreateActiveWindow(userId, tenantId);
        if (!window) return null;
        for (const topic of this.uncoveredTopics) {
          const question = this.questions
            .filter((candidate) => candidate.questionGroup === topic && this.isOpen(candidate))
            .sort((a, b) => a.displayOrder - b.displayOrder)[0];
          if (question) return { question: { ...question }, windowId: window.id, focus: 'open' as const };
        }
        return null;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Stateful port methods
  // ---------------------------------------------------------------------------

  async findOrCreateActiveWindow(userId: string, tenantId: string): Promise<SurveyWindowRecord | null> {
    if (!this.window || this.window.userId !== userId || this.window.tenantId !== tenantId) return null;
    return { ...this.window };
  }

  async findQuestionsForWindow(windowId: string): Promise<SurveyQuestionRecord[]> {
    if (this.window?.id !== windowId) return [];
    return this.questions.map((question) => ({ ...question }));
  }

  async saveEvidence(params: SaveSurveyEvidenceParams): Promise<SurveyEvidenceRecord> {
    const row: StoredEvidence = {
      id: `evidence-${++this.sequence}`,
      surveyWindowId: params.surveyWindowId,
      surveyQuestionId: params.surveyQuestionId,
      userId: params.userId,
      sourceMessageIds: [...params.sourceMessageIds],
      evidenceSummary: params.evidenceSummary,
      polarity: params.polarity,
      strength: params.strength,
      completeness: params.completeness,
      confidence: params.confidence,
      evaluatorVersion: params.evaluatorVersion,
      promptVersion: params.promptVersion,
      createdAt: this.clock.now(),
      superseded: false,
    };
    this.evidence.push(row);
    return publicEvidence(row);
  }

  async markEvidenceSuperseded(evidenceIds: string[]): Promise<void> {
    for (const row of this.evidence) if (evidenceIds.includes(row.id)) row.superseded = true;
  }

  async findEvidenceForQuestion(userId: string, questionId: string, windowId: string): Promise<SurveyEvidenceRecord[]> {
    return this.evidence
      .filter((row) => !row.superseded && row.userId === userId && row.surveyQuestionId === questionId && row.surveyWindowId === windowId)
      .map(publicEvidence);
  }

  async upsertAssessment(params: UpsertAssessmentParams): Promise<void> {
    if (this.window?.id !== params.surveyWindowId) return;
    const existing = this.assessments.get(params.surveyQuestionId);
    this.assessments.set(params.surveyQuestionId, {
      surveyQuestionId: params.surveyQuestionId,
      status: params.status,
      score: params.score !== undefined ? params.score : (existing?.score ?? null),
    });
  }

  async findAssessmentsForWindow(windowId: string): Promise<Array<{ surveyQuestionId: string; status: string; score: number | null }>> {
    if (this.window?.id !== windowId) return [];
    return [...this.assessments.values()].map((assessment) => ({ ...assessment }));
  }

  async findGroupState(userId: string, windowId: string, questionGroup: string): Promise<SurveyGroupStateRecord | null> {
    const state = this.groupStates.find(
      (candidate) => candidate.userId === userId && candidate.surveyWindowId === windowId && candidate.questionGroup === questionGroup,
    );
    return state ? { ...state } : null;
  }

  async upsertGroupState(params: UpsertGroupStateParams): Promise<SurveyGroupStateRecord> {
    const now = this.clock.now();
    const existing = this.groupStates.find(
      (candidate) =>
        candidate.userId === params.userId && candidate.surveyWindowId === params.surveyWindowId && candidate.questionGroup === params.questionGroup,
    );
    if (existing) {
      existing.status = params.status;
      if (params.employeeScore !== undefined) existing.employeeScore = params.employeeScore;
      if (params.personalRecs !== undefined) existing.personalRecs = params.personalRecs;
      if (params.reportSentAt !== undefined) existing.reportSentAt = params.reportSentAt;
      existing.updatedAt = now;
      return { ...existing };
    }
    const created: SurveyGroupStateRecord = {
      id: `group-state-${++this.sequence}`,
      surveyWindowId: params.surveyWindowId,
      userId: params.userId,
      tenantId: params.tenantId,
      questionGroup: params.questionGroup,
      status: params.status,
      aiSummary: null,
      confirmationSummary: null,
      reportableSummary: null,
      deidentificationDecision: null,
      employeeScore: params.employeeScore ?? null,
      personalRecs: params.personalRecs ?? null,
      confirmedAt: null,
      withdrawnAt: null,
      withdrawalMessageId: null,
      reportSentAt: params.reportSentAt ?? null,
      reportingDisclosureVersion: null,
      reportingDisclosureShownAt: null,
      confirmationMessageId: null,
      confirmationPromptMessageId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.groupStates.push(created);
    return { ...created };
  }

  // ---------------------------------------------------------------------------
  // Safe empties: reporting cycles, confirmations, teams and pulse captures are out of scope
  // ---------------------------------------------------------------------------

  async openReportingCycle(): Promise<[]> {
    return [];
  }

  async findReportingCohortsReadyForFinalReports(): Promise<[]> {
    return [];
  }

  async expireTemporaryGroupStatesForClosedCohorts(): Promise<number> {
    return 0;
  }

  async expireTemporaryQuestionInsightsForClosedWindows(): Promise<number> {
    return 0;
  }

  async findTenantsWithClosedTemporaryQuestionInsights(): Promise<string[]> {
    return [];
  }

  async countOverdueQuestionConfirmationReplies(): Promise<number> {
    return 0;
  }

  async findPulseCaptureForConversation(): Promise<[]> {
    return [];
  }

  async findPendingConfirmationGroups(): Promise<SurveyGroupStateRecord[]> {
    return [];
  }

  async findAwaitingConfirmationGroups(): Promise<SurveyGroupStateRecord[]> {
    return [];
  }

  async recordGroupDeidentificationDecision(): Promise<boolean> {
    return false;
  }

  async stageGroupConfirmation(): Promise<boolean> {
    return false;
  }

  async transitionAwaitingGroupState(): Promise<boolean> {
    return false;
  }

  async withdrawGroupState(): Promise<boolean> {
    return false;
  }

  async confirmGroupState(): Promise<boolean> {
    return false;
  }

  async findConfirmedGroupStates(): Promise<[]> {
    return [];
  }

  async findCurrentHierarchyIdentifiers(): Promise<string[]> {
    return [];
  }

  async findTeamByMemberId(): Promise<null> {
    return null;
  }

  async findTeamById(): Promise<null> {
    return null;
  }

  // ---------------------------------------------------------------------------

  private isOpen(question: SurveyQuestionRecord): boolean {
    if (this.closedQuestionIds.has(question.id)) return false;
    const assessment = this.assessments.get(question.id);
    return !assessment || !COMPLETED_ASSESSMENT_STATUSES.has(assessment.status);
  }
}

function publicEvidence(row: StoredEvidence): SurveyEvidenceRecord {
  return {
    id: row.id,
    surveyWindowId: row.surveyWindowId,
    surveyQuestionId: row.surveyQuestionId,
    userId: row.userId,
    sourceMessageIds: [...row.sourceMessageIds],
    evidenceSummary: row.evidenceSummary,
    polarity: row.polarity,
    strength: row.strength,
    completeness: row.completeness,
    confidence: row.confidence,
    evaluatorVersion: row.evaluatorVersion,
    promptVersion: row.promptVersion,
    createdAt: row.createdAt,
  };
}
