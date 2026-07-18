import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

// Audit log is append-only — no foreign keys on purpose (records must survive entity deletion)
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    actorType: text('actor_type').notNull(), // user | agent | system | admin
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    reason: text('reason'),
    metadata: jsonb('metadata').notNull().default({}),
    traceId: text('trace_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('audit_logs_tenant_idx').on(t.tenantId),
    actorIdx: index('audit_logs_actor_idx').on(t.actorType, t.actorId),
    resourceIdx: index('audit_logs_resource_idx').on(t.resourceType, t.resourceId),
    createdAtIdx: index('audit_logs_created_at_idx').on(t.createdAt),
  }),
);

export type DbAuditLog = typeof auditLogs.$inferSelect;
export type DbNewAuditLog = typeof auditLogs.$inferInsert;
