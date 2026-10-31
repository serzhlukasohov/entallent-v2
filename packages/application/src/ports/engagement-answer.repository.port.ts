export interface CaptureEngagementAnswerInput {
  tenantId: string; userId: string; conversationId: string; inboundMessageId: string;
}
export type EngagementCaptureResult = { status: 'accepted' | 'invalid' | 'ineligible' | 'expired' | 'source_deleted' | 'withdrawn' | 'not_applicable'; replayed: boolean };
export interface EngagementAnswerRepositoryPort {
  /** Owns source loading, literal parsing, proof snapshot and subject-locked admission atomically. */
  capture(input: CaptureEngagementAnswerInput): Promise<EngagementCaptureResult>;
  captureConversation(input: Omit<CaptureEngagementAnswerInput, 'inboundMessageId'>): Promise<void>;
  reconcileBacklog(input: { tenantId: string; userId: string; surveyWindowId: string; coverageSnapshotAt: Date }): Promise<string[]>;
  coveredQuestionIds(tenantId: string, userId: string, surveyWindowId: string): Promise<string[]>;
}
