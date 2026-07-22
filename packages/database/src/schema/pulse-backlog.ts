import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { surveyWindows, surveyQuestions } from './survey';

export const pulseBacklog = pgTable(
  'pulse_backlog',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    surveyWindowId: uuid('survey_window_id')
      .notNull()
      .references(() => surveyWindows.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    surveyQuestionId: uuid('survey_question_id')
      .notNull()
      .references(() => surveyQuestions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    status: text('status').notNull().default('pending'), // pending | active | done
    ignoreCount: integer('ignore_count').notNull().default(0),
    proactiveSentAt: timestamp('proactive_sent_at', { withTimezone: true }),
    evidenceCapturedCount: integer('evidence_captured_count').notNull().default(0),
    resultedInCoverage: boolean('resulted_in_coverage'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueWindowUserQuestion: unique('pulse_backlog_window_user_question_key').on(
      t.surveyWindowId,
      t.userId,
      t.surveyQuestionId,
    ),
    userWindowIdx: index('pulse_backlog_user_window_idx').on(t.userId, t.surveyWindowId),
    statusIdx: index('pulse_backlog_status_idx').on(
      t.surveyWindowId,
      t.userId,
      t.status,
      t.position,
    ),
  }),
);

export type DbPulseBacklog = typeof pulseBacklog.$inferSelect;
export type DbNewPulseBacklog = typeof pulseBacklog.$inferInsert;
