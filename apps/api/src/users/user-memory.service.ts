import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { memoryItems } from '@entalent/database';
import type { MemoryItemRecord } from '@entalent/application';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class UserMemoryService {
  constructor(private readonly db: DatabaseService) {}

  async listActiveMemory(userId: string, tenantId: string): Promise<MemoryItemRecord[]> {
    const rows = await this.db.client
      .select()
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.userId, userId),
          eq(memoryItems.tenantId, tenantId),
          eq(memoryItems.status, 'active'),
          isNull(memoryItems.supersededById),
        ),
      );

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      userId: r.userId,
      category: r.category,
      canonicalKey: r.canonicalKey ?? undefined,
      content: r.content,
      structuredValue: (r.structuredValue as Record<string, unknown>) ?? undefined,
      confidence: Number(r.confidence),
      importance: Number(r.importance),
      sensitivity: r.sensitivity,
      status: r.status,
      sourceMessageIds: r.sourceMessageIds,
      sourceType: r.sourceType,
      validFrom: r.validFrom,
      expiresAt: r.expiresAt ?? undefined,
      supersededById: r.supersededById ?? undefined,
      extractorVersion: r.extractorVersion ?? undefined,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async deleteMemoryItem(id: string, userId: string, tenantId: string): Promise<void> {
    const [existing] = await this.db.client
      .select({ id: memoryItems.id })
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.id, id),
          eq(memoryItems.userId, userId),
          eq(memoryItems.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!existing) throw new NotFoundException(`Memory item ${id} not found`);

    await this.db.client
      .update(memoryItems)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(eq(memoryItems.id, id));
  }
}
