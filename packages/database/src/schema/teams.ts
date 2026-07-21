import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  managerSlackUserId: text('manager_slack_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teamMemberships = pgTable('team_memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp('left_at', { withTimezone: true }),
});

export type DbTeam = typeof teams.$inferSelect;
export type DbTeamMembership = typeof teamMemberships.$inferSelect;
