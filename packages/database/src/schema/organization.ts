import { sql } from 'drizzle-orm';
import { check, foreignKey, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { people } from './people';
import { tenants } from './tenants';

export const orgUnits = pgTable('org_units', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  customerUnitKey: text('customer_unit_key').notNull(),
  name: text('name').notNull(),
  managerPersonId: uuid('manager_person_id'),
  lifecycleStatus: text('lifecycle_status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  managerTenant: foreignKey({ columns: [t.managerPersonId, t.tenantId], foreignColumns: [people.id, people.tenantId] }),
  idTenantUnique: uniqueIndex('org_units_id_tenant_id_unique_idx').on(t.id, t.tenantId),
  customerKeyUnique: uniqueIndex('org_units_tenant_customer_key_idx').on(t.tenantId, t.customerUnitKey),
  oneActiveUnitPerManager: uniqueIndex('org_units_active_manager_idx').on(t.managerPersonId).where(sql`${t.lifecycleStatus} = 'active'`),
  keyNotBlank: check('org_units_customer_key_not_blank', sql`length(btrim(${t.customerUnitKey})) > 0`),
  nameNotBlank: check('org_units_name_not_blank', sql`length(btrim(${t.name})) > 0`),
  lifecycleValid: check('org_units_lifecycle_status_valid', sql`${t.lifecycleStatus} IN ('draft', 'active', 'inactive')`),
  activeHasManager: check('org_units_active_has_manager', sql`${t.lifecycleStatus} <> 'active' OR ${t.managerPersonId} IS NOT NULL`),
}));

export const orgTeams = pgTable('org_teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  unitId: uuid('unit_id').notNull(),
  customerTeamKey: text('customer_team_key').notNull(),
  name: text('name').notNull(),
  teamLeadPersonId: uuid('team_lead_person_id'),
  lifecycleStatus: text('lifecycle_status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  unitTenant: foreignKey({ columns: [t.unitId, t.tenantId], foreignColumns: [orgUnits.id, orgUnits.tenantId] }),
  leadTenant: foreignKey({ columns: [t.teamLeadPersonId, t.tenantId], foreignColumns: [people.id, people.tenantId] }),
  idUnitTenantUnique: uniqueIndex('org_teams_id_unit_tenant_unique_idx').on(t.id, t.unitId, t.tenantId),
  customerKeyUnique: uniqueIndex('org_teams_tenant_customer_key_idx').on(t.tenantId, t.customerTeamKey),
  oneActiveTeamPerLead: uniqueIndex('org_teams_active_lead_idx').on(t.teamLeadPersonId).where(sql`${t.lifecycleStatus} = 'active'`),
  keyNotBlank: check('org_teams_customer_key_not_blank', sql`length(btrim(${t.customerTeamKey})) > 0`),
  nameNotBlank: check('org_teams_name_not_blank', sql`length(btrim(${t.name})) > 0`),
  lifecycleValid: check('org_teams_lifecycle_status_valid', sql`${t.lifecycleStatus} IN ('draft', 'active', 'inactive')`),
  activeHasLead: check('org_teams_active_has_lead', sql`${t.lifecycleStatus} <> 'active' OR ${t.teamLeadPersonId} IS NOT NULL`),
}));

/** One active placement gives an Employee either a Team or a direct Unit home. */
export const orgEmployeePlacements = pgTable('org_employee_placements', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  employeePersonId: uuid('employee_person_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  teamId: uuid('team_id'),
  lifecycleStatus: text('lifecycle_status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  employeeTenant: foreignKey({ columns: [t.employeePersonId, t.tenantId], foreignColumns: [people.id, people.tenantId] }),
  unitTenant: foreignKey({ columns: [t.unitId, t.tenantId], foreignColumns: [orgUnits.id, orgUnits.tenantId] }),
  teamUnitTenant: foreignKey({ columns: [t.teamId, t.unitId, t.tenantId], foreignColumns: [orgTeams.id, orgTeams.unitId, orgTeams.tenantId] }),
  oneActivePlacement: uniqueIndex('org_employee_placements_active_person_idx').on(t.employeePersonId).where(sql`${t.lifecycleStatus} = 'active'`),
  lifecycleValid: check('org_employee_placements_lifecycle_status_valid', sql`${t.lifecycleStatus} IN ('draft', 'active', 'inactive')`),
}));

export const orgAdvisorAssignments = pgTable('org_advisor_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  advisorPersonId: uuid('advisor_person_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  lifecycleStatus: text('lifecycle_status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  advisorTenant: foreignKey({ columns: [t.advisorPersonId, t.tenantId], foreignColumns: [people.id, people.tenantId] }),
  unitTenant: foreignKey({ columns: [t.unitId, t.tenantId], foreignColumns: [orgUnits.id, orgUnits.tenantId] }),
  oneActiveAssignment: uniqueIndex('org_advisor_assignments_active_pair_idx').on(t.advisorPersonId, t.unitId).where(sql`${t.lifecycleStatus} = 'active'`),
  lifecycleValid: check('org_advisor_assignments_lifecycle_status_valid', sql`${t.lifecycleStatus} IN ('draft', 'active', 'inactive')`),
}));

export const orgHrbpScopes = pgTable('org_hrbp_scopes', {
  personId: uuid('person_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  scopeMode: text('scope_mode').notNull(),
  lifecycleStatus: text('lifecycle_status').notNull().default('draft'),
}, (t) => ({
  personTenant: foreignKey({ columns: [t.personId, t.tenantId], foreignColumns: [people.id, people.tenantId] }),
  scopeModeValid: check('org_hrbp_scopes_mode_valid', sql`${t.scopeMode} IN ('all_units', 'selected_units')`),
  lifecycleValid: check('org_hrbp_scopes_lifecycle_status_valid', sql`${t.lifecycleStatus} IN ('draft', 'active', 'inactive')`),
}));

export const orgPersonCapabilities = pgTable('org_person_capabilities', {
  personId: uuid('person_id').notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  capability: text('capability').notNull(),
  lifecycleStatus: text('lifecycle_status').notNull().default('draft'),
}, (t) => ({
  pk: primaryKey({ columns: [t.personId, t.capability] }),
  personTenant: foreignKey({ columns: [t.personId, t.tenantId], foreignColumns: [people.id, people.tenantId] }),
  capabilityValid: check('org_person_capabilities_name_valid', sql`${t.capability} = 'company_admin'`),
  lifecycleValid: check('org_person_capabilities_lifecycle_status_valid', sql`${t.lifecycleStatus} IN ('draft', 'active', 'inactive')`),
}));

/** Durable first-contact intent, separate from Person lifecycle and Slack delivery. */
export const orgOnboardingDeliveries = pgTable('org_onboarding_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  externalWorkspaceId: text('external_workspace_id').notNull(),
  status: text('status').notNull().default('pending'),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  externalMessageId: text('external_message_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  personTenant: foreignKey({ columns: [t.personId, t.tenantId], foreignColumns: [people.id, people.tenantId] }),
  unitTenant: foreignKey({ columns: [t.unitId, t.tenantId], foreignColumns: [orgUnits.id, orgUnits.tenantId] }),
  oneFirstContact: uniqueIndex('org_onboarding_deliveries_tenant_person_idx').on(t.tenantId, t.personId),
  statusValid: check('org_onboarding_deliveries_status_valid', sql`${t.status} IN ('pending', 'sending', 'delivered', 'failed', 'cancelled')`),
  workspaceNotBlank: check('org_onboarding_deliveries_workspace_not_blank', sql`length(btrim(${t.externalWorkspaceId})) > 0`),
  attemptNonnegative: check('org_onboarding_deliveries_attempt_nonnegative', sql`${t.attemptCount} >= 0`),
}));

export type DbOrgUnit = typeof orgUnits.$inferSelect;
export type DbOrgTeam = typeof orgTeams.$inferSelect;
export type DbOrgEmployeePlacement = typeof orgEmployeePlacements.$inferSelect;
export type DbOrgAdvisorAssignment = typeof orgAdvisorAssignments.$inferSelect;
export type DbOrgHrbpScope = typeof orgHrbpScopes.$inferSelect;
export type DbOrgPersonCapability = typeof orgPersonCapabilities.$inferSelect;
export type DbOrgOnboardingDelivery = typeof orgOnboardingDeliveries.$inferSelect;
