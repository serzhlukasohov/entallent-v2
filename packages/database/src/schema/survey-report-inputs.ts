import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { tenants } from './tenants';
import { surveyReportNativeSnapshots } from './survey-report-delivery';
import {
  surveyReportCycleOpenings,
  surveyReportScopes,
  surveyReportQuestionLineages,
} from './survey-report-scopes';
const clock = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
/** Content-free; deliberately no message/conversation FK, so private cleanup cannot erase progress. */
export const surveyReportInboundWork = pgTable(
  'survey_report_inbound_work',
  {
    inboundReceiptId: uuid('inbound_receipt_id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    recordedAt: clock('recorded_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    receivedAt: clock('received_at'),
    trust: text('trust').notNull(),
    capture: text('capture').notNull().default('pending'),
    nativeVerdict: text('native_verdict').notNull().default('pending'),
    evidence: text('evidence').notNull().default('pending'),
    finalization: text('finalization').notNull().default('pending'),
    attemptToken: uuid('attempt_token'),
    leaseUntil: clock('lease_until'),
    failureCode: text('failure_code'),
    recoveryCursorAt: clock('recovery_cursor_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => ({
    subject: foreignKey({
      columns: [t.userId, t.tenantId],
      foreignColumns: [users.id, users.tenantId],
    }).onDelete('cascade'),
    identity: unique('report_work_subject_identity').on(t.tenantId, t.userId, t.inboundReceiptId),
    trust: check(
      'report_work_trust',
      sql`${t.trust} in ('db-receipt-v1','unverified_explicit_receipt','legacy_unverified','legacy_missing_clock')`,
    ),
    states: check(
      'report_work_stages',
      sql`${t.capture} in ('pending','applied','not_applicable','invalid','excluded','expired','deleted','blocked') and ${t.nativeVerdict} in ('pending','claimed','applied','not_applicable','excluded','expired','deleted','blocked') and ${t.evidence} in ('pending','applied','not_applicable','excluded','expired','deleted','delegated','blocked') and ${t.finalization} in ('pending','applied','not_applicable','excluded','expired','deleted','blocked')`,
    ),
  }),
);
export const surveyReportWorkDependencies = pgTable(
  'survey_report_work_dependencies',
  {
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    inboundReceiptId: uuid('inbound_receipt_id').notNull(),
    dependsOnReceiptId: uuid('depends_on_receipt_id').notNull(),
    stage: text('stage').notNull().default('evidence'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.inboundReceiptId, t.dependsOnReceiptId, t.stage] }),
    source: foreignKey({
      columns: [t.tenantId, t.userId, t.inboundReceiptId],
      foreignColumns: [
        surveyReportInboundWork.tenantId,
        surveyReportInboundWork.userId,
        surveyReportInboundWork.inboundReceiptId,
      ],
    }).onDelete('cascade'),
    target: foreignKey({
      columns: [t.tenantId, t.userId, t.dependsOnReceiptId],
      foreignColumns: [
        surveyReportInboundWork.tenantId,
        surveyReportInboundWork.userId,
        surveyReportInboundWork.inboundReceiptId,
      ],
    }).onDelete('cascade'),
    stage: check(
      'report_dependency_stage',
      sql`${t.stage}='evidence' and ${t.inboundReceiptId}<>${t.dependsOnReceiptId}`,
    ),
  }),
);
export const surveyReportShownComponents = pgTable(
  'survey_report_shown_components',
  {
    bodyDisposition: text('body_disposition').notNull().default('retained'),
    recordedAt: clock('recorded_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    bundleId: uuid('bundle_id').notNull(),
    promptMessageId: uuid('prompt_message_id').notNull(),
    surveyWindowId: uuid('survey_window_id').notNull(),
    surveyQuestionId: uuid('survey_question_id').notNull(),
    questionVersion: text('question_version').notNull(),
    ordinal: integer('ordinal').notNull(),
    workingInsightId: uuid('working_insight_id').notNull(),
    workingRevisionHash: text('working_revision_hash').notNull(),
    componentHash: text('component_hash').notNull(),
    formHash: text('form_hash').notNull(),
    fullBodyHash: text('full_body_hash'),
    formStartCharacter: integer('form_start_character'),
    formCharacterLength: integer('form_character_length'),
    sentAt: clock('sent_at'),
    acknowledgedAt: clock('acknowledged_at'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.promptMessageId, t.ordinal] }),
    identity: unique('report_shown_subject_identity').on(
      t.tenantId,
      t.userId,
      t.promptMessageId,
      t.ordinal,
    ),
    subject: foreignKey({
      columns: [t.userId, t.tenantId],
      foreignColumns: [users.id, users.tenantId],
    }).onDelete('cascade'),
  }),
);
export const surveyReportComponentVerdicts = pgTable(
  'survey_report_component_verdicts',
  {
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    inboundReceiptId: uuid('inbound_receipt_id').notNull(),
    promptMessageId: uuid('prompt_message_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    outcome: text('outcome').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.inboundReceiptId, t.promptMessageId, t.ordinal] }),
    work: foreignKey({
      columns: [t.tenantId, t.userId, t.inboundReceiptId],
      foreignColumns: [
        surveyReportInboundWork.tenantId,
        surveyReportInboundWork.userId,
        surveyReportInboundWork.inboundReceiptId,
      ],
    }).onDelete('cascade'),
    form: foreignKey({
      columns: [t.tenantId, t.userId, t.promptMessageId, t.ordinal],
      foreignColumns: [
        surveyReportShownComponents.tenantId,
        surveyReportShownComponents.userId,
        surveyReportShownComponents.promptMessageId,
        surveyReportShownComponents.ordinal,
      ],
    }).onDelete('cascade'),
  }),
);
export const surveyReportTopicWatermarks = pgTable(
  'survey_report_topic_watermarks',
  {
    insightId: uuid('insight_id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    lineageId: uuid('lineage_id').notNull(),
    confirmationMessageId: uuid('confirmation_message_id').notNull(),
    confirmationReceivedAt: clock('confirmation_received_at').notNull(),
    acceptedSourceReceipts: jsonb('accepted_source_receipts').notNull(),
    state: text('state').notNull(),
    expiresAt: clock('expires_at').notNull(),
  },
  (t) => ({
    lineage: foreignKey({
      columns: [t.tenantId, t.userId, t.lineageId],
      foreignColumns: [
        surveyReportQuestionLineages.tenantId,
        surveyReportQuestionLineages.userId,
        surveyReportQuestionLineages.id,
      ],
    }).onDelete('cascade'),
    state: check(
      'report_watermark_state',
      sql`${t.state} in ('retained','withdrawn','expired','deleted')`,
    ),
  }),
);
export const surveyReportInputGenerations = pgTable(
  'survey_report_input_generations',
  {
    tenantId: uuid('tenant_id').notNull(),
    cycleId: uuid('cycle_id').notNull(),
    generation: bigint('generation', { mode: 'number' }).notNull().default(0),
    certifiedGeneration: bigint('certified_generation', { mode: 'number' }),
    cutoff: clock('cutoff'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.cycleId] }),
    cycle: foreignKey({
      columns: [t.tenantId, t.cycleId],
      foreignColumns: [
        surveyReportCycleOpenings.tenantId,
        surveyReportCycleOpenings.cycleScoringPolicyId,
      ],
    }).onDelete('cascade'),
  }),
);
export const surveyReportInputCandidates = pgTable(
  'survey_report_input_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    cycleId: uuid('cycle_id').notNull(),
    scopeId: uuid('scope_id').notNull(),
    purpose: text('purpose').notNull(),
    frontier: clock('frontier').notNull(),
    generation: bigint('generation', { mode: 'number' }).notNull(),
    calculationContract: text('calculation_contract').notNull(),
    context: jsonb('context').notNull(),
    metrics: jsonb('metrics').notNull(),
    invalidatedAt: clock('invalidated_at'),
    expiresAt: clock('expires_at').notNull(),
  },
  (t) => ({
    scope: foreignKey({
      columns: [t.tenantId, t.cycleId, t.scopeId],
      foreignColumns: [
        surveyReportScopes.tenantId,
        surveyReportScopes.cycleScoringPolicyId,
        surveyReportScopes.id,
      ],
    }).onDelete('cascade'),
    identity: unique('report_input_candidate_identity').on(
      t.tenantId,
      t.cycleId,
      t.scopeId,
      t.purpose,
      t.frontier,
      t.generation,
      t.calculationContract,
    ),
    shape: check('report_candidate_purpose', sql`${t.purpose} in ('intermediate','final')`),
  }),
);
export const surveyReportCandidateSources = pgTable(
  'survey_report_candidate_sources',
  {
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => surveyReportInputCandidates.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    lineageId: uuid('lineage_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.candidateId, t.lineageId, t.revisionId] }),
    subject: foreignKey({
      columns: [t.userId, t.tenantId],
      foreignColumns: [users.id, users.tenantId],
    }).onDelete('cascade'),
  }),
);
/** Genuine native eligible-final assembly, independently of transport delivery. */
export const surveyReportFinalCompletions = pgTable('survey_report_final_completions', {
  canonicalSnapshotId: uuid('canonical_snapshot_id').notNull().references(() => surveyReportNativeSnapshots.id),
  candidateId: uuid('candidate_id')
    .primaryKey()
    .references(() => surveyReportInputCandidates.id, { onDelete: 'cascade' }),
  completedAt: clock('completed_at')
    .notNull()
    .default(sql`clock_timestamp()`),
});

/** Earliest opening with fully instrumented retained receipt coverage. No historical completeness inference. */
export const surveyReportInputCoverage = pgTable('survey_report_input_coverage', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  supportedFrom: clock('supported_from')
    .notNull()
    .default(sql`clock_timestamp()`),
});
