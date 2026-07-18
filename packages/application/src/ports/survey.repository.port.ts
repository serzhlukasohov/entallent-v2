import type { SurveyQuestionRecord, SurveyWindowRecord, SurveyEvidenceRecord } from '../types/records';

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

export interface SurveyRepositoryPort {
  /** Find active window or auto-create one from the active survey definition. Returns null if no definition exists for the tenant. */
  findOrCreateActiveWindow(userId: string, tenantId: string): Promise<SurveyWindowRecord | null>;
  findQuestionsForWindow(windowId: string): Promise<SurveyQuestionRecord[]>;
  findPendingProbeQuestion(userId: string, tenantId: string, windowId: string): Promise<SurveyQuestionRecord | null>;
  saveEvidence(params: SaveSurveyEvidenceParams): Promise<SurveyEvidenceRecord>;
  markEvidenceSuperseded(evidenceIds: string[]): Promise<void>;
  upsertAssessment(params: UpsertAssessmentParams): Promise<void>;
  findEvidenceForQuestion(userId: string, questionId: string, windowId: string): Promise<SurveyEvidenceRecord[]>;
}
