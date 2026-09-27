import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, text, timestamp, uniqueIndex, uuid, boolean } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/** Customer-provisioned identity. Legacy conversation users have no row until reconciliation. */
export const people = pgTable('people', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  customerEmployeeId: text('customer_employee_id').notNull(),
  workEmail: text('work_email').notNull(),
  displayName: text('display_name').notNull(),
  jobTitle: text('job_title'),
  primaryRole: text('primary_role').notNull(),
  pulseParticipant: boolean('pulse_participant').notNull(),
  lifecycleStatus: text('lifecycle_status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userTenant: foreignKey({ columns: [t.id, t.tenantId], foreignColumns: [users.id, users.tenantId] }).onDelete('cascade'),
  idTenantUnique: uniqueIndex('people_id_tenant_id_unique_idx').on(t.id, t.tenantId),
  customerEmployeeUnique: uniqueIndex('people_tenant_customer_employee_id_idx').on(t.tenantId, t.customerEmployeeId),
  workEmailUnique: uniqueIndex('people_tenant_work_email_idx').on(t.tenantId, t.workEmail),
  employeeIdNotBlank: check('people_customer_employee_id_not_blank', sql`length(btrim(${t.customerEmployeeId})) > 0`),
  emailNormalized: check('people_work_email_normalized', sql`${t.workEmail} = lower(btrim(${t.workEmail})) AND ${t.workEmail} <> ''`),
  nameNotBlank: check('people_display_name_not_blank', sql`length(btrim(${t.displayName})) > 0`),
  rolePulseMapping: check('people_role_pulse_mapping', sql`(${t.primaryRole} IN ('employee', 'team_lead') AND ${t.pulseParticipant} = true) OR (${t.primaryRole} IN ('manager', 'hr', 'hrbp', 'leadership') AND ${t.pulseParticipant} = false)`),
  lifecycleValid: check('people_lifecycle_status_valid', sql`${t.lifecycleStatus} IN ('draft', 'active', 'inactive')`),
}));

export type DbPerson = typeof people.$inferSelect;
export type DbNewPerson = typeof people.$inferInsert;
