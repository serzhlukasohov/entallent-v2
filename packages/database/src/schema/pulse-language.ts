import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, jsonb, timestamp, primaryKey, foreignKey, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { surveyQuestionInsights } from './survey-insight-v2';
export const pulseLanguageResources = pgTable('pulse_language_resources', {
  locale: text('locale').notNull(), kind: text('kind').notNull(), version: text('version').notNull(),
  sourceHash: text('source_hash').notNull(), textHash: text('text_hash').notNull(),
  texts: jsonb('texts').notNull(), provenance: jsonb('provenance').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.locale, t.kind, t.version, t.sourceHash] }) }));
export const pulseAnalyticalRenditions = pgTable('pulse_analytical_renditions', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  analyticalId: uuid('analytical_id').notNull().references(() => surveyQuestionInsights.id, { onDelete: 'cascade' }),
  sourceHash: text('source_hash').notNull(), locale: text('locale').notNull(), text: text('text').notNull(),
  support: text('support').notNull(), policyVersion: text('policy_version').notNull(), modelId: text('model_id').notNull(), promptVersion: text('prompt_version').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ scope: foreignKey({ columns: [t.userId, t.tenantId], foreignColumns: [users.id, users.tenantId] }).onDelete('cascade'),
  identity: uniqueIndex('pulse_analytical_renditions_identity').on(t.tenantId, t.analyticalId, t.sourceHash, t.locale, t.policyVersion) }));

export const pulseTenantDefinitionResources = pgTable('pulse_tenant_definition_resources', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, {onDelete:'cascade'}),
  locale: text('locale').notNull(),version:text('version').notNull(),sourceHash:text('source_hash').notNull(),textHash:text('text_hash').notNull(),texts:jsonb('texts').notNull(),provenance:jsonb('provenance').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>({pk:primaryKey({columns:[t.tenantId,t.locale,t.version,t.sourceHash]})}));

/** Content-free durable authority survives native proof cleanup while the analytical source exists. */
export const pulseAnalyticalSourceAuthorities = pgTable('pulse_analytical_source_authorities', {
  analyticalId: uuid('analytical_id').primaryKey().references(() => surveyQuestionInsights.id, {onDelete:'cascade'}),
  sourceKind: text('source_kind').notNull(),
  nativeExpiresAt: timestamp('native_expires_at',{withTimezone:true}),
  dependencyLostAt: timestamp('dependency_lost_at',{withTimezone:true}),
  recordedAt: timestamp('recorded_at',{withTimezone:true}).notNull().defaultNow(),
},t=>({kind:check('pulse_analytical_source_authority_kind',sql`${t.sourceKind} in ('native','approved_legacy','unknown')`)}));
