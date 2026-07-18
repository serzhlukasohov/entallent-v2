import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { riskSignals } from '@entalent/database';
import type { RiskSignalRepositoryPort, RiskSignalRecord, SaveRiskSignalParams } from '@entalent/application';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class RiskSignalRepository implements RiskSignalRepositoryPort {
  constructor(private readonly db: DatabaseService) {}

  async save(params: SaveRiskSignalParams): Promise<RiskSignalRecord> {
    const [row] = await this.db.client
      .insert(riskSignals)
      .values({
        tenantId: params.tenantId,
        userId: params.userId,
        type: params.type,
        severity: params.severity,
        confidence: String(params.confidence),
        evidenceMessageIds: params.evidenceMessageIds,
        status: 'active',
        policyVersion: params.policyVersion,
        expiresAt: params.expiresAt,
      })
      .returning();

    return mapRow(row);
  }

  async findActiveByUser(userId: string, tenantId: string): Promise<RiskSignalRecord[]> {
    const rows = await this.db.client
      .select()
      .from(riskSignals)
      .where(
        and(
          eq(riskSignals.userId, userId),
          eq(riskSignals.tenantId, tenantId),
          eq(riskSignals.status, 'active'),
        ),
      );

    return rows.map(mapRow);
  }

  async resolve(id: string, tenantId: string): Promise<void> {
    await this.db.client
      .update(riskSignals)
      .set({ status: 'resolved', resolvedAt: new Date() })
      .where(and(eq(riskSignals.id, id), eq(riskSignals.tenantId, tenantId)));
  }
}

function mapRow(row: typeof riskSignals.$inferSelect): RiskSignalRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    type: row.type,
    severity: row.severity,
    confidence: Number(row.confidence),
    evidenceMessageIds: row.evidenceMessageIds ?? [],
    status: row.status,
    recommendedAction: row.recommendedAction ?? undefined,
    policyVersion: row.policyVersion ?? undefined,
    detectedAt: row.detectedAt,
    resolvedAt: row.resolvedAt ?? undefined,
    expiresAt: row.expiresAt ?? undefined,
  };
}
