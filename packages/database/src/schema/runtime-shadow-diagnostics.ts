import {
  pgTable,
  uuid,
  text,
  jsonb,
  integer,
  numeric,
  timestamp,
  index,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants';
import { messages } from './messages';
import { runtimeAttempts } from './runtime-attempts';

export const runtimeShadowDiagnostics = pgTable(
  'runtime_shadow_diagnostics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    runtimeAttemptId: uuid('runtime_attempt_id')
      .notNull()
      .references(() => runtimeAttempts.id, { onDelete: 'cascade' }),
    runtimeMode: text('runtime_mode').notNull(),
    traceId: text('trace_id').notNull(),
    runtimeVersion: text('runtime_version').notNull(),
    validationStatus: text('validation_status').notNull(),
    redactionStatus: text('redaction_status').notNull(),
    currentResult: jsonb('current_result').notNull(),
    candidateResult: jsonb('candidate_result').notNull(),
    riskComparison: jsonb('risk_comparison').notNull(),
    memoryComparison: jsonb('memory_comparison').notNull(),
    actionComparison: jsonb('action_comparison').notNull(),
    validationDetails: jsonb('validation_details').notNull(),
    redactionDetails: jsonb('redaction_details').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    modelCallCount: integer('model_call_count').notNull(),
    toolCallCount: integer('tool_call_count').notNull(),
    retryCount: integer('retry_count').notNull(),
    estimatedCost: numeric('estimated_cost', { precision: 10, scale: 6 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    attemptRuntimeVersionUnique: unique(
      'runtime_shadow_diagnostics_attempt_version_unique',
    ).on(t.runtimeAttemptId, t.runtimeVersion),
    tenantCreatedIdx: index('runtime_shadow_diagnostics_tenant_created_idx').on(
      t.tenantId,
      t.createdAt,
    ),
    traceIdx: index('runtime_shadow_diagnostics_trace_id_idx').on(t.traceId),
    messageIdx: index('runtime_shadow_diagnostics_message_id_idx').on(t.messageId),
    attemptIdx: index('runtime_shadow_diagnostics_attempt_id_idx').on(t.runtimeAttemptId),
    validationStatusIdx: index('runtime_shadow_diagnostics_validation_status_idx').on(
      t.validationStatus,
    ),
    redactionStatusIdx: index('runtime_shadow_diagnostics_redaction_status_idx').on(
      t.redactionStatus,
    ),
    runtimeModeCheck: check(
      'runtime_shadow_diagnostics_runtime_mode_check',
      sql`${t.runtimeMode} in ('typescript', 'maf_shadow', 'maf_canary', 'maf_disabled')`,
    ),
    validationStatusCheck: check(
      'runtime_shadow_diagnostics_validation_status_check',
      sql`${t.validationStatus} in ('valid', 'invalid', 'comparison_failed')`,
    ),
    redactionStatusCheck: check(
      'runtime_shadow_diagnostics_redaction_status_check',
      sql`${t.redactionStatus} in ('redacted', 'not_required', 'rejected')`,
    ),
  }),
);

export type DbRuntimeShadowDiagnostic = typeof runtimeShadowDiagnostics.$inferSelect;
export type DbNewRuntimeShadowDiagnostic = typeof runtimeShadowDiagnostics.$inferInsert;
