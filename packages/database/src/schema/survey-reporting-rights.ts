import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { conversations } from './conversations';

// RPT-09: server-stored menu tokens. A Slack button value names only a menu id plus an option index;
// the subject, routing and offered lineage set live here. Content-free: no question text or answers.
export const surveyReportingRightsMenus = pgTable('survey_reporting_rights_menus', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(), userId: uuid('user_id').notNull(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  channelType: text('channel_type').notNull(), externalWorkspaceId: text('external_workspace_id').notNull(),
  externalChannelId: text('external_channel_id').notNull(),
  /** Personal language fixed when the root menu opened; every later step of this menu reuses it. */
  locale: text('locale').notNull(),
  kind: text('kind').notNull(), parentMenuId: uuid('parent_menu_id'), targetKind: text('target_kind'),
  lineageIds: uuid('lineage_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
}, (t) => ({
  subject: foreignKey({ columns: [t.userId, t.tenantId], foreignColumns: [users.id, users.tenantId] }).onDelete('cascade'),
  subjectMenu: unique('reporting_rights_menu_subject_id').on(t.tenantId, t.userId, t.id),
  parent: foreignKey({ name: 'reporting_rights_menu_parent_fk', columns: [t.tenantId, t.userId, t.parentMenuId], foreignColumns: [t.tenantId, t.userId, t.id] }).onDelete('cascade'),
  shape: check('reporting_rights_menu_shape', sql`(${t.kind} = 'root' AND ${t.parentMenuId} IS NULL AND ${t.targetKind} IS NULL)
    OR (${t.kind} = 'confirm' AND ${t.parentMenuId} IS NOT NULL AND ((${t.targetKind} = 'full_reporting' AND cardinality(${t.lineageIds}) = 0) OR (${t.targetKind} = 'partial_reporting' AND cardinality(${t.lineageIds}) > 0)))`),
  expiry: check('reporting_rights_menu_expiry', sql`${t.expiresAt} > ${t.createdAt}`),
}));

// Durable admission of one verified Confirm click, committed before Slack is acknowledged. Redis only
// transports its id; `received_at` is the DB clock and `request_id` derives from the admission id.
export const surveyReportingRightsAdmissions = pgTable('survey_reporting_rights_admissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(), userId: uuid('user_id').notNull(), menuId: uuid('menu_id').notNull(),
  channelType: text('channel_type').notNull(), externalWorkspaceId: text('external_workspace_id').notNull(),
  externalUserId: text('external_user_id').notNull(), actionTs: text('action_ts').notNull(),
  requestId: text('request_id').notNull(), targetKind: text('target_kind').notNull(),
  lineageIds: uuid('lineage_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().default(sql`date_trunc('milliseconds', clock_timestamp())`),
  status: text('status').notNull().default('admitted'), failureReason: text('failure_reason'),
  permissionRevision: integer('permission_revision'),
  applyAttempts: integer('apply_attempts').notNull().default(0),
  settledAt: timestamp('settled_at', { withTimezone: true }), confirmationMessageId: uuid('confirmation_message_id'),
}, (t) => ({
  subject: foreignKey({ columns: [t.userId, t.tenantId], foreignColumns: [users.id, users.tenantId] }).onDelete('cascade'),
  menu: foreignKey({ name: 'reporting_rights_admission_menu_fk', columns: [t.tenantId, t.userId, t.menuId], foreignColumns: [surveyReportingRightsMenus.tenantId, surveyReportingRightsMenus.userId, surveyReportingRightsMenus.id] }).onDelete('cascade'),
  oneAdmissionPerMenu: unique('reporting_rights_admission_menu').on(t.menuId),
  slackAction: unique('reporting_rights_admission_action').on(t.channelType, t.externalWorkspaceId, t.externalUserId, t.actionTs),
  requestIdentity: unique('reporting_rights_admission_request').on(t.tenantId, t.requestId),
  derivedRequest: check('reporting_rights_admission_request_derived', sql`${t.requestId} = 'reporting-rights:' || ${t.id}::text`),
  target: check('reporting_rights_admission_target', sql`(${t.targetKind} = 'full_reporting' AND cardinality(${t.lineageIds}) = 0) OR (${t.targetKind} = 'partial_reporting' AND cardinality(${t.lineageIds}) > 0)`),
  status: check('reporting_rights_admission_status', sql`(${t.status} = 'admitted' AND ${t.settledAt} IS NULL AND ${t.failureReason} IS NULL AND ${t.permissionRevision} IS NULL)
    OR (${t.status} = 'applied' AND ${t.settledAt} IS NOT NULL AND ${t.failureReason} IS NULL AND ${t.permissionRevision} IS NOT NULL)
    OR (${t.status} IN ('rejected', 'failed') AND ${t.settledAt} IS NOT NULL AND ${t.failureReason} IN ('stale_target', 'subject_mismatch', 'idempotency_conflict', 'apply_attempts_exhausted') AND ${t.permissionRevision} IS NULL)`),
  attempts: check('reporting_rights_admission_attempts', sql`${t.applyAttempts} >= 0`),
  repair: index('reporting_rights_admission_repair').on(t.status, t.receivedAt),
}));
