import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { runtimeAttempts } from './runtime-attempts';

export const runtimeActions = pgTable(
  'runtime_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    runtimeAttemptId: uuid('runtime_attempt_id')
      .notNull()
      .references(() => runtimeAttempts.id, { onDelete: 'cascade' }),
    actionId: text('action_id').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    actionType: text('action_type').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payload: jsonb('payload').notNull(),
    validationResult: jsonb('validation_result').notNull(),
    executionStatus: text('execution_status').notNull(),
    commitMarker: jsonb('commit_marker'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actionIdUnique: unique('runtime_actions_attempt_action_id_unique').on(
      t.runtimeAttemptId,
      t.actionId,
    ),
    idempotencyUnique: unique('runtime_actions_attempt_idempotency_unique').on(
      t.runtimeAttemptId,
      t.idempotencyKey,
    ),
    tenantActionIdx: index('runtime_actions_tenant_action_idx').on(t.tenantId, t.actionType),
    attemptIdx: index('runtime_actions_attempt_id_idx').on(t.runtimeAttemptId),
    idempotencyIdx: index('runtime_actions_idempotency_key_idx').on(t.idempotencyKey),
  }),
);

export type DbRuntimeAction = typeof runtimeActions.$inferSelect;
export type DbNewRuntimeAction = typeof runtimeActions.$inferInsert;
