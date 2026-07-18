import { pgTable, uuid, text, timestamp, numeric, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const riskSignals = pgTable(
  'risk_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    severity: text('severity').notNull(), // low | medium | high | critical
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    evidenceMessageIds: uuid('evidence_message_ids').array().notNull().default([]),
    status: text('status').notNull().default('active'), // active | resolved | expired
    recommendedAction: text('recommended_action'),
    policyVersion: text('policy_version'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => ({
    userStatusIdx: index('risk_signals_user_status_idx').on(t.userId, t.status),
    severityIdx: index('risk_signals_severity_idx').on(t.severity, t.status),
  }),
);

export type DbRiskSignal = typeof riskSignals.$inferSelect;
export type DbNewRiskSignal = typeof riskSignals.$inferInsert;
