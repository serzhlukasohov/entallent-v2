import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, numeric, jsonb, timestamp, unique, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { surveyWindows } from './survey';
import { messages } from './messages';

export const surveyGroupStates = pgTable(
  'survey_group_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    surveyWindowId: uuid('survey_window_id').notNull().references(() => surveyWindows.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    questionGroup: text('question_group').notNull(),
    status: text('status').notNull().default('in_progress'),
    aiSummary: text('ai_summary'),
    employeeScore: numeric('employee_score', { precision: 5, scale: 2 }),
    personalRecs: jsonb('personal_recs'),
    deidentificationDecision: jsonb('deidentification_decision'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    reportingDisclosureVersion: text('reporting_disclosure_version'),
    reportingDisclosureShownAt: timestamp('reporting_disclosure_shown_at', { withTimezone: true }),
    confirmationMessageId: uuid('confirmation_message_id').references(() => messages.id),
    confirmationPromptMessageId: uuid('confirmation_prompt_message_id')
      .unique()
      .references(() => messages.id),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawalMessageId: uuid('withdrawal_message_id').references(() => messages.id),
    reportSentAt: timestamp('report_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueWindowUserGroup: unique('survey_group_states_window_user_group_key').on(t.surveyWindowId, t.userId, t.questionGroup),
    userGroupIdx: index('survey_group_states_user_idx').on(t.userId, t.questionGroup),
    oneActiveConfirmationPerUser: uniqueIndex('survey_group_states_one_active_confirmation_per_user_idx')
      .on(t.tenantId, t.userId)
      .where(sql`${t.confirmationPromptMessageId} is not null AND ${t.status} IN ('pending_confirmation', 'awaiting_confirmation')`),
    confirmedDisclosureProof: check(
      'survey_group_states_confirmed_disclosure_proof_check',
      sql`${t.status} <> 'confirmed' OR (${t.confirmedAt} IS NOT NULL AND ${t.reportingDisclosureVersion} IS NOT NULL AND btrim(${t.reportingDisclosureVersion}) <> '' AND ${t.reportingDisclosureShownAt} IS NOT NULL AND ${t.confirmationMessageId} IS NOT NULL AND ${t.reportingDisclosureShownAt} < ${t.confirmedAt})`,
    ),
    confirmedDisplayedSummaryProof: check(
      'survey_group_states_confirmed_displayed_summary_proof_check',
      sql`${t.status} <> 'confirmed' OR (${t.confirmationPromptMessageId} IS NOT NULL AND ${t.aiSummary} IS NOT NULL AND btrim(${t.aiSummary}) <> '')`,
    ),
    confirmedDeidentificationProof: check(
      'survey_group_states_confirmed_deidentification_proof_check',
      sql`${t.status} <> 'confirmed' OR (${t.deidentificationDecision}->>'status' = 'accepted' AND ${t.deidentificationDecision}->>'policyVersion' = 'deidentification-v1' AND jsonb_typeof(${t.deidentificationDecision}->'reasons') = 'array' AND jsonb_array_length(${t.deidentificationDecision}->'reasons') = 0)`,
    ),
  }),
);

export type DbSurveyGroupState = typeof surveyGroupStates.$inferSelect;
