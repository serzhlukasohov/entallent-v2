import { pgTable, uuid, text, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const workspaceConnections = pgTable(
  'workspace_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    channelType: text('channel_type').notNull(),
    externalWorkspaceId: text('external_workspace_id').notNull(),
    encryptedCredentials: text('encrypted_credentials').notNull(),
    status: text('status').notNull().default('active'),
    scopes: jsonb('scopes').notNull().default([]),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
  },
  (t) => ({
    uniqueWorkspace: unique().on(t.channelType, t.externalWorkspaceId),
  }),
);

export type DbWorkspaceConnection = typeof workspaceConnections.$inferSelect;
export type DbNewWorkspaceConnection = typeof workspaceConnections.$inferInsert;
