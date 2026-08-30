import type { PulseBacklogRepositoryPort, ProactivePulseConfig } from '../ports/pulse-backlog.repository.port';
import { DEFAULT_PULSE_CONFIG } from '../ports/pulse-backlog.repository.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import type { SurveyQuestionRecord, SurveyWindowRecord } from '../types/records';

/** Canonical group order for backlog initialization (engagement is excluded). */
const CANONICAL_GROUP_ORDER = ['autonomy', 'belonging', 'growth', 'purpose'] as const;
const DAY_MS = 86_400_000;
export const ENGAGEMENT_WINDOW_DAYS = 14;

export function isEngagementWindowEligible(
  window: Pick<SurveyWindowRecord, 'periodEnd'>,
  now = new Date(),
): boolean {
  const end = window.periodEnd.getTime();
  const start = end - ENGAGEMENT_WINDOW_DAYS * DAY_MS;
  const current = now.getTime();
  return current >= start && current <= end;
}

export class PulseBacklogService {
  constructor(
    private readonly backlogRepo: PulseBacklogRepositoryPort,
    private readonly surveyRepo: SurveyRepositoryPort,
  ) {}

  /**
   * Returns the next probe question and its window ID, or null if nothing is pending.
   * Lazily initializes the backlog on first call. Resolves expired ignores before
   * selecting. Switches to engagement-only mode when the quarter is ending.
   */
  async getNextProbeQuestion(
    userId: string,
    tenantId: string,
    config: ProactivePulseConfig = DEFAULT_PULSE_CONFIG,
  ): Promise<{ question: SurveyQuestionRecord; windowId: string } | null> {
    const window = await this.surveyRepo.findOrCreateActiveWindow(userId, tenantId);
    if (!window) return null;

    const allQuestions = await this.surveyRepo.findQuestionsForWindow(window.id);
    if (!allQuestions.length) return null;
    const questionGroup = config.questionGroup?.trim();

    const nonEngagementQuestions = allQuestions
      .filter((q) => q.questionGroup !== 'engagement' && (!questionGroup || q.questionGroup === questionGroup))
      .sort((a, b) => {
        const gi = (g: string) => CANONICAL_GROUP_ORDER.indexOf(g as typeof CANONICAL_GROUP_ORDER[number]);
        const groupDiff = gi(a.questionGroup) - gi(b.questionGroup);
        return groupDiff !== 0 ? groupDiff : a.displayOrder - b.displayOrder;
      });

    const coverageSnapshotAt = new Date();
    const assessments = await this.surveyRepo.findAssessmentsForWindow(window.id);
    const questionById = new Map(allQuestions.map((question) => [question.id, question]));
    const coveredIds = new Set(
      assessments
        .filter((assessment) => {
          const question = questionById.get(assessment.surveyQuestionId);
          if (!question) return false;
          return question.responseType === 'numeric_0_10'
            ? assessment.status === 'scored' && assessment.score !== null
            : ['partially_covered', 'covered', 'scored'].includes(assessment.status);
        })
        .map((a) => a.surveyQuestionId),
    );

    await this.backlogRepo.initializeIfNeeded(
      userId,
      tenantId,
      window.id,
      nonEngagementQuestions,
      coveredIds,
      coverageSnapshotAt,
    );

    await this.backlogRepo.resolveIgnoredEntries(userId, window.id, config.ignoreWindowHours);

    const isEndOfQuarter = isEngagementWindowEligible(window);

    if (isEndOfQuarter && !questionGroup) {
      const engagementQuestions = allQuestions
        .filter((q) => q.questionGroup === 'engagement' && !coveredIds.has(q.id))
        .sort((a, b) => a.displayOrder - b.displayOrder);
      await this.backlogRepo.unlockEngagementIfNeeded(userId, tenantId, window.id, engagementQuestions);
    }

    const focusedGroup = !questionGroup
      ? selectFocusedRegularGroup(nonEngagementQuestions, coveredIds)
      : undefined;
    let entry = await this.backlogRepo.findNextPending(
      userId,
      window.id,
      isEndOfQuarter,
      questionGroup ?? (isEndOfQuarter ? undefined : focusedGroup),
    );
    if (!entry && isEndOfQuarter && !questionGroup) {
      // Engagement questions exhausted — fall back to remaining regular questions
      entry = await this.backlogRepo.findNextPending(userId, window.id, false, focusedGroup);
    }
    if (!entry && focusedGroup && !questionGroup) {
      entry = await this.backlogRepo.findNextPending(userId, window.id, false);
    }
    if (!entry) return null;

    const question = allQuestions.find((q) => q.id === entry.surveyQuestionId);
    if (!question) return null;

    return { question, windowId: window.id };
  }

  /** Records that a probe was sent for a question — transitions it to 'active'. */
  async recordProbeSent(
    userId: string,
    windowId: string,
    questionId: string,
    sentAt: Date,
  ): Promise<void> {
    await this.backlogRepo.markActive(userId, windowId, questionId, sentAt);
  }

  /** Records that a question reached coverage — transitions it to 'done'. */
  async markQuestionCovered(
    userId: string,
    windowId: string,
    questionId: string,
    evidenceCount: number,
  ): Promise<void> {
    await this.backlogRepo.markDone(userId, windowId, questionId, evidenceCount);
  }
}

function selectFocusedRegularGroup(
  questions: SurveyQuestionRecord[],
  completedQuestionIds: Set<string>,
): string | undefined {
  const progress = CANONICAL_GROUP_ORDER.map((group) => {
    const groupQuestions = questions.filter((question) => question.questionGroup === group);
    return {
      group,
      total: groupQuestions.length,
      completed: groupQuestions.filter((question) => completedQuestionIds.has(question.id)).length,
    };
  }).filter(({ total, completed }) => total > 0 && completed < total);

  return progress.sort((a, b) => b.completed - a.completed)[0]?.group;
}
