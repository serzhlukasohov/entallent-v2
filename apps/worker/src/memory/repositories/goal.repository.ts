import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { userGoals } from '@entalent/database';
import type { GoalRepositoryPort, SaveGoalParams, UserGoalRecord } from '@entalent/application';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class GoalRepository implements GoalRepositoryPort {
  constructor(private readonly db: DatabaseService) {}

  async findActiveByUser(userId: string, tenantId: string): Promise<UserGoalRecord[]> {
    const rows = await this.db.client
      .select()
      .from(userGoals)
      .where(
        and(
          eq(userGoals.userId, userId),
          eq(userGoals.tenantId, tenantId),
          eq(userGoals.status, 'active'),
        ),
      );

    return rows.map(toRecord);
  }

  async findById(id: string, tenantId: string): Promise<UserGoalRecord | null> {
    const [row] = await this.db.client
      .select()
      .from(userGoals)
      .where(and(eq(userGoals.id, id), eq(userGoals.tenantId, tenantId)))
      .limit(1);

    return row ? toRecord(row) : null;
  }

  async save(params: SaveGoalParams): Promise<UserGoalRecord> {
    const [row] = await this.db.client
      .insert(userGoals)
      .values({
        tenantId: params.tenantId,
        userId: params.userId,
        title: params.title,
        description: params.description,
        category: params.category,
        targetDate: params.targetDate,
        sourceMessageIds: params.sourceMessageIds,
        confidence: String(params.confidence),
        status: 'active',
      })
      .returning();

    return toRecord(row);
  }

  async updateStatus(
    id: string,
    status: 'active' | 'completed' | 'cancelled',
    tenantId: string,
  ): Promise<void> {
    const now = new Date();
    await this.db.client
      .update(userGoals)
      .set({
        status,
        completedAt: status === 'completed' ? now : undefined,
        cancelledAt: status === 'cancelled' ? now : undefined,
        updatedAt: now,
      })
      .where(and(eq(userGoals.id, id), eq(userGoals.tenantId, tenantId)));
  }
}

function toRecord(row: typeof userGoals.$inferSelect): UserGoalRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    title: row.title,
    description: row.description ?? undefined,
    category: row.category,
    status: row.status,
    priority: row.priority,
    targetDate: row.targetDate ?? undefined,
    sourceMessageIds: row.sourceMessageIds,
    confidence: Number(row.confidence),
    completedAt: row.completedAt ?? undefined,
    cancelledAt: row.cancelledAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
