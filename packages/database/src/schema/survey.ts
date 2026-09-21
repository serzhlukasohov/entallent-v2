import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  numeric,
  integer,
  boolean,
  unique,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { teams } from './teams';
import { workspaceConnections } from './workspace-connections';

export const surveyDefinitions = pgTable('survey_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  version: text('version').notNull(),
  active: boolean('active').notNull().default(true),
  configuration: jsonb('configuration').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const surveyQuestions = pgTable(
  'survey_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    surveyDefinitionId: uuid('survey_definition_id')
      .notNull()
      .references(() => surveyDefinitions.id, { onDelete: 'cascade' }),
    stableKey: text('stable_key').notNull(),
    title: text('title').notNull(),
    canonicalMeaning: text('canonical_meaning').notNull(),
    dimension: text('dimension').notNull(),
    evidenceRequirements: jsonb('evidence_requirements').notNull().default({}),
    positiveIndicators: jsonb('positive_indicators').notNull().default([]),
    negativeIndicators: jsonb('negative_indicators').notNull().default([]),
    probeStrategies: jsonb('probe_strategies').notNull().default([]),
    contraindications: jsonb('contraindications').notNull().default([]),
    confidenceThreshold: numeric('confidence_threshold', { precision: 3, scale: 2 })
      .notNull()
      .default('0.75'),
    completenessThreshold: numeric('completeness_threshold', { precision: 3, scale: 2 })
      .notNull()
      .default('0.70'),
    minimumEvidenceCount: integer('minimum_evidence_count').notNull().default(2),
    cooldownDays: integer('cooldown_days').notNull().default(7),
    maxFollowUpProbes: integer('max_follow_up_probes').notNull().default(3),
    scoringConfiguration: jsonb('scoring_configuration').notNull().default({}),
    displayOrder: integer('display_order').notNull().default(0),
    questionGroup: text('question_group').notNull().default('autonomy'),
    responseType: text('response_type').notNull().default('open_ended'),
    version: text('version').notNull().default('1'),
  },
  (t) => ({
    uniqueKey: unique().on(t.surveyDefinitionId, t.stableKey),
  }),
);

export const surveyReportingCohorts = pgTable(
  'survey_reporting_cohorts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    surveyDefinitionId: uuid('survey_definition_id')
      .notNull()
      .references(() => surveyDefinitions.id, { onDelete: 'cascade' }),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    rosterUserIds: uuid('roster_user_ids').array().notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    uniqueScope: unique('survey_reporting_cohorts_scope_unique').on(
      t.tenantId,
      t.teamId,
      t.surveyDefinitionId,
      t.periodStart,
      t.periodEnd,
    ),
  }),
);

export const surveyWindows = pgTable('survey_windows', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  surveyDefinitionId: uuid('survey_definition_id')
    .notNull()
    .references(() => surveyDefinitions.id, { onDelete: 'cascade' }),
  periodType: text('period_type').notNull().default('quarter'),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  reportingCohortId: uuid('reporting_cohort_id').references(() => surveyReportingCohorts.id, {
    onDelete: 'set null',
  }),
  reportingTeamId: uuid('reporting_team_id').references(() => teams.id),
  reportingRosterUserIds: uuid('reporting_roster_user_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
  status: text('status').notNull().default('active'),
  coverage: jsonb('coverage').notNull().default({}),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const surveyEvidence = pgTable(
  'survey_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    surveyWindowId: uuid('survey_window_id')
      .notNull()
      .references(() => surveyWindows.id, { onDelete: 'cascade' }),
    surveyQuestionId: uuid('survey_question_id')
      .notNull()
      .references(() => surveyQuestions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceMessageIds: uuid('source_message_ids').array().notNull().default([]),
    evidenceSummary: text('evidence_summary').notNull(),
    polarity: text('polarity').notNull(), // positive | negative | neutral | mixed
    strength: numeric('strength', { precision: 3, scale: 2 }).notNull(),
    completeness: numeric('completeness', { precision: 3, scale: 2 }).notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    evaluatorVersion: text('evaluator_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => ({
    windowQuestionIdx: index('survey_evidence_window_question_idx').on(
      t.surveyWindowId,
      t.surveyQuestionId,
    ),
  }),
);

export const surveyAssessments = pgTable('survey_assessments', {
  id: uuid('id').primaryKey().defaultRandom(),
  surveyWindowId: uuid('survey_window_id')
    .notNull()
    .references(() => surveyWindows.id, { onDelete: 'cascade' }),
  surveyQuestionId: uuid('survey_question_id')
    .notNull()
    .references(() => surveyQuestions.id, { onDelete: 'cascade' }),
  score: numeric('score', { precision: 4, scale: 2 }),
  confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull().default('0'),
  status: text('status').notNull().default('unknown'), // unknown | insufficient_evidence | partially_covered | covered | scored | needs_review | suppressed
  reasoningSummary: text('reasoning_summary'),
  evidenceIds: uuid('evidence_ids').array().notNull().default([]),
  evaluatorVersion: text('evaluator_version').notNull(),
  calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
});

export const surveyReportSnapshots = pgTable(
  'survey_report_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reportingCohortId: uuid('reporting_cohort_id')
      .notNull()
      .references(() => surveyReportingCohorts.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    questionGroup: text('question_group').notNull(),
    snapshotVersion: integer('snapshot_version').notNull().default(1),
    status: text('status').notNull(),
    managerPayload: jsonb('manager_payload').notNull(),
    contributorUserIds: uuid('contributor_user_ids').array().notNull(),
    sourceGroupStateIds: uuid('source_group_state_ids').array().notNull(),
    policyVersion: text('policy_version').notNull(),
    workspaceConnectionId: uuid('workspace_connection_id').references(() => workspaceConnections.id, {
      onDelete: 'set null',
    }),
    managerSlackUserId: text('manager_slack_user_id'),
    slackExternalMessageId: text('slack_external_message_id'),
    failureReason: text('failure_reason'),
    deliveryAttemptedAt: timestamp('delivery_attempted_at', { withTimezone: true }),
    statusUpdatedAt: timestamp('status_updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    firstNonCancelledUnique: uniqueIndex('survey_report_snapshots_first_non_cancelled_unique')
      .on(t.tenantId, t.reportingCohortId, t.questionGroup, t.snapshotVersion)
      .where(sql`${t.status} <> 'cancelled'`),
    scopeIdx: index('survey_report_snapshots_scope_idx').on(t.tenantId, t.reportingCohortId, t.questionGroup),
  }),
);

export type DbSurveyDefinition = typeof surveyDefinitions.$inferSelect;
export type DbNewSurveyDefinition = typeof surveyDefinitions.$inferInsert;
export type DbSurveyQuestion = typeof surveyQuestions.$inferSelect;
export type DbNewSurveyQuestion = typeof surveyQuestions.$inferInsert;
export type DbSurveyReportingCohort = typeof surveyReportingCohorts.$inferSelect;
export type DbNewSurveyReportingCohort = typeof surveyReportingCohorts.$inferInsert;
export type DbSurveyWindow = typeof surveyWindows.$inferSelect;
export type DbNewSurveyWindow = typeof surveyWindows.$inferInsert;
export type DbSurveyEvidence = typeof surveyEvidence.$inferSelect;
export type DbNewSurveyEvidence = typeof surveyEvidence.$inferInsert;
export type DbSurveyAssessment = typeof surveyAssessments.$inferSelect;
export type DbNewSurveyAssessment = typeof surveyAssessments.$inferInsert;
export type DbSurveyReportSnapshot = typeof surveyReportSnapshots.$inferSelect;
export type DbNewSurveyReportSnapshot = typeof surveyReportSnapshots.$inferInsert;
