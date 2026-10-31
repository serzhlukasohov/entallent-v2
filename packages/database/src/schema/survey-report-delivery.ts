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
import { surveyReportScopes } from './survey-report-scopes';
import { tenants } from './tenants';
const clock = (n: string) => timestamp(n, { withTimezone: true, mode: 'string' });
export const surveyReportObservations = pgTable(
  'survey_report_observations',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    cycleId: uuid('cycle_id').notNull(),
    generation: bigint('generation', { mode: 'number' }).notNull().default(0),
    observedGeneration: bigint('observed_generation', { mode: 'number' }),
    nextObservationAt: clock('next_observation_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    scanCursorAt: clock('scan_cursor_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.cycleId] }),
    tenant: foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
  }),
);
/** Identity contains no narrative/source content and is not deleted with private payload. */
export const surveyReportObligations = pgTable(
  'survey_report_obligations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    cycleId: uuid('cycle_id').notNull(),
    scopeId: uuid('scope_id').notNull(),
    audience: text('audience').notNull(),
    purpose: text('purpose').notNull(),
    indexKey: text('index_key').notNull().default('final'),
    status: text('status').notNull().default('observing'),
    assemblyToken: bigint('assembly_token', { mode: 'number' }).notNull().default(0),
    leaseUntil: clock('lease_until'),
    initiatedAt: clock('initiated_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    frontier: clock('frontier').notNull(),
    configRevision: integer('config_revision').notNull(),
    nextActionAt: clock('next_action_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    repairCursorAt: clock('repair_cursor_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    disposition: text('disposition'),
    completedAt: clock('completed_at'),
    deliveredAt: clock('delivered_at'),
  },
  (t) => ({
    identity: unique('report_obligation_native_identity').on(
      t.tenantId,
      t.cycleId,
      t.scopeId,
      t.audience,
      t.purpose,
      t.indexKey,
    ),
    tenantIdentity: unique('report_obligation_tenant_id').on(t.tenantId, t.id),
    scope: foreignKey({
      columns: [t.tenantId, t.cycleId, t.scopeId],
      foreignColumns: [
        surveyReportScopes.tenantId,
        surveyReportScopes.cycleScoringPolicyId,
        surveyReportScopes.id,
      ],
    }),
    shape: check(
      'report_obligation_shape',
      sql`(${t.purpose}='intermediate' and ${t.indexKey} in ('autonomy','growth','purpose','belonging')) or (${t.purpose}='final' and ${t.indexKey}='final')`,
    ),
    audience: check('report_obligation_audience', sql`${t.audience} in ('team_lead','manager')`),
    states: check(
      'report_obligation_status',
      sql`${t.status} in ('observing','assembling','snapshot_ready','delivering','delivered','pending','blocked','canceled','reconciliation_required')`,
    ),
  }),
);
/** Restricted resumable prepared observation; purged on successful freeze or retention. */
export const surveyReportAssemblyInputs = pgTable(
  'survey_report_assembly_inputs',
  {
    obligationId: uuid('obligation_id')
      .primaryKey()
      .references(() => surveyReportObligations.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    context: jsonb('context').notNull(),
    sections: jsonb('sections').notNull(),
    sourceCandidateIds: uuid('source_candidate_ids')
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),
    expiresAt: clock('expires_at').notNull(),
  },
  (t) => ({
    owner: foreignKey({
      columns: [t.tenantId, t.obligationId],
      foreignColumns: [surveyReportObligations.tenantId, surveyReportObligations.id],
    }).onDelete('cascade'),
  }),
);
export const surveyReportRecipientProofs = pgTable('survey_report_recipient_proofs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  scopeId: uuid('scope_id').notNull(),
  binding: jsonb('binding').notNull(),
  verifiedAt: clock('verified_at')
    .notNull()
    .default(sql`clock_timestamp()`),
  expiresAt: clock('expires_at').notNull(),
});
export const surveyReportNativeSnapshots = pgTable(
  'survey_report_native_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    obligationId: uuid('obligation_id').notNull().unique(),
    cycleId: uuid('cycle_id').notNull(),
    scopeId: uuid('scope_id').notNull(),
    purpose: text('purpose').notNull(),
    artifactHash: text('artifact_hash').notNull(),
    partCount: integer('part_count').notNull(),
    createdAt: clock('created_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    expiresAt: clock('expires_at').notNull(),
    purgedAt: clock('purged_at'),
  },
  (t) => ({
    tenantIdentity: unique('report_snapshot_tenant_id').on(t.tenantId, t.id),
    obligation: foreignKey({
      columns: [t.tenantId, t.obligationId],
      foreignColumns: [surveyReportObligations.tenantId, surveyReportObligations.id],
    }),
    shape: check(
      'report_snapshot_shape',
      sql`${t.partCount}>0 and ${t.partCount}<=1024 and ${t.artifactHash} ~ '^[a-f0-9]{64}$'`,
    ),
  }),
);
export const surveyReportSnapshotPayloads = pgTable(
  'survey_report_snapshot_payloads',
  {
    snapshotId: uuid('snapshot_id')
      .primaryKey()
      .references(() => surveyReportNativeSnapshots.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    contracts: jsonb('contracts').notNull().default({}),
    presentation: jsonb('presentation').notNull(),
    provenance: jsonb('provenance').notNull(),
    manifest: jsonb('manifest').notNull(),
    route: jsonb('route').notNull(),
  },
  (t) => ({
    owner: foreignKey({
      columns: [t.tenantId, t.snapshotId],
      foreignColumns: [surveyReportNativeSnapshots.tenantId, surveyReportNativeSnapshots.id],
    }).onDelete('cascade'),
  }),
);
export const surveyReportParts = pgTable(
  'survey_report_parts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    snapshotId: uuid('snapshot_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    bodyHash: text('body_hash').notNull(),
    status: text('status').notNull().default('pending'),
    attemptToken: bigint('attempt_token', { mode: 'number' }).notNull().default(0),
  },
  (t) => ({
    identity: unique('report_part_snapshot_ordinal').on(t.snapshotId, t.ordinal),
    tenantIdentity: unique('report_part_tenant_identity').on(t.tenantId, t.snapshotId, t.id),
    snapshot: foreignKey({
      columns: [t.tenantId, t.snapshotId],
      foreignColumns: [surveyReportNativeSnapshots.tenantId, surveyReportNativeSnapshots.id],
    }),
    shape: check(
      'report_part_shape',
      sql`${t.ordinal}>0 and ${t.bodyHash} ~ '^[a-f0-9]{64}$' and ${t.status} in ('pending','attempt_started','dispatching','delivered','unknown','canceled')`,
    ),
  }),
);
export const surveyReportPartPayloads = pgTable('survey_report_part_payloads', {
  partId: uuid('part_id')
    .primaryKey()
    .references(() => surveyReportParts.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').notNull(),
});
export const surveyReportAttempts = pgTable(
  'survey_report_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    snapshotId: uuid('snapshot_id').notNull(),
    partId: uuid('part_id').notNull(),
    token: bigint('token', { mode: 'number' }).notNull(),
    state: text('state').notNull().default('attempt_started'),
    artifactHash: text('artifact_hash').notNull(),
    bodyHash: text('body_hash').notNull(),
    routeHash: text('route_hash').notNull(),
    authorizationReceipt: text('authorization_receipt').notNull(),
    startedAt: clock('started_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    resolvedAt: clock('resolved_at'),
    reason: text('reason'),
    retryable: integer('retryable').notNull().default(0),
    nextAttemptAt: clock('next_attempt_at'),
  },
  (t) => ({
    identity: unique('report_attempt_part_token').on(t.partId, t.token),
    tenantIdentity: unique('report_attempt_tenant_identity').on(t.tenantId, t.snapshotId, t.id),
    part: foreignKey({
      columns: [t.tenantId, t.snapshotId, t.partId],
      foreignColumns: [
        surveyReportParts.tenantId,
        surveyReportParts.snapshotId,
        surveyReportParts.id,
      ],
    }),
    states: check(
      'report_attempt_state',
      sql`${t.token}>0 and ${t.state} in ('attempt_started','dispatching','delivered','unknown','definitely_not_sent')`,
    ),
  }),
);
export const surveyReportReceipts = pgTable(
  'survey_report_receipts',
  {
    attemptId: uuid('attempt_id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    snapshotId: uuid('snapshot_id').notNull(),
    channel: text('channel').notNull(),
    providerTimestamp: text('provider_timestamp').notNull(),
    recordedAt: clock('recorded_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    evidenceRef: text('evidence_ref'),
  },
  (t) => ({
    attempt: foreignKey({
      columns: [t.tenantId, t.snapshotId, t.attemptId],
      foreignColumns: [
        surveyReportAttempts.tenantId,
        surveyReportAttempts.snapshotId,
        surveyReportAttempts.id,
      ],
    }),
  }),
);
export const surveyReportCompletionSupports = pgTable(
  'survey_report_completion_supports',
  {
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => surveyReportNativeSnapshots.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id').notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    cycleId: uuid('cycle_id').notNull(),
    historyKey: text('history_key').notNull(),
    metricKey: text('metric_key').notNull(),
    contextHash: text('context_hash').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.snapshotId, t.candidateId, t.metricKey] }),
    owner: foreignKey({
      columns: [t.tenantId, t.snapshotId],
      foreignColumns: [surveyReportNativeSnapshots.tenantId, surveyReportNativeSnapshots.id],
    }).onDelete('cascade'),
  }),
);
export const surveyReportReconciliations = pgTable(
  'survey_report_reconciliations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    snapshotId: uuid('snapshot_id').notNull(),
    attemptId: uuid('attempt_id').notNull(),
    token: bigint('token', { mode: 'number' }).notNull(),
    decision: text('decision').notNull(),
    actorId: text('actor_id').notNull(),
    authorizationRef: text('authorization_ref').notNull(),
    reason: text('reason').notNull(),
    evidenceRef: text('evidence_ref').notNull(),
    evidence: jsonb('evidence').notNull(),
    recordedAt: clock('recorded_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => ({
    attempt: foreignKey({
      columns: [t.tenantId, t.snapshotId, t.attemptId],
      foreignColumns: [
        surveyReportAttempts.tenantId,
        surveyReportAttempts.snapshotId,
        surveyReportAttempts.id,
      ],
    }),
  }),
);
/** Bounded fair observation is per native audience scope, independently of obligation eligibility. */
export const surveyReportScopeObservations = pgTable(
  'survey_report_scope_observations',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    cycleId: uuid('cycle_id').notNull(),
    scopeId: uuid('scope_id').primaryKey(),
    observedGeneration: bigint('observed_generation', { mode: 'number' }),
    nextObservationAt: clock('next_observation_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    scanCursorAt: clock('scan_cursor_at')
      .notNull()
      .default(sql`clock_timestamp()`),
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
  }),
);
