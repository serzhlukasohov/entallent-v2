import { pgTable, uuid, text, timestamp, numeric, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const userGoals = pgTable(
  'user_goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    category: text('category').notNull().default('general'),
    status: text('status').notNull().default('active'),
    priority: text('priority').notNull().default('normal'),
    targetDate: timestamp('target_date', { withTimezone: true }),
    sourceMessageIds: uuid('source_message_ids').array().notNull().default([]),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull().default('0.80'),
    nextCheckInAt: timestamp('next_check_in_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userStatusIdx: index('user_goals_user_status_idx').on(t.userId, t.status),
  }),
);

export type DbUserGoal = typeof userGoals.$inferSelect;
export type DbNewUserGoal = typeof userGoals.$inferInsert;
