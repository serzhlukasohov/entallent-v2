import type { SurveyQuestionRecord, SurveyWindowRecord, SurveyEvidenceRecord, SurveyGroupStateRecord } from '../types/records';

export const SURVEY_EVIDENCE_POLARITIES = ['positive', 'negative', 'neutral', 'mixed'] as const;
export type SurveyEvidencePolarity = (typeof SURVEY_EVIDENCE_POLARITIES)[number];

export interface SaveSurveyEvidenceParams {
  surveyWindowId: string;
  surveyQuestionId: string;
  userId: string;
  sourceMessageIds: string[];
  evidenceSummary: string;
  polarity: SurveyEvidencePolarity;
  strength: number;
  completeness: number;
  confidence: number;
  evaluatorVersion: string;
  promptVersion: string;
}

export interface UpsertAssessmentParams {
  surveyWindowId: string;
  surveyQuestionId: string;
  confidence: number;
  status: string;
  evidenceId: string;
  evaluatorVersion: string;
}

export interface UpsertGroupStateParams {
  surveyWindowId: string;
  userId: string;
  tenantId: string;
  questionGroup: string;
  status: string;
  employeeScore?: number;
  personalRecs?: unknown;
  reportSentAt?: Date;
}

interface TransitionAwaitingGroupStateBase {
  surveyWindowId: string;
  userId: string;
  tenantId: string;
  questionGroup: string;
  confirmationPromptMessageId: string;
}

export type TransitionAwaitingGroupStateParams = TransitionAwaitingGroupStateBase & (
  | { status: 'pending_confirmation' }
  | {
      status: 'in_progress';
      conversationId: string;
      responseMessageId: string;
      responseOccurredAt: Date;
    }
);

export interface StageGroupConfirmationParams {
  surveyWindowId: string;
  conversationId: string;
  userId: string;
  tenantId: string;
  questionGroup: string;
  expectedUpdatedAt: Date;
  confirmationPromptMessageId: string;
}

export interface ConfirmGroupStateParams {
  surveyWindowId: string;
  conversationId: string;
  userId: string;
  tenantId: string;
  questionGroup: string;
  confirmationPromptMessageId: string;
  expectedConfirmationSummary: string;
  employeeScore?: number;
  confirmedAt: Date;
  reportingDisclosureVersion: string;
  reportingDisclosureShownAt: Date;
  confirmationMessageId: string;
}

export interface SurveyRepositoryPort {
  /** Find active window or auto-create one from the active survey definition. Returns null if no definition exists for the tenant. */
  findOrCreateActiveWindow(userId: string, tenantId: string): Promise<SurveyWindowRecord | null>;
  findQuestionsForWindow(windowId: string): Promise<SurveyQuestionRecord[]>;
  saveEvidence(params: SaveSurveyEvidenceParams): Promise<SurveyEvidenceRecord>;
  markEvidenceSuperseded(evidenceIds: string[]): Promise<void>;
  upsertAssessment(params: UpsertAssessmentParams): Promise<void>;
  findEvidenceForQuestion(userId: string, questionId: string, windowId: string): Promise<SurveyEvidenceRecord[]>;
  // Assessment methods
  findAssessmentsForWindow(windowId: string): Promise<Array<{ surveyQuestionId: string; status: string }>>;
  // Group state methods
  findGroupState(userId: string, windowId: string, questionGroup: string): Promise<SurveyGroupStateRecord | null>;
  findPendingConfirmationGroups(userId: string, tenantId: string): Promise<SurveyGroupStateRecord[]>;
  findAwaitingConfirmationGroups(
    userId: string,
    tenantId: string,
    conversationId: string,
  ): Promise<SurveyGroupStateRecord[]>;
  upsertGroupState(params: UpsertGroupStateParams): Promise<SurveyGroupStateRecord>;
  stageGroupConfirmation(params: StageGroupConfirmationParams): Promise<boolean>;
  transitionAwaitingGroupState(params: TransitionAwaitingGroupStateParams): Promise<boolean>;
  confirmGroupState(params: ConfirmGroupStateParams): Promise<boolean>;
  findConfirmedGroupStates(userIds: string[], questionGroup: string): Promise<SurveyGroupStateRecord[]>;
  // Team methods
  findTeamByMemberId(userId: string, tenantId: string): Promise<{ teamId: string; managerSlackUserId: string | null; activeTeamSize: number; memberUserIds: string[] } | null>;
  findTeamById(teamId: string): Promise<{ teamId: string; managerSlackUserId: string | null; activeTeamSize: number; memberUserIds: string[] } | null>;
}
