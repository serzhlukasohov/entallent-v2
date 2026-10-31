import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, integer, foreignKey, unique, check } from 'drizzle-orm/pg-core';
import { users } from './users';
import { surveyDefinitions, surveyQuestions, surveyWindows } from './survey';
import { surveyReportQuestionLineages } from './survey-report-scopes';

export const surveyEngagementCollectionContracts = pgTable('survey_engagement_collection_contracts', {
  surveyDefinitionId: uuid('survey_definition_id').primaryKey().references(() => surveyDefinitions.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull(),
  sourceDefinitionId: uuid('source_definition_id').notNull().references(() => surveyDefinitions.id, { onDelete: 'cascade' }),
  contractVersion: text('contract_version').notNull(),
}, (t) => ({ version: check('engagement_collection_version', sql`${t.contractVersion} = 'engagement-1-10-v1'`) }));

export const surveyEngagementContractQuestions = pgTable('survey_engagement_contract_questions', {
  surveyQuestionId: uuid('survey_question_id').primaryKey().references(() => surveyQuestions.id, { onDelete: 'cascade' }),
  surveyDefinitionId: uuid('survey_definition_id').notNull().references(() => surveyDefinitions.id, { onDelete: 'cascade' }),
  contractVersion: text('contract_version').notNull(),
  stableKey: text('stable_key').notNull(),
  questionVersion: text('question_version').notNull(),
  displayedTextHash: text('displayed_text_hash').notNull(),
}, (t) => ({ topic: unique('engagement_contract_topic').on(t.surveyDefinitionId, t.stableKey),
  contract: check('engagement_contract_version', sql`${t.contractVersion} = 'engagement-1-10-v1' AND ${t.questionVersion} = ${t.contractVersion} AND ${t.stableKey} IN ('engagement_nps','engagement_motivation','engagement_current')`),
}));

/** No private-message FK: receipt and positive delivery proof survive private text cleanup. */
export const surveyEngagementCaptureEvents = pgTable('survey_engagement_capture_events', {
  inboundReceiptId: uuid('inbound_receipt_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  status: text('status').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true, mode: 'string' }),
  answerReceivedAt: timestamp('answer_received_at', { withTimezone: true, mode: 'string' }).notNull(),
  surveyWindowId: uuid('survey_window_id').references(() => surveyWindows.id, { onDelete: 'cascade' }),
  lineageId: uuid('lineage_id').references(() => surveyReportQuestionLineages.id, { onDelete: 'cascade' }),
  contractVersion: text('contract_version'),
}, (t) => ({
  subject: foreignKey({ name: 'engagement_event_subject_fk', columns: [t.userId,t.tenantId], foreignColumns: [users.id,users.tenantId] }).onDelete('cascade'),
  identity: unique('engagement_capture_subject_receipt').on(t.tenantId,t.userId,t.inboundReceiptId),
  status: check('engagement_capture_status', sql`${t.status} IN ('accepted','invalid','ineligible','expired','source_deleted','withdrawn')`),
}));

export const surveyEngagementAnswerRevisions = pgTable('survey_engagement_answer_revisions', {
  inboundReceiptId: uuid('inbound_receipt_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(), userId: uuid('user_id').notNull(),
  surveyWindowId: uuid('survey_window_id').notNull().references(() => surveyWindows.id, { onDelete: 'cascade' }),
  cycleScoringPolicyId: uuid('cycle_scoring_policy_id').notNull(),
  lineageId: uuid('lineage_id').notNull(),
  surveyDefinitionId: uuid('survey_definition_id').notNull(),
  surveyQuestionId: uuid('survey_question_id').notNull().references(() => surveyEngagementContractQuestions.surveyQuestionId),
  questionVersion: text('question_version').notNull(), stableKey: text('stable_key').notNull(),
  contractVersion: text('contract_version').notNull(),
  value: integer('value').notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'string' }),
  answerReceivedAt: timestamp('answer_received_at', { withTimezone: true, mode: 'string' }).notNull(),
  promptMessageId: uuid('prompt_message_id').notNull(),
  promptSentAt: timestamp('prompt_sent_at', { withTimezone: true, mode: 'string' }).notNull(),
  promptAcknowledgedAt: timestamp('prompt_acknowledged_at', { withTimezone: true, mode: 'string' }),
  displayedFormHash: text('displayed_form_hash').notNull(),
  permissionRevision: integer('permission_revision').notNull(),
  proofKind: text('proof_kind').notNull().default('direct_explicit_answer'),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
}, (t) => ({
  event: foreignKey({ name: 'engagement_answer_event_fk', columns: [t.tenantId,t.userId,t.inboundReceiptId], foreignColumns: [surveyEngagementCaptureEvents.tenantId,surveyEngagementCaptureEvents.userId,surveyEngagementCaptureEvents.inboundReceiptId] }).onDelete('cascade'),
  lineage: foreignKey({ name: 'engagement_answer_lineage_fk', columns: [t.tenantId,t.userId,t.lineageId], foreignColumns: [surveyReportQuestionLineages.tenantId,surveyReportQuestionLineages.userId,surveyReportQuestionLineages.id] }).onDelete('cascade'),
  value: check('engagement_answer_value', sql`${t.value} BETWEEN 1 AND 10 AND ${t.proofKind} = 'direct_explicit_answer' AND ${t.contractVersion} = 'engagement-1-10-v1' AND ${t.questionVersion} = ${t.contractVersion} AND ${t.permissionRevision} >= 0 AND ${t.promptSentAt} < ${t.answerReceivedAt} AND ${t.expiresAt} > ${t.answerReceivedAt}`),
}));
