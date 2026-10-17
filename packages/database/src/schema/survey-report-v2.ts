import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { teams } from './teams';
import { surveyReportingCohorts } from './survey';
import { workspaceConnections } from './workspace-connections';

export const surveyV2ReportSnapshots = pgTable('survey_v2_report_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  reportingCohortId: uuid('reporting_cohort_id').notNull()
    .references(() => surveyReportingCohorts.id, { onDelete: 'cascade' }),
  teamId: uuid('team_id').notNull().references(() => teams.id),
  questionGroup: text('question_group').notNull(),
  reportKind: text('report_kind').notNull(),
  snapshotVersion: integer('snapshot_version').notNull().default(1),
  status: text('status').notNull(),
  managerPayload: jsonb('manager_payload').notNull(),
  contributorUserIds: uuid('contributor_user_ids').array().notNull(),
  sourceQuestionInsightIds: uuid('source_question_insight_ids').array().notNull(),
  policyVersion: text('policy_version').notNull(),
  calculationVersion: text('calculation_version').notNull(),
  workspaceConnectionId: uuid('workspace_connection_id')
    .references(() => workspaceConnections.id, { onDelete: 'set null' }),
  managerSlackChannelId: text('manager_slack_channel_id'),
  slackExternalMessageId: text('slack_external_message_id'),
  failureReason: text('failure_reason'),
  deliveryAttemptedAt: timestamp('delivery_attempted_at', { withTimezone: true }),
  statusUpdatedAt: timestamp('status_updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueVisibleVersion: uniqueIndex('survey_v2_report_snapshots_visible_version_idx')
    .on(t.tenantId, t.reportingCohortId, t.questionGroup, t.snapshotVersion)
    .where(sql`${t.status} <> 'cancelled'`),
  scopeIdx: index('survey_v2_report_snapshots_scope_idx')
    .on(t.tenantId, t.reportingCohortId, t.questionGroup),
}));

export type DbSurveyV2ReportSnapshot = typeof surveyV2ReportSnapshots.$inferSelect;
