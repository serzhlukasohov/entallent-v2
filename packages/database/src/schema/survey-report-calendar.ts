import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { surveyReportCycleOpenings } from './survey-report-scopes';
import { uuid } from 'drizzle-orm/pg-core';

export const tenantReportConfigRevisions = pgTable(
  'tenant_report_config_revisions',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    locale: text('locale'),
    calendar: jsonb('calendar'),
    unavailableReason: text('unavailable_reason'),
    sourceFingerprint: text('source_fingerprint').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.revision] }),
    readiness: check(
      'report_config_readiness',
      sql`${t.revision} > 0 AND (${t.unavailableReason} IS NULL AND ${t.locale} IS NOT NULL AND ${t.calendar} IS NOT NULL OR ${t.unavailableReason} IS NOT NULL AND ${t.unavailableReason} IN ('missing_calendar','invalid_calendar','invalid_locale'))`,
    ),
  }),
);
export const surveyReportFinalTimings = pgTable(
  'survey_report_final_timings',
  {
    tenantId: uuid('tenant_id').notNull(),
    cycleScoringPolicyId: uuid('cycle_scoring_policy_id').notNull(),
    configRevision: integer('config_revision').notNull(),
    algorithmVersion: text('algorithm_version').notNull(),
    status: text('status').notNull(),
    blockedReason: text('blocked_reason'),
    timezone: text('timezone'),
    localDate: text('local_date'),
    localWorkEnd: text('local_work_end'),
    finalDueAt: timestamp('final_due_at', { withTimezone: true }),
    formationStartedAt: timestamp('formation_started_at', { withTimezone: true }),
    reportDataCutoff: timestamp('report_data_cutoff', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.cycleScoringPolicyId] }),
    opening: foreignKey({
      columns: [t.tenantId, t.cycleScoringPolicyId],
      foreignColumns: [
        surveyReportCycleOpenings.tenantId,
        surveyReportCycleOpenings.cycleScoringPolicyId,
      ],
    }).onDelete('cascade'),
    config: foreignKey({
      columns: [t.tenantId, t.configRevision],
      foreignColumns: [tenantReportConfigRevisions.tenantId, tenantReportConfigRevisions.revision],
    }).onDelete('cascade'),
    shape: check(
      'report_final_timing_shape',
      sql`(${t.status} = 'blocked' AND ${t.blockedReason} IS NOT NULL AND ${t.blockedReason} IN ('missing_calendar','invalid_calendar','invalid_locale','source_out_of_sync','invalid_cycle','no_working_close_in_cycle','nonexistent_work_end','ambiguous_work_end') AND ${t.finalDueAt} IS NULL AND ${t.formationStartedAt} IS NULL AND ${t.reportDataCutoff} IS NULL) OR (${t.status} IN ('scheduled','started') AND ${t.blockedReason} IS NULL AND ${t.timezone} IS NOT NULL AND ${t.localDate} IS NOT NULL AND ${t.localWorkEnd} IS NOT NULL AND ${t.finalDueAt} IS NOT NULL AND ((${t.status} = 'scheduled' AND ${t.formationStartedAt} IS NULL AND ${t.reportDataCutoff} IS NULL) OR (${t.status} = 'started' AND ${t.formationStartedAt} IS NOT NULL AND ${t.reportDataCutoff} IS NOT NULL AND ${t.reportDataCutoff} = ${t.formationStartedAt} AND ${t.formationStartedAt} >= ${t.finalDueAt})))`,
    ),
  }),
);
