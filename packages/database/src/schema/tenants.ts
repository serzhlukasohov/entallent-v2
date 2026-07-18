import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  timezone: text('timezone').notNull().default('UTC'),
  locale: text('locale').notNull().default('en'),
  retentionPolicy: jsonb('retention_policy').notNull().default({}),
  safetyPolicy: jsonb('safety_policy').notNull().default({}),
  proactiveMessagingPolicy: jsonb('proactive_messaging_policy').notNull().default({}),
  surveyConfiguration: jsonb('survey_configuration').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type DbTenant = typeof tenants.$inferSelect;
export type DbNewTenant = typeof tenants.$inferInsert;
