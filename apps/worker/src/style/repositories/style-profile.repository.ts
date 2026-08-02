import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { userStyleProfiles } from '@entalent/database';
import type { StyleProfileRepositoryPort, StyleProfileRecord, StyleDimensions, StylePhrase } from '@entalent/application';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class StyleProfileRepository implements StyleProfileRepositoryPort {
  constructor(private readonly db: DatabaseService) {}

  async findByUser(userId: string, tenantId: string): Promise<StyleProfileRecord | null> {
    const [row] = await this.db.client
      .select()
      .from(userStyleProfiles)
      .where(and(eq(userStyleProfiles.userId, userId), eq(userStyleProfiles.tenantId, tenantId)))
      .limit(1);
    return row ? map(row) : null;
  }

  async upsert(p: StyleProfileRecord): Promise<StyleProfileRecord> {
    const [row] = await this.db.client
      .insert(userStyleProfiles)
      .values({
        userId: p.userId,
        tenantId: p.tenantId,
        dimensions: p.dimensions as never,
        phrases: p.phrases as never,
        adaptationWeight: String(p.adaptationWeight),
        conversationsAnalyzed: p.conversationsAnalyzed,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [userStyleProfiles.userId, userStyleProfiles.tenantId],
        set: {
          dimensions: p.dimensions as never,
          phrases: p.phrases as never,
          adaptationWeight: String(p.adaptationWeight),
          conversationsAnalyzed: p.conversationsAnalyzed,
          updatedAt: new Date(),
        },
      })
      .returning();
    return map(row);
  }
}

function map(row: typeof userStyleProfiles.$inferSelect): StyleProfileRecord {
  return {
    userId: row.userId,
    tenantId: row.tenantId,
    dimensions: row.dimensions as StyleDimensions,
    phrases: row.phrases as StylePhrase[],
    adaptationWeight: Number(row.adaptationWeight),
    conversationsAnalyzed: row.conversationsAnalyzed,
    updatedAt: row.updatedAt,
  };
}
