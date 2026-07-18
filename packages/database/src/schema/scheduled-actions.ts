import { pgTable, uuid, text, jsonb, timestamp, integer, unique, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { conversations } from './conversations';

export const scheduledActions = pgTable(
  'scheduled_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    intent: text('intent').notNull(),
    context: jsonb('context').notNull().default({}),
    reason: text('reason'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    allowedWindowStart: timestamp('allowed_window_start', { withTimezone: true }),
    allowedWindowEnd: timestamp('allowed_window_end', { withTimezone: true }),
    timezone: text('timezone').notNull().default('UTC'),
    status: text('status').notNull().default('pending'), // pending | sent | cancelled | postponed | merged
    relevancePolicy: jsonb('relevance_policy').notNull().default({}),
    cancellationConditions: jsonb('cancellation_conditions').notNull().default([]),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    deduplicationKey: text('deduplication_key'),
    sourceMessageIds: uuid('source_message_ids').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueDedup: unique('scheduled_actions_dedup_key_unique').on(t.deduplicationKey),
    userStatusIdx: index('scheduled_actions_user_status_idx').on(t.userId, t.status),
    dueAtIdx: index('scheduled_actions_due_at_idx').on(t.dueAt, t.status),
  }),
);

export type DbScheduledAction = typeof scheduledActions.$inferSelect;
export type DbNewScheduledAction = typeof scheduledActions.$inferInsert;
