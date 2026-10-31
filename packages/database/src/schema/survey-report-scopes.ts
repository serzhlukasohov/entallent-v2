import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { surveyWindows } from './survey';
import { surveyCycleScoringPolicies, surveyQuestionInsights } from './survey-insight-v2';

// Org IDs/labels are historical facts, deliberately not cascading FKs to mutable live hierarchy.
export const surveyReportCycleOpenings = pgTable('survey_report_cycle_openings', {
  cycleScoringPolicyId: uuid('cycle_scoring_policy_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  scopeContractVersion: text('scope_contract_version').notNull().default('org-native-v1'),
}, (t) => ({
  cycle: foreignKey({ columns: [t.tenantId, t.cycleScoringPolicyId], foreignColumns: [surveyCycleScoringPolicies.tenantId, surveyCycleScoringPolicies.id] }).onDelete('cascade'),
  tenantCycle: unique('report_opening_tenant_cycle').on(t.tenantId, t.cycleScoringPolicyId),
}));

export const surveyReportScopes = pgTable('survey_report_scopes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  cycleScoringPolicyId: uuid('cycle_scoring_policy_id').notNull(),
  kind: text('kind').notNull(),
  orgUnitId: uuid('org_unit_id').notNull(),
  orgTeamId: uuid('org_team_id'),
  parentScopeId: uuid('parent_scope_id'),
  label: text('label').notNull(),
  openingOwnerPersonId: uuid('opening_owner_person_id'),
  historyKey: text('history_key').notNull(),
  boundaryFingerprint: text('boundary_fingerprint').notNull(),
}, (t) => ({
  opening: foreignKey({ columns: [t.tenantId, t.cycleScoringPolicyId], foreignColumns: [surveyReportCycleOpenings.tenantId, surveyReportCycleOpenings.cycleScoringPolicyId] }).onDelete('cascade'),
  tenantCycleId: unique('report_scope_tenant_cycle_id').on(t.tenantId, t.cycleScoringPolicyId, t.id),
  natural: unique('report_scope_natural').on(t.tenantId, t.cycleScoringPolicyId, t.historyKey),
  kindCheck: check('report_scope_kind_check', sql`(${t.kind} = 'team' AND ${t.orgTeamId} IS NOT NULL AND ${t.parentScopeId} IS NOT NULL) OR (${t.kind} = 'manager_overall' AND ${t.orgTeamId} IS NULL AND ${t.parentScopeId} IS NULL)`),
}));

export const surveyReportParticipants = pgTable('survey_report_participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  cycleScoringPolicyId: uuid('cycle_scoring_policy_id').notNull(),
  personId: uuid('person_id').notNull(),
  userId: uuid('user_id').notNull(),
  openingRole: text('opening_role').notNull(),
  originUnitId: uuid('origin_unit_id').notNull(),
  originTeamId: uuid('origin_team_id').notNull(),
  collectionStoppedAt: timestamp('collection_stopped_at', { withTimezone: true }),
  collectionStopCause: text('collection_stop_cause'),
  collectionStopMutationId: uuid('collection_stop_mutation_id'),
}, (t) => ({
  opening: foreignKey({ columns: [t.tenantId, t.cycleScoringPolicyId], foreignColumns: [surveyReportCycleOpenings.tenantId, surveyReportCycleOpenings.cycleScoringPolicyId] }).onDelete('cascade'),
  subject: foreignKey({ columns: [t.userId, t.tenantId], foreignColumns: [users.id, users.tenantId] }).onDelete('cascade'),
  tenantCycleId: unique('report_participant_tenant_cycle_id').on(t.tenantId, t.cycleScoringPolicyId, t.id),
  personCycle: unique('report_participant_person_cycle').on(t.tenantId, t.cycleScoringPolicyId, t.personId),
  userCycle: unique('report_participant_user_cycle').on(t.tenantId, t.cycleScoringPolicyId, t.userId),
  role: check('report_participant_role', sql`${t.openingRole} IN ('employee', 'team_lead') AND ${t.personId} = ${t.userId}`),
  stop: check('report_participant_stop', sql`(${t.collectionStoppedAt} IS NULL AND ${t.collectionStopCause} IS NULL AND ${t.collectionStopMutationId} IS NULL) OR (${t.collectionStoppedAt} IS NOT NULL AND ${t.collectionStopCause} IN ('moved', 'promoted', 'deactivated', 'team_changed', 'unit_changed') AND ${t.collectionStopMutationId} IS NOT NULL)`),
}));

export const surveyReportScopeMemberships = pgTable('survey_report_scope_memberships', {
  tenantId: uuid('tenant_id').notNull(),
  cycleScoringPolicyId: uuid('cycle_scoring_policy_id').notNull(),
  scopeId: uuid('scope_id').notNull(),
  participantId: uuid('participant_id').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.scopeId, t.participantId] }),
  scope: foreignKey({ name: 'report_membership_scope_fk', columns: [t.tenantId, t.cycleScoringPolicyId, t.scopeId], foreignColumns: [surveyReportScopes.tenantId, surveyReportScopes.cycleScoringPolicyId, surveyReportScopes.id] }).onDelete('cascade'),
  participant: foreignKey({ name: 'report_membership_participant_fk', columns: [t.tenantId, t.cycleScoringPolicyId, t.participantId], foreignColumns: [surveyReportParticipants.tenantId, surveyReportParticipants.cycleScoringPolicyId, surveyReportParticipants.id] }).onDelete('cascade'),
}));

export const surveyReportWindowBindings = pgTable('survey_report_window_bindings', {
  surveyWindowId: uuid('survey_window_id').primaryKey().references(() => surveyWindows.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull(),
  cycleScoringPolicyId: uuid('cycle_scoring_policy_id').notNull(),
  participantId: uuid('participant_id').notNull(),
}, (t) => ({
  participant: foreignKey({ columns: [t.tenantId, t.cycleScoringPolicyId, t.participantId], foreignColumns: [surveyReportParticipants.tenantId, surveyReportParticipants.cycleScoringPolicyId, surveyReportParticipants.id] }).onDelete('cascade'),
  participantWindow: unique('report_participant_one_window').on(t.tenantId, t.cycleScoringPolicyId, t.participantId),
}));

// Negative state only: a row is never a consent grant. User erasure cascades these tombstones.
export const surveyReportingPermissions = pgTable('survey_reporting_permissions', {
  tenantId: uuid('tenant_id').notNull(), userId: uuid('user_id').notNull(),
  revision: integer('revision').notNull().default(0),
  fullReportingDenied: boolean('full_reporting_denied').notNull().default(false),
  deniedAt: timestamp('denied_at', { withTimezone: true }),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenantId, t.userId] }),
  subject: foreignKey({ columns: [t.userId, t.tenantId], foreignColumns: [users.id, users.tenantId] }).onDelete('cascade'),
  denial: check('report_permission_denial', sql`${t.revision} >= 0 AND (${t.fullReportingDenied} = (${t.deniedAt} IS NOT NULL))`),
}));

export const surveyReportQuestionLineages = pgTable('survey_report_question_lineages', {
  answerKind: text('answer_kind').notNull().default('open_ended'),
  answerContract: text('answer_contract'),
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(),
  cycleScoringPolicyId: uuid('cycle_scoring_policy_id').notNull(), userId: uuid('user_id').notNull(),
  questionStableKey: text('question_stable_key').notNull(), surveyQuestionId: uuid('survey_question_id').notNull(),
  questionVersion: text('question_version').notNull(), scoringPolicyId: uuid('scoring_policy_id').notNull(),
}, (t) => ({
  cycle: foreignKey({ columns: [t.tenantId, t.cycleScoringPolicyId], foreignColumns: [surveyCycleScoringPolicies.tenantId, surveyCycleScoringPolicies.id] }).onDelete('cascade'),
  subject: foreignKey({ columns: [t.userId, t.tenantId], foreignColumns: [users.id, users.tenantId] }).onDelete('cascade'),
  natural: unique('report_lineage_natural').on(t.tenantId, t.cycleScoringPolicyId, t.userId, t.questionStableKey),
  subjectId: unique('report_lineage_subject_id').on(t.tenantId, t.userId, t.id),
}));

export const surveyReportingWithdrawalRequests = pgTable('survey_reporting_withdrawal_requests', {
  tenantId: uuid('tenant_id').notNull(), requestId: text('request_id').notNull(), userId: uuid('user_id').notNull(),
  personId: uuid('person_id').notNull(), targetKind: text('target_kind').notNull(),
  lineageIds: uuid('lineage_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
  provenanceKind: text('provenance_kind').notNull(), verificationId: text('verification_id').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(), permissionRevision: integer('permission_revision').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenantId, t.requestId] }),
  subject: foreignKey({ columns: [t.userId, t.tenantId], foreignColumns: [users.id, users.tenantId] }).onDelete('cascade'),
  target: check('report_withdrawal_target', sql`(${t.targetKind} = 'full_reporting' AND cardinality(${t.lineageIds}) = 0) OR (${t.targetKind} = 'partial_reporting' AND cardinality(${t.lineageIds}) > 0)`),
  proof: check('report_withdrawal_proof', sql`${t.provenanceKind} IN ('verified_subject', 'authorized_internal_rights_request') AND btrim(${t.verificationId}) <> '' AND ${t.personId} = ${t.userId}`),
}));

export const surveyReportingLineageExclusions = pgTable('survey_reporting_lineage_exclusions', {
  tenantId: uuid('tenant_id').notNull(), userId: uuid('user_id').notNull(), lineageId: uuid('lineage_id').primaryKey(),
  requestId: text('request_id').notNull(), excludedAt: timestamp('excluded_at', { withTimezone: true }).notNull(),
}, (t) => ({
  lineage: foreignKey({ columns: [t.tenantId, t.userId, t.lineageId], foreignColumns: [surveyReportQuestionLineages.tenantId, surveyReportQuestionLineages.userId, surveyReportQuestionLineages.id] }).onDelete('cascade'),
  request: foreignKey({ columns: [t.tenantId, t.requestId], foreignColumns: [surveyReportingWithdrawalRequests.tenantId, surveyReportingWithdrawalRequests.requestId] }).onDelete('cascade'),
}));

export const surveyReportInsightRevisions = pgTable('survey_report_insight_revisions', {
  insightId: uuid('insight_id').primaryKey().references(() => surveyQuestionInsights.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull(), userId: uuid('user_id').notNull(), lineageId: uuid('lineage_id').notNull(),
  permissionRevision: integer('permission_revision').notNull().default(0),
  /** Content-free receipt UUID/time pairs; survives working/private message purge. */
  acceptedSourceReceipts: jsonb('accepted_source_receipts'),
  confirmationMessageId: uuid('confirmation_message_id'), confirmationReceivedAt: timestamp('confirmation_received_at', { withTimezone: true }),
  proofStatus: text('proof_status').notNull().default('unverified_historical'),
}, (t) => ({
  lineage: foreignKey({ columns: [t.tenantId, t.userId, t.lineageId], foreignColumns: [surveyReportQuestionLineages.tenantId, surveyReportQuestionLineages.userId, surveyReportQuestionLineages.id] }).onDelete('cascade'),
  proof: check('report_revision_proof', sql`${t.proofStatus} IN ('receipt_backed', 'unverified_historical', 'legacy')`),
}));

// Records even an empty legacy opening, so it cannot later become an org-native cycle.
export const surveyReportLegacyCycleOpenings = pgTable('survey_report_legacy_cycle_openings', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  surveyDefinitionId: uuid('survey_definition_id').notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.surveyDefinitionId, t.periodStart, t.periodEnd] }) }));
