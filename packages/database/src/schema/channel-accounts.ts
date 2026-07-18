import { pgTable, uuid, text, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const channelAccounts = pgTable(
  'channel_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    channelType: text('channel_type').notNull(),
    externalWorkspaceId: text('external_workspace_id').notNull(),
    externalUserId: text('external_user_id').notNull(),
    displayName: text('display_name'),
    profileMetadata: jsonb('profile_metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueAccount: unique().on(t.channelType, t.externalWorkspaceId, t.externalUserId),
  }),
);

export type DbChannelAccount = typeof channelAccounts.$inferSelect;
export type DbNewChannelAccount = typeof channelAccounts.$inferInsert;
