import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { scheduledActions } from '@entalent/database';
import type {
  ScheduledActionRepositoryPort,
  SaveScheduledActionParams,
  ScheduledActionRecord,
} from '@entalent/application';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class ScheduledActionRepository implements ScheduledActionRepositoryPort {
  constructor(private readonly db: DatabaseService) {}

  async save(params: SaveScheduledActionParams): Promise<ScheduledActionRecord> {
    const [row] = await this.db.client
      .insert(scheduledActions)
      .values({
        tenantId: params.tenantId,
        userId: params.userId,
        conversationId: params.conversationId,
        type: params.type,
        intent: params.intent,
        context: params.context,
        reason: params.reason,
        dueAt: params.dueAt,
        timezone: params.timezone,
        status: 'pending',
        cancellationConditions: params.cancellationConditions,
        deduplicationKey: params.deduplicationKey,
        sourceMessageIds: params.sourceMessageIds,
      })
      .returning();

    return toRecord(row);
  }

  async findById(id: string, tenantId: string): Promise<ScheduledActionRecord | null> {
    const [row] = await this.db.client
      .select()
      .from(scheduledActions)
      .where(and(eq(scheduledActions.id, id), eq(scheduledActions.tenantId, tenantId)))
      .limit(1);

    return row ? toRecord(row) : null;
  }

  async markSent(id: string, tenantId: string, attemptCount: number): Promise<void> {
    await this.db.client
      .update(scheduledActions)
      .set({ status: 'sent', attemptCount, lastAttemptAt: new Date(), updatedAt: new Date() })
      .where(and(eq(scheduledActions.id, id), eq(scheduledActions.tenantId, tenantId)));
  }

  async cancel(id: string, tenantId: string): Promise<void> {
    await this.db.client
      .update(scheduledActions)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(scheduledActions.id, id), eq(scheduledActions.tenantId, tenantId)));
  }

  async postpone(
    id: string,
    tenantId: string,
    newDueAt: Date,
    attemptCount: number,
  ): Promise<void> {
    await this.db.client
      .update(scheduledActions)
      .set({
        dueAt: newDueAt,
        attemptCount,
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
        // Keep status 'pending' — job will fire again at newDueAt
      })
      .where(and(eq(scheduledActions.id, id), eq(scheduledActions.tenantId, tenantId)));
  }

  async existsByDeduplicationKey(key: string): Promise<boolean> {
    const [row] = await this.db.client
      .select({ id: scheduledActions.id })
      .from(scheduledActions)
      .where(
        and(
          eq(scheduledActions.deduplicationKey, key),
          // Only block if there's already a pending or sent (not cancelled/expired)
        ),
      )
      .limit(1);

    return !!row;
  }

  async cancelPendingByUserAndType(
    userId: string,
    tenantId: string,
    type: string,
    topic: string,
  ): Promise<void> {
    const dedupKey = `${userId}:${type}:${topic.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 32)}`;
    await this.db.client
      .update(scheduledActions)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(scheduledActions.userId, userId),
          eq(scheduledActions.tenantId, tenantId),
          eq(scheduledActions.deduplicationKey, dedupKey),
          eq(scheduledActions.status, 'pending'),
        ),
      );
  }
}

function toRecord(row: typeof scheduledActions.$inferSelect): ScheduledActionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    conversationId: row.conversationId ?? undefined,
    type: row.type,
    intent: row.intent,
    context: row.context as Record<string, unknown>,
    reason: row.reason ?? undefined,
    dueAt: row.dueAt,
    timezone: row.timezone,
    status: row.status,
    cancellationConditions: row.cancellationConditions as string[],
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    lastAttemptAt: row.lastAttemptAt ?? undefined,
    deduplicationKey: row.deduplicationKey ?? undefined,
    sourceMessageIds: row.sourceMessageIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
