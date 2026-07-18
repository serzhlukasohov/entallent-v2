import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { conversations } from './conversations';

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(), // inbound | outbound
    senderType: text('sender_type').notNull(), // user | agent | system
    externalMessageId: text('external_message_id'),
    externalThreadId: text('external_thread_id'),
    text: text('text').notNull(),
    normalizedText: text('normalized_text'),
    messageType: text('message_type').notNull().default('text'),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    traceId: text('trace_id'),
    promptVersion: text('prompt_version'),
    model: text('model'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    conversationIdx: index('messages_conversation_id_idx').on(t.conversationId),
    userIdx: index('messages_user_id_idx').on(t.userId),
    occurredAtIdx: index('messages_occurred_at_idx').on(t.occurredAt),
    externalMsgIdx: index('messages_external_message_id_idx').on(t.externalMessageId),
  }),
);

export type DbMessage = typeof messages.$inferSelect;
export type DbNewMessage = typeof messages.$inferInsert;
