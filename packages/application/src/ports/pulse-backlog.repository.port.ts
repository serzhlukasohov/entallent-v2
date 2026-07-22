import type { SurveyQuestionRecord } from '../types/records';

export interface PulseBacklogRecord {
  id: string;
  surveyWindowId: string;
  userId: string;
  tenantId: string;
  surveyQuestionId: string;
  position: number;
  status: 'pending' | 'active' | 'done';
  ignoreCount: number;
  proactiveSentAt: Date | null;
  evidenceCapturedCount: number;
  resultedInCoverage: boolean | null;
  doneAt: Date | null;
}

export interface ResolvedIgnore {
  questionId: string;
  newPosition: number;
  ignoreCount: number;
}

export interface ProactivePulseConfig {
  /** Days before quarter end when engagement questions unlock. Default: 14 */
  engagementUnlockDays: number;
  /** Hours after probe sent before no-response counts as ignore. Default: 48 */
  ignoreWindowHours: number;
}

export const DEFAULT_PULSE_CONFIG: ProactivePulseConfig = {
  engagementUnlockDays: 14,
  ignoreWindowHours: 48,
};

export interface PulseBacklogRepositoryPort {
  /**
   * Creates 12 backlog entries (non-engagement questions in canonical group order)
   * if no entries exist yet for this user/window pair. Idempotent.
   * Questions whose IDs are in coveredQuestionIds are created with status='done'.
   */
  initializeIfNeeded(
    userId: string,
    tenantId: string,
    windowId: string,
    questions: SurveyQuestionRecord[],
    coveredQuestionIds: Set<string>,
  ): Promise<void>;

  /**
   * Finds all 'active' entries where proactive_sent_at is older than ignoreAfterHours
   * AND no inbound message from the user exists after proactive_sent_at.
   * Moves them back to 'pending' at the end of the queue and increments ignore_count.
   * Returns the resolved entries.
   */
  resolveIgnoredEntries(
    userId: string,
    windowId: string,
    ignoreAfterHours: number,
  ): Promise<ResolvedIgnore[]>;

  /**
   * Returns the pending entry with the lowest position.
   * If engagementOnly=true, only returns entries from questionGroup='engagement'.
   * If engagementOnly=false, only returns entries from questionGroup != 'engagement'.
   */
  findNextPending(
    userId: string,
    windowId: string,
    engagementOnly: boolean,
  ): Promise<PulseBacklogRecord | null>;

  /** Sets status='active' and proactive_sent_at. */
  markActive(
    userId: string,
    windowId: string,
    questionId: string,
    sentAt: Date,
  ): Promise<void>;

  /**
   * Sets status='done', evidenceCapturedCount, and doneAt.
   * resulted_in_coverage is set to true if proactive_sent_at is NOT NULL
   * (i.e., a probe was sent before coverage); otherwise stays NULL.
   * No-op if entry is already 'done'.
   */
  markDone(
    userId: string,
    windowId: string,
    questionId: string,
    evidenceCapturedCount: number,
  ): Promise<void>;

  /**
   * Adds 3 engagement questions at the end of the queue if not already present.
   * Idempotent — uses ON CONFLICT DO NOTHING.
   */
  unlockEngagementIfNeeded(
    userId: string,
    tenantId: string,
    windowId: string,
    engagementQuestions: SurveyQuestionRecord[],
  ): Promise<void>;
}
