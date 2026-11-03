import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { conversations } from './conversations';
import { messages } from './messages';
import { tenants } from './tenants';
import { users } from './users';

/**
 * Diagnostic trace of one conversation turn, recorded only for tenants with the
 * `conversation_trace` feature flag on (SPEC CAP-6). Unlike `conversation_turn_effects`, it holds
 * the turn's text and decisions, so everything except ids, status and times sits in one payload
 * encrypted with FIELD_ENCRYPTION_KEY. Rows are purged 30 days after `created_at`.
 */
export const conversationTurnTraces = pgTable('conversation_turn_traces', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  inboundMessageId: uuid('inbound_message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  /** Absent when the turn failed before an outbound message existed. */
  outboundMessageId: uuid('outbound_message_id'),
  traceId: text('trace_id'),
  status: text('status').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  /** AES-256-GCM ciphertext of the JSON `TracedTurnPayload` (`@entalent/conversation-trace`). */
  payloadEncrypted: text('payload_encrypted').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusCheck: check('conversation_turn_traces_status_check', sql`${t.status} in ('completed', 'failed')`),
  tenantConversationIdx: index('conversation_turn_traces_tenant_conversation_idx')
    .on(t.tenantId, t.conversationId, t.startedAt),
  tenantInboundIdx: index('conversation_turn_traces_tenant_inbound_idx').on(t.tenantId, t.inboundMessageId),
  tenantOutboundIdx: index('conversation_turn_traces_tenant_outbound_idx').on(t.tenantId, t.outboundMessageId),
  createdAtIdx: index('conversation_turn_traces_created_at_idx').on(t.createdAt),
}));

export type DbConversationTurnTrace = typeof conversationTurnTraces.$inferSelect;
export type DbNewConversationTurnTrace = typeof conversationTurnTraces.$inferInsert;
