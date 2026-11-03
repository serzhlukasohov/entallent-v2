import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, lt, or } from 'drizzle-orm';
import { conversationTurnTraces, featureFlags } from '@entalent/database';
import { DatabaseService } from '../database/database.service';

/**
 * Per-tenant marker: the tenant's conversations are test data, so a traced turn may become a
 * repository fixture (SPEC CAP-8). Only a tenant-specific row counts; a global row never marks a tenant.
 */
export const TEST_TENANT_FLAG = 'conversation_trace_test_tenant';

/** One stored trace row; the payload stays encrypted until the service decrypts it. */
export interface StoredTraceRow {
  id: string;
  userId: string;
  conversationId: string;
  inboundMessageId: string;
  outboundMessageId: string | null;
  traceId: string | null;
  status: string;
  schemaVersion: number;
  payloadEncrypted: string;
  startedAt: Date;
  completedAt: Date;
}

/** Keyset position: rows strictly older than this come next. */
export interface TraceCursor {
  startedAt: Date;
  id: string;
}

const columns = {
  id: conversationTurnTraces.id,
  userId: conversationTurnTraces.userId,
  conversationId: conversationTurnTraces.conversationId,
  inboundMessageId: conversationTurnTraces.inboundMessageId,
  outboundMessageId: conversationTurnTraces.outboundMessageId,
  traceId: conversationTurnTraces.traceId,
  status: conversationTurnTraces.status,
  schemaVersion: conversationTurnTraces.schemaVersion,
  payloadEncrypted: conversationTurnTraces.payloadEncrypted,
  startedAt: conversationTurnTraces.startedAt,
  completedAt: conversationTurnTraces.completedAt,
};

/** Read side of `conversation_turn_traces`. Every statement is filtered by the caller's tenant. */
@Injectable()
export class ConversationTraceReader {
  constructor(private readonly db: DatabaseService) {}

  /** One page of a tenant's traces started at or after `since`, newest first. */
  async page(tenantId: string, since: Date, before: TraceCursor | null, size: number): Promise<StoredTraceRow[]> {
    return this.db.client
      .select(columns)
      .from(conversationTurnTraces)
      .where(and(
        eq(conversationTurnTraces.tenantId, tenantId),
        gte(conversationTurnTraces.startedAt, since),
        before
          ? or(
            lt(conversationTurnTraces.startedAt, before.startedAt),
            and(eq(conversationTurnTraces.startedAt, before.startedAt), lt(conversationTurnTraces.id, before.id)),
          )
          : undefined,
      ))
      .orderBy(desc(conversationTurnTraces.startedAt), desc(conversationTurnTraces.id))
      .limit(size);
  }

  /**
   * The newest `limit` traces of one conversation, oldest first, and how many older ones it has, so
   * each turn can be numbered by its place in the conversation.
   */
  async conversation(tenantId: string, conversationId: string, limit: number): Promise<{ rows: StoredTraceRow[]; olderCount: number }> {
    const scope = and(
      eq(conversationTurnTraces.tenantId, tenantId),
      eq(conversationTurnTraces.conversationId, conversationId),
    );
    const newest = await this.db.client
      .select(columns)
      .from(conversationTurnTraces)
      .where(scope)
      .orderBy(desc(conversationTurnTraces.startedAt), desc(conversationTurnTraces.id))
      .limit(limit);
    const rows = newest.reverse();
    const oldest = rows[0];
    if (!oldest) return { rows, olderCount: 0 };
    const [older] = await this.db.client
      .select({ total: count() })
      .from(conversationTurnTraces)
      // Same (started_at, id) order as above, so rows tied with the oldest one are counted exactly once.
      .where(and(scope, or(
        lt(conversationTurnTraces.startedAt, oldest.startedAt),
        and(eq(conversationTurnTraces.startedAt, oldest.startedAt), lt(conversationTurnTraces.id, oldest.id)),
      )));
    return { rows, olderCount: Number(older?.total ?? 0) };
  }

  /** One trace row of the tenant, or null when this tenant has no row with that id. */
  async turn(tenantId: string, traceRowId: string): Promise<StoredTraceRow | null> {
    const [row] = await this.db.client
      .select(columns)
      .from(conversationTurnTraces)
      .where(and(eq(conversationTurnTraces.tenantId, tenantId), eq(conversationTurnTraces.id, traceRowId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * When the tenant became a test tenant, or null when it is not one. The most recently changed
   * tenant row decides (no unique key exists; ties go to the newest id). The time is that row's
   * `updated_at`, so re-saving the mark only moves it later.
   */
  async testTenantSince(tenantId: string): Promise<Date | null> {
    const [flag] = await this.db.client
      .select({ enabled: featureFlags.enabled, updatedAt: featureFlags.updatedAt })
      .from(featureFlags)
      .where(and(eq(featureFlags.key, TEST_TENANT_FLAG), eq(featureFlags.tenantId, tenantId)))
      .orderBy(desc(featureFlags.updatedAt), desc(featureFlags.id))
      .limit(1);
    return flag?.enabled === true ? flag.updatedAt : null;
  }
}
