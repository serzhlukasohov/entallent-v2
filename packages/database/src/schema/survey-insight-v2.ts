import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { messages } from './messages';
import { conversations } from './conversations';
import { surveyDefinitions, surveyQuestions, surveyWindows } from './survey';

// Policies are immutable once a cycle binds to them. The forward migration
// enforces that rule in PostgreSQL, not only in the application adapter.
export const surveyScoringPolicies = pgTable(
  'survey_scoring_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    rubrics: jsonb('rubrics').notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantVersion: unique('survey_scoring_policies_tenant_version_key').on(t.tenantId, t.version),
    tenantIdKey: unique('survey_scoring_policies_tenant_id_key').on(t.tenantId, t.id),
    versionNotBlank: check('survey_scoring_policies_version_not_blank', sql`btrim(${t.version}) <> ''`),
    rubricsObject: check('survey_scoring_policies_rubrics_object', sql`jsonb_typeof(${t.rubrics}) = 'object'`),
  }),
);

export const surveyWindowScoringPolicies = pgTable(
  'survey_window_scoring_policies',
  {
    surveyWindowId: uuid('survey_window_id').primaryKey().references(() => surveyWindows.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    scoringPolicyId: uuid('scoring_policy_id').notNull(),
    boundAt: timestamp('bound_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    policyScope: foreignKey({
      name: 'survey_window_scoring_policies_tenant_policy_fk',
      columns: [t.tenantId, t.scoringPolicyId],
      foreignColumns: [surveyScoringPolicies.tenantId, surveyScoringPolicies.id],
    }),
  }),
);

export const surveyCycleScoringPolicies = pgTable(
  'survey_cycle_scoring_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    surveyDefinitionId: uuid('survey_definition_id').notNull().references(() => surveyDefinitions.id),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    scoringPolicyId: uuid('scoring_policy_id').notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    cycleScope: unique('survey_cycle_scoring_policies_scope_key').on(
      t.tenantId, t.surveyDefinitionId, t.periodStart, t.periodEnd,
    ),
    policyScope: foreignKey({
      name: 'survey_cycle_scoring_policies_tenant_policy_fk',
      columns: [t.tenantId, t.scoringPolicyId],
      foreignColumns: [surveyScoringPolicies.tenantId, surveyScoringPolicies.id],
    }),
    periodValid: check('survey_cycle_scoring_policies_period_check', sql`${t.periodEnd} > ${t.periodStart}`),
  }),
);

// This is a private processing table. Content and source IDs are erased when
// a question is finalized, declined, reset, superseded, or cut off.
export const surveyQuestionWorkingInsights = pgTable(
  'survey_question_working_insights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    surveyWindowId: uuid('survey_window_id').notNull().references(() => surveyWindows.id, { onDelete: 'cascade' }),
    surveyQuestionId: uuid('survey_question_id').notNull().references(() => surveyQuestions.id),
    questionVersion: text('question_version').notNull(),
    status: text('status').notNull().default('collecting'),
    readyForConfirmation: boolean('ready_for_confirmation').notNull().default(false),
    workingSummary: text('working_summary'),
    confirmedSemanticSummary: text('confirmed_semantic_summary'),
    sourceMessageIds: uuid('source_message_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
    confirmationBundleId: uuid('confirmation_bundle_id').references(() => surveyQuestionConfirmationBundles.id),
    clarificationPromptMessageId: uuid('clarification_prompt_message_id').references(() => messages.id),
    confirmationMessageId: uuid('confirmation_message_id').references(() => messages.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    questionScope: unique('survey_question_working_insights_scope_key').on(
      t.tenantId, t.userId, t.surveyWindowId, t.surveyQuestionId, t.questionVersion,
    ),
    windowGroupIdx: index('survey_question_working_insights_window_idx').on(t.tenantId, t.surveyWindowId),
    validStatus: check(
      'survey_question_working_insights_status_check',
      sql`${t.status} IN ('collecting', 'pending_confirmation', 'pending_clarification', 'confirmed', 'declined', 'no_data', 'reset')`,
    ),
    purgedContent: check(
      'survey_question_working_insights_purged_content_check',
      sql`${t.purgedAt} IS NULL OR (${t.workingSummary} IS NULL AND ${t.confirmedSemanticSummary} IS NULL AND cardinality(${t.sourceMessageIds}) = 0)`,
    ),
  }),
);

// Bundle content is temporary and never appears in an analytics projection.
export const surveyQuestionConfirmationBundles = pgTable(
  'survey_question_confirmation_bundles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    surveyWindowId: uuid('survey_window_id').notNull().references(() => surveyWindows.id, { onDelete: 'cascade' }),
    questionGroup: text('question_group').notNull(),
    version: text('version').notNull(),
    displayedText: text('displayed_text'),
    components: jsonb('components'),
    promptMessageId: uuid('prompt_message_id').references(() => messages.id),
    status: text('status').notNull().default('pending_delivery'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    purgedAt: timestamp('purged_at', { withTimezone: true }),
  },
  (t) => ({
    bundleVersion: unique('survey_question_confirmation_bundles_version_key').on(
      t.tenantId, t.userId, t.surveyWindowId, t.questionGroup, t.version,
    ),
    purgedContent: check(
      'survey_question_confirmation_bundles_purged_content_check',
      sql`${t.purgedAt} IS NULL OR (${t.displayedText} IS NULL AND ${t.components} IS NULL)`,
    ),
    validStatus: check(
      'survey_question_confirmation_bundles_status_check',
      sql`${t.status} IN ('pending_delivery', 'awaiting_confirmation', 'resolved', 'rejected', 'purged')`,
    ),
  }),
);

// Content-free proof that one inbound turn applied a V2 confirmation verdict.
// It survives analytical text purge so a retried conversation can resume.
export const surveyQuestionVerdictReceipts = pgTable(
  'survey_question_verdict_receipts',
  {
    inboundMessageId: uuid('inbound_message_id').primaryKey().references(() => messages.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    questionGroup: text('question_group').notNull(),
    verdictKind: text('verdict_kind').notNull(),
    bundleId: uuid('bundle_id').references(() => surveyQuestionConfirmationBundles.id, { onDelete: 'cascade' }),
    workingInsightId: uuid('working_insight_id').references(() => surveyQuestionWorkingInsights.id, { onDelete: 'cascade' }),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    targetKind: check('survey_question_verdict_receipts_target_kind_check', sql`(
      ${t.verdictKind} IN ('agree', 'partial', 'reject') AND ${t.bundleId} IS NOT NULL AND ${t.workingInsightId} IS NULL
    ) OR (
      ${t.verdictKind} IN ('clarified', 'declined') AND ${t.bundleId} IS NULL AND ${t.workingInsightId} IS NOT NULL
    )`),
  }),
);

// Only this table is eligible for downstream analytical projections. It has no
// source-message or private-summary column by construction.
export const surveyQuestionInsights = pgTable(
  'survey_question_insights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    surveyWindowId: uuid('survey_window_id').notNull().references(() => surveyWindows.id, { onDelete: 'cascade' }),
    surveyDefinitionId: uuid('survey_definition_id').notNull().references(() => surveyDefinitions.id),
    surveyQuestionId: uuid('survey_question_id').notNull().references(() => surveyQuestions.id),
    questionVersion: text('question_version').notNull(),
    questionGroup: text('question_group').notNull(),
    deidentifiedSummary: text('deidentified_summary').notNull(),
    score: numeric('score').notNull(),
    signalDirection: text('signal_direction').notNull(),
    signalSeverity: text('signal_severity').notNull(),
    rootCauseCategory: text('root_cause_category').notNull(),
    scoringPolicyVersion: text('scoring_policy_version').notNull(),
    questionRubricVersion: text('question_rubric_version').notNull(),
    modelId: text('model_id').notNull(),
    promptVersion: text('prompt_version').notNull(),
    confidence: numeric('confidence').notNull(),
    privacyPolicyVersion: text('privacy_policy_version').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull(),
    scoredAt: timestamp('scored_at', { withTimezone: true }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  },
  (t) => ({
    questionScope: unique('survey_question_insights_scope_key').on(
      t.tenantId, t.userId, t.surveyWindowId, t.surveyDefinitionId, t.surveyQuestionId, t.questionVersion,
    ),
    windowGroupIdx: index('survey_question_insights_window_group_idx').on(t.tenantId, t.surveyWindowId, t.questionGroup),
    scoreRange: check('survey_question_insights_score_range', sql`${t.score} >= 0 AND ${t.score} <= 100`),
    signalDirectionValid: check('survey_question_insights_direction_check', sql`${t.signalDirection} IN ('adverse', 'mixed', 'favorable')`),
    signalSeverityValid: check('survey_question_insights_severity_check', sql`${t.signalSeverity} IN ('low', 'moderate', 'high')`),
    rootCauseCategoryValid: check('survey_question_insights_category_check', sql`${t.rootCauseCategory} IN ('workload', 'clarity', 'autonomy', 'growth', 'purpose', 'belonging', 'support', 'other')`),
    confidenceRange: check('survey_question_insights_confidence_range', sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`),
    summaryNotBlank: check('survey_question_insights_summary_not_blank', sql`btrim(${t.deidentifiedSummary}) <> ''`),
    versionsNotBlank: check(
      'survey_question_insights_versions_not_blank',
      sql`btrim(${t.questionVersion}) <> '' AND btrim(${t.scoringPolicyVersion}) <> '' AND btrim(${t.questionRubricVersion}) <> '' AND btrim(${t.modelId}) <> '' AND btrim(${t.promptVersion}) <> '' AND btrim(${t.privacyPolicyVersion}) <> ''`,
    ),
  }),
);

export type DbSurveyScoringPolicy = typeof surveyScoringPolicies.$inferSelect;
export type DbSurveyCycleScoringPolicy = typeof surveyCycleScoringPolicies.$inferSelect;
export type DbSurveyQuestionWorkingInsight = typeof surveyQuestionWorkingInsights.$inferSelect;
export type DbSurveyQuestionInsight = typeof surveyQuestionInsights.$inferSelect;
