import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

// Content-free runtime projection. Customer-facing readers may only aggregate
// these rows after applying their cohort boundary.
export const conversationActivityDaily = pgTable(
  'conversation_activity_daily',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    inboundCount: integer('inbound_count').notNull().default(0),
    outboundCount: integer('outbound_count').notNull().default(0),
    inboundNonInitCount: integer('inbound_non_init_count').notNull().default(0),
  },
  (t) => ({
    identity: primaryKey({ columns: [t.tenantId, t.userId, t.day] }),
    tenantDay: index('conversation_activity_daily_tenant_day_idx').on(t.tenantId, t.day),
    countsNonnegative: check('conversation_activity_daily_counts_nonnegative', sql`
      ${t.inboundCount} >= 0 AND ${t.outboundCount} >= 0 AND ${t.inboundNonInitCount} >= 0
      AND ${t.inboundNonInitCount} <= ${t.inboundCount}`),
  }),
);
