import { Injectable } from '@nestjs/common';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { memoryItems } from '@entalent/database';
import type {
  MemoryRepositoryPort,
  SaveMemoryItemParams,
  MemoryItemRecord,
} from '@entalent/application';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class MemoryRepository implements MemoryRepositoryPort {
  constructor(private readonly db: DatabaseService) {}

  async findActiveByUser(
    userId: string,
    tenantId: string,
    limit = 30,
  ): Promise<MemoryItemRecord[]> {
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
      )
      .orderBy(desc(memoryItems.importance))
      .limit(limit);

    return rows.map(toRecord);
  }

  async findByCanonicalKey(
    userId: string,
    canonicalKey: string,
    tenantId: string,
  ): Promise<MemoryItemRecord | null> {
    const [row] = await this.db.client
      .select()
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.userId, userId),
          eq(memoryItems.tenantId, tenantId),
          eq(memoryItems.canonicalKey, canonicalKey),
          eq(memoryItems.status, 'active'),
        ),
      )
      .limit(1);

    return row ? toRecord(row) : null;
  }

  async findById(id: string, tenantId: string): Promise<MemoryItemRecord | null> {
    const [row] = await this.db.client
      .select()
      .from(memoryItems)
      .where(and(eq(memoryItems.id, id), eq(memoryItems.tenantId, tenantId)))
      .limit(1);

    return row ? toRecord(row) : null;
  }

  async save(params: SaveMemoryItemParams): Promise<MemoryItemRecord> {
    const [row] = await this.db.client
      .insert(memoryItems)
      .values({
        tenantId: params.tenantId,
        userId: params.userId,
        category: params.category,
        canonicalKey: params.canonicalKey,
        content: params.content,
        structuredValue: params.structuredValue ?? null,
        confidence: String(params.confidence),
        importance: String(params.importance),
        sensitivity: params.sensitivity,
        status: 'active',
        sourceMessageIds: params.sourceMessageIds,
        sourceType: 'extraction',
        expiresAt: params.expiresAt,
        extractorVersion: params.extractorVersion,
      })
      .returning();

    return toRecord(row);
  }

  async supersede(oldItemId: string, newItemId: string): Promise<void> {
    await this.db.client
      .update(memoryItems)
      .set({ status: 'superseded', supersededById: newItemId, updatedAt: new Date() })
      .where(eq(memoryItems.id, oldItemId));
  }

  async softDelete(id: string, tenantId: string): Promise<void> {
    await this.db.client
      .update(memoryItems)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(and(eq(memoryItems.id, id), eq(memoryItems.tenantId, tenantId)));
  }
}

function toRecord(row: typeof memoryItems.$inferSelect): MemoryItemRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    category: row.category,
    canonicalKey: row.canonicalKey ?? undefined,
    content: row.content,
    structuredValue: (row.structuredValue as Record<string, unknown>) ?? undefined,
    confidence: Number(row.confidence),
    importance: Number(row.importance),
    sensitivity: row.sensitivity,
    status: row.status,
    sourceMessageIds: row.sourceMessageIds,
    sourceType: row.sourceType,
    validFrom: row.validFrom,
    expiresAt: row.expiresAt ?? undefined,
    supersededById: row.supersededById ?? undefined,
    extractorVersion: row.extractorVersion ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
