import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  numeric,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const memoryItems = pgTable(
  'memory_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    canonicalKey: text('canonical_key'),
    content: text('content').notNull(),
    structuredValue: jsonb('structured_value'),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull().default('0.80'),
    importance: numeric('importance', { precision: 3, scale: 2 }).notNull().default('0.50'),
    sensitivity: text('sensitivity').notNull().default('normal'),
    status: text('status').notNull().default('active'),
    sourceMessageIds: uuid('source_message_ids').array().notNull().default([]),
    sourceType: text('source_type').notNull().default('extraction'),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }),
    // Self-reference via lazy callback to avoid "used before defined" TS error
    supersededById: uuid('superseded_by_id').references(
      (): AnyPgColumn => memoryItems.id,
    ),
    extractorVersion: text('extractor_version'),
    promptVersion: text('prompt_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCategoryIdx: index('memory_items_user_category_idx').on(t.userId, t.category),
    statusIdx: index('memory_items_status_idx').on(t.status),
    canonicalKeyIdx: index('memory_items_canonical_key_idx').on(t.userId, t.canonicalKey),
  }),
);

export type DbMemoryItem = typeof memoryItems.$inferSelect;
export type DbNewMemoryItem = typeof memoryItems.$inferInsert;
