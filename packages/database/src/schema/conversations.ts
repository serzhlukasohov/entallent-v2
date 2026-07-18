import { pgTable, uuid, text, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelType: text('channel_type').notNull(),
    externalConversationId: text('external_conversation_id').notNull(),
    status: text('status').notNull().default('active'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    activeTopic: jsonb('active_topic'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueConversation: unique().on(t.tenantId, t.channelType, t.externalConversationId),
  }),
);

export type DbConversation = typeof conversations.$inferSelect;
export type DbNewConversation = typeof conversations.$inferInsert;
