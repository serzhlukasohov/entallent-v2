import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants';
import { messages } from './messages';

export const runtimeAttempts = pgTable(
  'runtime_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    requestId: text('request_id').notNull(),
    eventId: text('event_id').notNull(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    runtimeAttempt: integer('runtime_attempt').notNull(),
    traceId: text('trace_id').notNull(),
    runtimeMode: text('runtime_mode').notNull(),
    phase: text('phase').notNull().default('started'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    durableAttemptUnique: unique('runtime_attempts_durable_attempt_unique').on(
      t.tenantId,
      t.requestId,
      t.eventId,
      t.messageId,
      t.runtimeAttempt,
    ),
    traceIdx: index('runtime_attempts_trace_id_idx').on(t.traceId),
    messageIdx: index('runtime_attempts_message_id_idx').on(t.messageId),
    requestEventIdx: index('runtime_attempts_request_event_idx').on(t.requestId, t.eventId),
    phaseIdx: index('runtime_attempts_phase_idx').on(t.phase),
    runtimeModeCheck: check(
      'runtime_attempts_runtime_mode_check',
      sql`${t.runtimeMode} in ('typescript', 'maf_shadow', 'maf_canary', 'maf_disabled')`,
    ),
    phaseCheck: check(
      'runtime_attempts_phase_check',
      sql`${t.phase} in ('started', 'candidate_received', 'actions_validated', 'actions_committed', 'reply_committed', 'failed')`,
    ),
  }),
);

export type DbRuntimeAttempt = typeof runtimeAttempts.$inferSelect;
export type DbNewRuntimeAttempt = typeof runtimeAttempts.$inferInsert;
