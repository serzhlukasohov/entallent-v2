import type { ScheduledActionRecord } from '../types/records';

export interface SaveScheduledActionParams {
  tenantId: string;
  userId: string;
  conversationId?: string;
  type: string;
  intent: string;
  context: Record<string, unknown>;
  reason?: string;
  dueAt: Date;
  timezone: string;
  cancellationConditions: string[];
  deduplicationKey?: string;
  sourceMessageIds: string[];
}

export interface ScheduledActionRepositoryPort {
  save(params: SaveScheduledActionParams): Promise<ScheduledActionRecord>;
  findById(id: string, tenantId: string): Promise<ScheduledActionRecord | null>;
  markSent(id: string, tenantId: string, attemptCount: number): Promise<void>;
  cancel(id: string, tenantId: string): Promise<void>;
  /** Reschedule: keeps status 'pending', updates dueAt + attempt metadata */
  postpone(
    id: string,
    tenantId: string,
    newDueAt: Date,
    attemptCount: number,
  ): Promise<void>;
  existsByDeduplicationKey(key: string): Promise<boolean>;
  cancelPendingByUserAndType(
    userId: string,
    tenantId: string,
    type: string,
    topic: string,
  ): Promise<void>;
}
