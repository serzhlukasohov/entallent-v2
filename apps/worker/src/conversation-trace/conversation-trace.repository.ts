import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { conversationTurnTraces, featureFlags } from '@entalent/database';
import { LocalEncryptionAdapter } from '../crypto/local-encryption.adapter';
import { DatabaseService } from '../database/database.service';

/** Per-tenant switch. Only a tenant-specific row counts; a global row never turns tracing on. */
export const CONVERSATION_TRACE_FLAG = 'conversation_trace';

export interface TurnTraceRow {
  tenantId: string;
  userId: string;
  conversationId: string;
  inboundMessageId: string;
  outboundMessageId: string | null;
  traceId: string | null;
  status: 'completed' | 'failed';
  schemaVersion: number;
  /** Serialized `TracedTurnPayload`; encrypted here, never stored or logged in clear. */
  payloadJson: string;
  startedAt: Date;
  completedAt: Date;
}

/**
 * Storage of traced turns. Every statement goes through the pool client, never a turn's
 * transaction, so a trace write can neither join nor roll back the turn it describes.
 */
@Injectable()
export class ConversationTraceRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly encryption: LocalEncryptionAdapter,
  ) {}

  async isTracingEnabled(tenantId: string): Promise<boolean> {
    const [flag] = await this.db.rootClient
      .select({ enabled: featureFlags.enabled })
      .from(featureFlags)
      .where(and(eq(featureFlags.key, CONVERSATION_TRACE_FLAG), eq(featureFlags.tenantId, tenantId)))
      // No unique (key, tenant) constraint exists: the most recently changed row decides.
      .orderBy(desc(featureFlags.updatedAt))
      .limit(1);
    return flag?.enabled === true;
  }

  async insert(row: TurnTraceRow): Promise<void> {
    const { payloadJson, ...columns } = row;
    const payloadEncrypted = await this.encryption.encrypt(payloadJson);
    await this.db.rootClient.insert(conversationTurnTraces).values({ ...columns, payloadEncrypted });
  }

  /** Deletes up to `limit` traces created before `cutoff`, oldest first; returns how many went. */
  async purgeCreatedBefore(cutoff: Date, limit: number): Promise<number> {
    const expired = await this.db.rootClient
      .select({ id: conversationTurnTraces.id })
      .from(conversationTurnTraces)
      .where(lt(conversationTurnTraces.createdAt, cutoff))
      .orderBy(conversationTurnTraces.createdAt)
      .limit(limit);
    if (expired.length === 0) return 0;
    const deleted = await this.db.rootClient
      .delete(conversationTurnTraces)
      .where(inArray(conversationTurnTraces.id, expired.map((row) => row.id)))
      .returning({ id: conversationTurnTraces.id });
    return deleted.length;
  }
}
