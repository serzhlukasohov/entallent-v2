import type { SurveyQuestionRecord, SurveyWindowRecord, SurveyEvidenceRecord, SurveyGroupStateRecord } from '../types/records';

export interface SaveSurveyEvidenceParams {
  surveyWindowId: string;
  surveyQuestionId: string;
  userId: string;
  sourceMessageIds: string[];
  evidenceSummary: string;
  polarity: string;
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
  aiSummary?: string;
  employeeScore?: number;
  personalRecs?: unknown;
  confirmedAt?: Date;
  reportSentAt?: Date;
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
  findPendingConfirmationGroups(userId: string): Promise<SurveyGroupStateRecord[]>;
  upsertGroupState(params: UpsertGroupStateParams): Promise<SurveyGroupStateRecord>;
  findConfirmedGroupStates(userIds: string[], questionGroup: string): Promise<SurveyGroupStateRecord[]>;
  // Team methods
  findTeamByMemberId(userId: string): Promise<{ teamId: string; managerSlackUserId: string | null; activeTeamSize: number; memberUserIds: string[] } | null>;
  findTeamById(teamId: string): Promise<{ teamId: string; managerSlackUserId: string | null; activeTeamSize: number; memberUserIds: string[] } | null>;
}
