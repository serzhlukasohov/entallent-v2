import { pgTable, uuid, jsonb, numeric, integer, timestamp, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const userStyleProfiles = pgTable(
  'user_style_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // Observed user style, EMA per dimension, each 0..1
    dimensions: jsonb('dimensions').notNull().default({ register: 0.5, humor: 0.3, verbosity: 0.5, emoji: 0.2 }),
    // Up to 5 characteristic phrases/emoji: [{ text, count }]
    phrases: jsonb('phrases').notNull().default([]),
    adaptationWeight: numeric('adaptation_weight', { precision: 4, scale: 3 }).notNull().default('0'),
    conversationsAnalyzed: integer('conversations_analyzed').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueUserTenant: unique('user_style_profiles_user_tenant_key').on(t.userId, t.tenantId),
  }),
);

export type DbUserStyleProfile = typeof userStyleProfiles.$inferSelect;
export type DbNewUserStyleProfile = typeof userStyleProfiles.$inferInsert;
