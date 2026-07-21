import { pgTable, uuid, text, numeric, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { surveyWindows } from './survey';

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
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    reportSentAt: timestamp('report_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueWindowUserGroup: unique('survey_group_states_window_user_group_key').on(t.surveyWindowId, t.userId, t.questionGroup),
    userGroupIdx: index('survey_group_states_user_idx').on(t.userId, t.questionGroup),
  }),
);

export type DbSurveyGroupState = typeof surveyGroupStates.$inferSelect;
