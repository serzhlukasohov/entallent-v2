import type { QuietHours } from '../utils/quiet-hours';

/** A user who is eligible for a proactive check-in right now. */
export interface CheckInCandidate {
  userId: string;
  tenantId: string;
  conversationId: string;
  channelType: string;
  externalConversationId: string;
  externalWorkspaceId: string;
  timezone: string;
  quietHours: QuietHours;
  preferredName?: string;
}

export interface FindCheckInCandidatesParams {
  /** Only consider users silent for at least this many days since their last message */
  minSilenceDays: number;
  /** Don't re-contact users who received a proactive message within this many days */
  minCheckInGapDays: number;
  /** Max candidates to return in one scan */
  limit: number;
  /** Optional: restrict to a single tenant (used by dev tooling) */
  tenantId?: string;
}

export interface ProactiveSchedulerRepositoryPort {
  findCheckInCandidates(params: FindCheckInCandidatesParams): Promise<CheckInCandidate[]>;
}

export interface CheckInEnqueuePayload {
  conversationId: string;
  userId: string;
  tenantId: string;
  externalWorkspaceId: string;
  externalConversationId: string;
  traceId: string;
}

/** Enqueues an agent-initiated check-in onto the conversation queue. */
export interface CheckInEnqueuePort {
  enqueueCheckIn(payload: CheckInEnqueuePayload): Promise<void>;
}
