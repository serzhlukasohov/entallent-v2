import type { PulseBacklogRepositoryPort, ProactivePulseConfig } from '../ports/pulse-backlog.repository.port';
import { DEFAULT_PULSE_CONFIG } from '../ports/pulse-backlog.repository.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import type { SurveyQuestionRecord } from '../types/records';

/** Canonical group order for backlog initialization (engagement is excluded). */
const CANONICAL_GROUP_ORDER = ['autonomy', 'belonging', 'growth', 'purpose'] as const;

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

    const nonEngagementQuestions = allQuestions
      .filter((q) => q.questionGroup !== 'engagement')
      .sort((a, b) => {
        const gi = (g: string) => CANONICAL_GROUP_ORDER.indexOf(g as typeof CANONICAL_GROUP_ORDER[number]);
        const groupDiff = gi(a.questionGroup) - gi(b.questionGroup);
        return groupDiff !== 0 ? groupDiff : a.displayOrder - b.displayOrder;
      });

    const assessments = await this.surveyRepo.findAssessmentsForWindow(window.id);
    const coveredIds = new Set(
      assessments
        .filter((a) => a.status === 'scored' || a.status === 'covered')
        .map((a) => a.surveyQuestionId),
    );

    await this.backlogRepo.initializeIfNeeded(
      userId,
      tenantId,
      window.id,
      nonEngagementQuestions,
      coveredIds,
    );

    await this.backlogRepo.resolveIgnoredEntries(userId, window.id, config.ignoreWindowHours);

    const daysUntilEnd = (window.periodEnd.getTime() - Date.now()) / 86_400_000;
    const isEndOfQuarter = daysUntilEnd <= config.engagementUnlockDays;

    if (isEndOfQuarter) {
      const engagementQuestions = allQuestions
        .filter((q) => q.questionGroup === 'engagement')
        .sort((a, b) => a.displayOrder - b.displayOrder);
      await this.backlogRepo.unlockEngagementIfNeeded(userId, tenantId, window.id, engagementQuestions);
    }

    const entry = await this.backlogRepo.findNextPending(userId, window.id, isEndOfQuarter);
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
