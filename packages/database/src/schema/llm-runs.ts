import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  jsonb,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const llmRuns = pgTable(
  'llm_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    taskType: text('task_type').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version'),
    inputTokenCount: integer('input_token_count'),
    outputTokenCount: integer('output_token_count'),
    latencyMs: integer('latency_ms'),
    estimatedCost: numeric('estimated_cost', { precision: 10, scale: 6 }),
    status: text('status').notNull().default('success'),
    traceId: text('trace_id'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantTaskTypeIdx: index('llm_runs_tenant_task_type_idx').on(t.tenantId, t.taskType),
    traceIdx: index('llm_runs_trace_id_idx').on(t.traceId),
    createdAtIdx: index('llm_runs_created_at_idx').on(t.createdAt),
  }),
);

export const promptVersions = pgTable(
  'prompt_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    version: text('version').notNull(),
    contentHash: text('content_hash').notNull(),
    schemaVersion: text('schema_version').notNull(),
    modelConfiguration: jsonb('model_configuration').notNull().default({}),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueKeyVersion: unique('prompt_versions_key_version_unique').on(t.key, t.version),
  }),
);

export type DbLlmRun = typeof llmRuns.$inferSelect;
export type DbNewLlmRun = typeof llmRuns.$inferInsert;
export type DbPromptVersion = typeof promptVersions.$inferSelect;
export type DbNewPromptVersion = typeof promptVersions.$inferInsert;
