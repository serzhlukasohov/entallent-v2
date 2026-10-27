import type { QuietHours } from '../utils/quiet-hours';
import type { CheckInCadenceFacts } from '../policies/check-in-cadence';

/**
 * A user who passed the repository prefilter for a proactive check-in. The use case
 * re-decides cadence from `cadence` and applies the quiet-hours guard.
 */
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
  /** Per-user facts consumed by `checkInCadencePolicy`. */
  cadence: CheckInCadenceFacts;
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
