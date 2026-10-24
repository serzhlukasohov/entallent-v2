import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { people } from './people';

/** Company working calendar entered by enTalent staff. Absence means rollout is blocked (Q18). */
export const tenantWorkCalendars = pgTable('tenant_work_calendars', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  timezone: text('timezone').notNull(),
  workingDays: smallint('working_days').array().notNull(),
  workStart: text('work_start').notNull(),
  workEnd: text('work_end').notNull(),
  onboardingLanguage: text('onboarding_language').notNull().default('en'),
  updatedBy: text('updated_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hhmm: check('tenant_work_calendars_hours_valid', sql`${t.workStart} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ${t.workEnd} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ${t.workStart} < ${t.workEnd}`),
  days: check('tenant_work_calendars_days_valid', sql`cardinality(${t.workingDays}) > 0 AND ${t.workingDays} <@ ARRAY[1,2,3,4,5,6,7]::smallint[]`),
  language: check('tenant_work_calendars_language_valid', sql`${t.onboardingLanguage} = 'en'`),
}));

/** Per-person onboarding and personal-participation state. Never reporting consent. */
export const onboardingStates = pgTable('onboarding_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull(),
  track: text('track').notNull(),
  introStatus: text('intro_status').notNull().default('pending'),
  participation: text('participation').notNull(),
  managementAckAt: timestamp('management_ack_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  reminderStatus: text('reminder_status').notNull().default('none'),
  reminderOriginAt: timestamp('reminder_origin_at', { withTimezone: true }),
  reminderDueAt: timestamp('reminder_due_at', { withTimezone: true }),
  reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
  introChannelId: text('intro_channel_id'),
  introActionsMessageTs: text('intro_actions_message_ts'),
  buttonsActive: boolean('buttons_active').notNull().default(false),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  personTenant: foreignKey({ columns: [t.personId, t.tenantId], foreignColumns: [people.id, people.tenantId] }).onDelete('cascade'),
  onePerPerson: uniqueIndex('onboarding_states_tenant_person_idx').on(t.tenantId, t.personId),
  dueReminders: index('onboarding_states_due_reminder_idx').on(t.reminderStatus, t.reminderDueAt),
  track: check('onboarding_states_track_valid', sql`${t.track} IN ('employee', 'team_lead', 'management')`),
  intro: check('onboarding_states_intro_valid', sql`${t.introStatus} IN ('pending', 'delivered', 'completed')`),
  participation: check('onboarding_states_participation_valid', sql`${t.participation} IN ('undecided', 'deferred', 'active', 'declined', 'not_applicable')`),
  managementNoParticipation: check('onboarding_states_management_not_applicable', sql`(${t.track} = 'management') = (${t.participation} = 'not_applicable')`),
  reminder: check('onboarding_states_reminder_valid', sql`${t.reminderStatus} IN ('none', 'scheduled', 'sent', 'cancelled')`),
  scheduledHasDue: check('onboarding_states_scheduled_has_due', sql`${t.reminderStatus} <> 'scheduled' OR ${t.reminderDueAt} IS NOT NULL`),
  managementNoReminder: check('onboarding_states_management_no_reminder', sql`${t.track} <> 'management' OR ${t.reminderStatus} IN ('none', 'cancelled')`),
}));
