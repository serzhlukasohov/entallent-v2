import type { StyleProfileRecord } from '../types/records';

export interface StyleProfileRepositoryPort {
  findByUser(userId: string, tenantId: string): Promise<StyleProfileRecord | null>;
  upsert(profile: StyleProfileRecord): Promise<StyleProfileRecord>;
}

export interface CommittedStyleAnalysisInput {
  inboundMessageId: string;
  conversationId: string;
  userId: string;
  tenantId: string;
}

export interface CommittedStyleProfileRepositoryPort extends StyleProfileRepositoryPort {
  isCommittedStyleAnalysisComplete(input: CommittedStyleAnalysisInput): Promise<boolean>;
  completeCommittedStyleAnalysis(
    input: CommittedStyleAnalysisInput,
    update: ((current: StyleProfileRecord | null) => StyleProfileRecord) | null,
  ): Promise<void>;
}
