import { pgTable, uuid, text, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('active'),
  preferredName: text('preferred_name'),
  timezone: text('timezone'),
  locale: text('locale').notNull().default('en'),
  communicationPreferences: jsonb('communication_preferences').notNull().default({}),
  proactiveMessagingEnabled: boolean('proactive_messaging_enabled').notNull().default(true),
  quietHours: jsonb('quiet_hours').notNull().default({ enabled: false }),
  onboardingStatus: text('onboarding_status').notNull().default('pending'),
  consentState: jsonb('consent_state').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type DbUser = typeof users.$inferSelect;
export type DbNewUser = typeof users.$inferInsert;
