import type {
  SurveyQuestionRecord,
  SurveyWindowRecord,
  SurveyEvidenceRecord,
  SurveyGroupStateRecord,
  SurveyReportingCohortRecord,
  PulseCaptureRecord,
} from '../types/records';
import type { DeidentificationDecision } from '../utils/deidentification-policy';

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
  score?: number | null;
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
  deidentificationDecision: Extract<DeidentificationDecision, { status: 'accepted' }>;
}

export interface RecordGroupDeidentificationDecisionParams {
  surveyWindowId: string;
  userId: string;
  tenantId: string;
  questionGroup: string;
  expectedUpdatedAt: Date;
  deidentificationDecision: DeidentificationDecision;
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
  deidentificationDecision: Extract<DeidentificationDecision, { status: 'accepted' }>;
}

export interface WithdrawGroupStateParams {
  surveyWindowId: string;
  userId: string;
  tenantId: string;
  questionGroup: string;
  confirmationPromptMessageId: string;
  conversationId: string;
  withdrawalMessageId: string;
  withdrawnAt: Date;
}

export interface FindConfirmedGroupStatesParams {
  reportingCohortId: string;
  tenantId: string;
  teamId: string;
  rosterUserIds: string[];
  questionGroup: string;
}

export interface FindPulseCaptureForConversationParams {
  tenantId: string;
  userId: string;
  conversationId: string;
  beforeOccurredAt: Date;
  sourceMessageId?: string;
}

export interface ConfirmedGroupReportStateRecord extends SurveyGroupStateRecord {
  reportingCohortId: string;
  surveyDefinitionId: string;
  reportingTeamId: string;
  reportingRosterUserIds: string[];
  reportingPeriodStart: Date;
  reportingPeriodEnd: Date;
}

export interface SurveyTeamRecord {
  teamId: string;
  tenantId: string;
  teamName?: string;
  managerSlackUserId: string | null;
  activeTeamSize: number;
  memberUserIds: string[];
  reportingCohortId: string | null;
  reportingSurveyDefinitionId: string | null;
  reportingPeriodStart: Date | null;
  reportingPeriodEnd: Date | null;
}

export interface OpenSurveyReportingCycleParams {
  tenantId: string;
  surveyDefinitionId: string;
  periodStart: Date;
  periodEnd: Date;
  openedAt: Date;
}

export interface FindReportingCohortsReadyForFinalReportsParams {
  tenantId: string;
  surveyDefinitionId?: string;
  now: Date;
}

export interface ExpireTemporaryGroupStatesForClosedCohortsParams {
  tenantId: string;
  surveyDefinitionId?: string;
  now: Date;
}

export interface SurveyRepositoryPort {
  openReportingCycle(params: OpenSurveyReportingCycleParams): Promise<SurveyReportingCohortRecord[]>;
  findReportingCohortsReadyForFinalReports(
    params: FindReportingCohortsReadyForFinalReportsParams,
  ): Promise<SurveyReportingCohortRecord[]>;
  expireTemporaryGroupStatesForClosedCohorts(
    params: ExpireTemporaryGroupStatesForClosedCohortsParams,
  ): Promise<number>;
  /** Find active window or auto-create one from the active survey definition. Returns null if no definition exists for the tenant. */
  findOrCreateActiveWindow(userId: string, tenantId: string): Promise<SurveyWindowRecord | null>;
  findQuestionsForWindow(windowId: string): Promise<SurveyQuestionRecord[]>;
  saveEvidence(params: SaveSurveyEvidenceParams): Promise<SurveyEvidenceRecord>;
  markEvidenceSuperseded(evidenceIds: string[]): Promise<void>;
  upsertAssessment(params: UpsertAssessmentParams): Promise<void>;
  findEvidenceForQuestion(userId: string, questionId: string, windowId: string): Promise<SurveyEvidenceRecord[]>;
  findPulseCaptureForConversation(
    params: FindPulseCaptureForConversationParams,
  ): Promise<PulseCaptureRecord[]>;
  // Assessment methods
  findAssessmentsForWindow(
    windowId: string,
  ): Promise<Array<{ surveyQuestionId: string; status: string; score: number | null }>>;
  // Group state methods
  findGroupState(userId: string, windowId: string, questionGroup: string): Promise<SurveyGroupStateRecord | null>;
  findPendingConfirmationGroups(userId: string, tenantId: string): Promise<SurveyGroupStateRecord[]>;
  findAwaitingConfirmationGroups(
    userId: string,
    tenantId: string,
    conversationId: string,
  ): Promise<SurveyGroupStateRecord[]>;
  upsertGroupState(params: UpsertGroupStateParams): Promise<SurveyGroupStateRecord>;
  recordGroupDeidentificationDecision(params: RecordGroupDeidentificationDecisionParams): Promise<boolean>;
  stageGroupConfirmation(params: StageGroupConfirmationParams): Promise<boolean>;
  transitionAwaitingGroupState(params: TransitionAwaitingGroupStateParams): Promise<boolean>;
  withdrawGroupState(params: WithdrawGroupStateParams): Promise<boolean>;
  confirmGroupState(params: ConfirmGroupStateParams): Promise<boolean>;
  findConfirmedGroupStates(params: FindConfirmedGroupStatesParams): Promise<ConfirmedGroupReportStateRecord[]>;
  // Team methods
  findTeamByMemberId(userId: string, tenantId: string, surveyWindowId?: string): Promise<SurveyTeamRecord | null>;
  findTeamById(teamId: string, tenantId: string, reportingCohortId?: string): Promise<SurveyTeamRecord | null>;
}
