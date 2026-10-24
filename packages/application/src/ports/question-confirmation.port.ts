export interface ReadyQuestionBundle {
  tenantId: string;
  userId: string;
  surveyWindowId: string;
  questionGroup: string;
  questions: Array<{
    surveyQuestionId: string;
    questionVersion: string;
    workingSummary: string;
  }>;
  /**
   * 'corrected_statement' when the one ready meaning was already clarified but not shown back yet
   * (GC round 3 S4b); it is shown with the corrected-statement wording. Absent means 'confirmation'.
   */
  kind?: QuestionBundleKind;
}

export interface AwaitingQuestionBundle {
  id: string;
  tenantId: string;
  userId: string;
  surveyWindowId: string;
  questionGroup: string;
  displayedText: string;
  components: Array<{ surveyQuestionId: string; questionVersion: string; statement: string }>;
  /** 'corrected_statement' shows back one corrected meaning (GC round 3 S4b); absent means 'confirmation'. */
  kind?: QuestionBundleKind;
  /** Clarification questions already asked for the corrected meaning; set on corrected statements. */
  clarificationAttempts?: number;
}

export type QuestionBundleKind = 'confirmation' | 'corrected_statement';

export type QuestionBundleVerdict =
  | { kind: 'agree' }
  | { kind: 'reject' }
  | { kind: 'unrelated' }
  | {
      kind: 'partial';
      acceptedQuestionIds: string[];
      disputedQuestionIds: string[];
      declinedQuestionIds: string[];
    };

export interface PendingQuestionClarification {
  workingInsightId: string;
  tenantId: string;
  userId: string;
  surveyWindowId: string;
  surveyQuestionId: string;
  /** Needed to stage the corrected statement as a one-statement bundle (GC round 3 CAP-3). */
  questionVersion: string;
  questionGroup: string;
  workingSummary: string;
  disputedStatement: string;
  clarificationPromptMessageId: string | null;
  clarificationPromptSentAt: Date | null;
}

export type QuestionClarificationVerdict =
  | { kind: 'clarified'; correctedSummary: string }
  | { kind: 'declined' }
  | { kind: 'unrelated' };

/**
 * `questionNotCollected`: the verdict closed a disputed point for this cycle without an agreed
 * wording (a declined clarification or a closed corrected statement, GC round 3 S4b), so a
 * retried reply still says so.
 */
export type AppliedQuestionVerdict =
  | { kind: 'bundle'; verdictKind: 'agree' | 'partial' | 'reject'; questionGroup: string; questionNotCollected?: boolean }
  | { kind: 'clarification'; verdictKind: 'clarified' | 'declined'; questionGroup: string; questionNotCollected?: boolean };

/** Per-question statuses of the active V2 window, for typed cycle progress (GC round 3 CAP-3). */
export interface CycleProgressSnapshot {
  surveyWindowId: string;
  groups: Array<{
    questionGroup: string;
    questions: Array<{ surveyQuestionId: string; status: string }>;
  }>;
}

export interface QuestionConfirmationPort {
  /** GC round 3 CAP-2: a driver topic question was delivered; the driver is asked at most once. */
  recordDriverRequested?(input: {
    tenantId: string; userId: string; surveyWindowId: string; surveyQuestionId: string; requestedAt: Date;
  }): Promise<boolean>;
  /** Null when the employee has no active V2 window. */
  findCycleProgress?(input: { tenantId: string; userId: string }): Promise<CycleProgressSnapshot | null>;
  /**
   * After a `clarified` verdict the corrected statement is shown back as a one-statement bundle
   * and waits for the employee's verdict; nothing becomes confirmed until then (GC round 3 CAP-3).
   */
  stageCorrectedStatementConfirmation?(input: {
    tenantId: string;
    userId: string;
    conversationId: string;
    surveyWindowId: string;
    questionGroup: string;
    workingInsightId: string;
    surveyQuestionId: string;
    questionVersion: string;
    promptMessageId: string;
    displayedText: string;
    statement: string;
    expectedWorkingSummary: string;
  }): Promise<string>;
  findAppliedQuestionVerdictForInbound(input: {
    tenantId: string; userId: string; conversationId: string; inboundMessageId: string;
  }): Promise<AppliedQuestionVerdict | null>;
  findPendingQuestionClarification(input: {
    tenantId: string; userId: string; conversationId: string; inboundMessageId: string;
  }): Promise<PendingQuestionClarification | null>;
  previewPendingQuestionClarificationAfterBundleVerdict?(input: {
    tenantId: string; userId: string; conversationId: string; inboundMessageId: string;
    bundleId: string; disputedQuestionIds: string[];
  }): Promise<PendingQuestionClarification | null>;
  previewPendingQuestionClarificationAfterVerdict?(input: {
    tenantId: string; userId: string; conversationId: string;
    workingInsightId: string;
  }): Promise<PendingQuestionClarification | null>;
  stageQuestionClarificationPrompt(input: {
    tenantId: string; userId: string; conversationId: string;
    workingInsightId: string; promptMessageId: string; displayedText: string;
  }): Promise<boolean>;
  applyQuestionClarificationVerdict(input: {
    tenantId: string; userId: string; conversationId: string;
    workingInsightId: string; inboundMessageId: string;
    verdict: Exclude<QuestionClarificationVerdict, { kind: 'unrelated' }>;
  }): Promise<boolean>;
  findAwaitingQuestionBundle(input: {
    tenantId: string; userId: string; conversationId: string; inboundMessageId: string;
  }): Promise<AwaitingQuestionBundle | null>;
  applyQuestionBundleVerdict(input: {
    tenantId: string; userId: string; conversationId: string;
    inboundMessageId: string; bundleId: string; verdict: Exclude<QuestionBundleVerdict, { kind: 'unrelated' }>;
  }): Promise<boolean>;
  findReadyQuestionBundle(input: {
    tenantId: string; userId: string;
  }): Promise<ReadyQuestionBundle | null>;
  hasReadyQuestionBundle(input: {
    tenantId: string; userId: string;
  }): Promise<boolean>;
  stageQuestionConfirmationBundle(input: {
    tenantId: string;
    userId: string;
    conversationId: string;
    surveyWindowId: string;
    questionGroup: string;
    promptMessageId: string;
    displayedText: string;
    components: Array<{
      surveyQuestionId: string;
      questionVersion: string;
      statement: string;
      expectedWorkingSummary: string;
    }>;
  }): Promise<string>;
}
