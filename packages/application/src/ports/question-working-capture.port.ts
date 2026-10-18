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
  /** GC round 3 CAP-2: this message said what drives the status (typed by the capture model). */
  driverCaptured: boolean;
  /** GC round 3 CAP-2: this message explicitly declined to say what drives it. */
  driverDeclined: boolean;
}

/** Per-question V2 working state for topic selection (GC round 3 CAP-1, CAP-2). */
export interface QuestionWorkingCoverage {
  surveyQuestionId: string;
  questionVersion: string;
  status: string;
  readyForConfirmation: boolean;
  /** A status is captured but no driver or decline yet: the next topic question asks for the driver. */
  needsDriver: boolean;
  /** The bot already asked for the driver once in this window; it is not asked again. */
  driverRequested: boolean;
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
  findQuestionCoverage?(input: { tenantId: string; userId: string; surveyWindowId: string }):
    Promise<QuestionWorkingCoverage[]>;
  /**
   * GC round 3 CAP-2: the employee explicitly declined to say what drives a status they gave. A
   * decline carries no meaning of its own, so it is recorded without touching the working summary.
   */
  recordDriverDeclined?(input: {
    tenantId: string; userId: string; conversationId: string; surveyWindowId: string;
    surveyQuestionId: string; questionVersion: string; sourceMessageId: string;
  }): Promise<boolean>;
}
