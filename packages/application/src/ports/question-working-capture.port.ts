export interface CaptureQuestionMeaningInput {
  tenantId: string;
  userId: string;
  conversationId: string;
  surveyWindowId: string;
  surveyQuestionId: string;
  questionVersion: string;
  sourceMessageId: string;
  meaning: string;
  sufficientMeaning: boolean;
}

export interface QuestionWorkingCapturePort {
  /** A bound but invalid V2 policy must throw instead of falling back to V1. */
  getWindowMode(input: { tenantId: string; userId: string; surveyWindowId: string }):
    Promise<'v1' | 'v2'>;
  reopenDeclinedQuestion(input: {
    tenantId: string; userId: string; conversationId: string;
    surveyWindowId: string; surveyQuestionId: string; questionVersion: string;
    sourceMessageId: string;
  }): Promise<boolean>;
  captureMeaning(input: CaptureQuestionMeaningInput): Promise<'captured' | 'ignored'>;
}
