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
}

export interface AwaitingQuestionBundle {
  id: string;
  tenantId: string;
  userId: string;
  surveyWindowId: string;
  questionGroup: string;
  displayedText: string;
  components: Array<{ surveyQuestionId: string; questionVersion: string; statement: string }>;
}

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

export type AppliedQuestionVerdict =
  | { kind: 'bundle'; verdictKind: 'agree' | 'partial' | 'reject'; questionGroup: string }
  | { kind: 'clarification'; verdictKind: 'clarified' | 'declined'; questionGroup: string };

export interface QuestionConfirmationPort {
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
