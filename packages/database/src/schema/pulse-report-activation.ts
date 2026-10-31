import { sql } from 'drizzle-orm';
import { check, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { people } from './people';

// RPT-10: native report activation. A missing control row means off; changed only by the operator script
// under revision compare-and-set, each change audited in the same transaction. Not feature_flags.
export const pulseReportActivationControls = pgTable('pulse_report_activation_controls', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull(),
  revision: integer('revision').notNull(),
  approvalReference: text('approval_reference').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, (t) => ({
  mode: check('pulse_activation_mode', sql`${t.mode} IN ('off', 'observe', 'deliver')`),
  deliverExpiry: check('pulse_activation_deliver_expiry', sql`${t.mode} <> 'deliver' OR ${t.expiresAt} IS NOT NULL`),
  revision: check('pulse_activation_revision', sql`${t.revision} > 0`),
  approval: check('pulse_activation_approval', sql`length(btrim(${t.approvalReference})) > 0 AND length(btrim(${t.updatedBy})) > 0`),
}));

// Durable scope identity across cycles (survey_report_scopes rows are per cycle). A null approved recipient
// keeps the scope observe-only even when the tenant is in deliver mode. A trigger enforces recipient tenancy.
export const pulseReportActivationScopes = pgTable('pulse_report_activation_scopes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  kind: text('kind').notNull(),
  orgUnitId: uuid('org_unit_id').notNull(),
  orgTeamId: uuid('org_team_id'),
  approvedRecipientPersonId: uuid('approved_recipient_person_id'),
}, (t) => ({
  control: foreignKey({ name: 'pulse_activation_scope_control_fk', columns: [t.tenantId], foreignColumns: [pulseReportActivationControls.tenantId] }).onDelete('cascade'),
  // SET NULL keeps the allowlist row; a trigger audits the erasure and bumps the control revision (0100).
  recipient: foreignKey({ name: 'pulse_activation_scope_recipient_fk', columns: [t.approvedRecipientPersonId], foreignColumns: [people.id] }).onDelete('set null'),
  identity: uniqueIndex('pulse_activation_scope_identity').on(t.tenantId, t.orgUnitId, t.kind, sql`coalesce(${t.orgTeamId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
  kind: check('pulse_activation_scope_kind', sql`(${t.kind} = 'team' AND ${t.orgTeamId} IS NOT NULL) OR (${t.kind} = 'manager_overall' AND ${t.orgTeamId} IS NULL)`),
}));

// Append-only audit; no tenant FK so evidence outlives tenant deletion. Update/delete/truncate are rejected by trigger.
export const pulseReportActivationEvents = pgTable('pulse_report_activation_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  revision: integer('revision').notNull(),
  operator: text('operator').notNull(),
  approvalReference: text('approval_reference').notNull(),
  before: jsonb('before'),
  after: jsonb('after').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, (t) => ({
  oneEventPerRevision: unique('pulse_activation_event_revision').on(t.tenantId, t.revision),
  revision: check('pulse_activation_event_revision_positive', sql`${t.revision} > 0`),
}));
