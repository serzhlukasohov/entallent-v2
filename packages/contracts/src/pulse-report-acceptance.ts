import { z } from 'zod';

export const PULSE_ACCEPTANCE_CASE_IDS = Array.from({ length: 33 }, (_, n) =>
  `RPT-AC-${String(n + 1).padStart(2, '0')}`);
/** Human-approved local obligations, independent of child-produced evidence. */
export const PULSE_ACCEPTANCE_LOCAL_OBLIGATIONS = [
  ['01','private_source_query_and_tenant_isolation','P01'],
  ['02','explicit_driver_refusal_vs_missing_cause','P02'],
  ['03','corrected_statement_requires_shown_agreement','P02'],
  ['04','one_person_three_scores_latest_only','P03'],
  ['05','overall_deduplication_and_own_tl_exclusion','P03'],
  ['06','frozen_origin_transfer_deactivation_next_cycle','P05'],
  ['07','full_partial_withdrawal_denominators','P05'],
  ['08','partial_lineage_qualitative_permission','P05'],
  ['09','allowed_final_vs_intermediate_sources','P04'],
  ['10','privacy_fallback_preserves_membership','P04'],
  ['11','delivered_numeric_probes_and_invalid_opposites','P02'],
  ['12','raw_category_boundaries_and_tl_visibility','P03'],
  ['13','actual_prior_final_raw_nonzero_trend','P04'],
  ['14','incompatible_latest_baseline_and_composition','P04'],
  ['15','exact_native_threshold_races','P03'],
  ['16','actual_calendar_due_first_start','P04'],
  ['17','timely_held_finalization_and_late_exclusion','P05'],
  ['18','pending_before_insufficiency_and_recovery','P05'],
  ['19','five_of_hundred_and_zero_to_four_notice','P04'],
  ['20','team_floor_and_own_leader_opposite','P04'],
  ['21','eligible_overall_all_children_insufficient','P04'],
  ['22','mixed_focus_reference_and_reviewer_rejection','P04'],
  ['23','distinct_current_role_actions_and_opposites','P04'],
  ['24','native_tl_intermediate_contract','P03'],
  ['25','native_tl_final_contract','P04'],
  ['26','native_manager_intermediate_contract','P03'],
  ['27','native_manager_final_contract','P04'],
  ['28','company_personal_locale_and_score_identity','P04'],
  ['29','frozen_literal_preview_notice_multipart','P07'],
  ['30','source_recipient_credential_revalidation','P05'],
  ['31','send_uncertainty_restart_reconciliation','P05'],
  ['32','exact_one_two_three_four_changed_people','P04'],
  ['33','valid_admin_without_audience_and_lifetimes','P05'],
] as const;
export const PulseAcceptanceStatusSchema = z.enum(['passed', 'failed', 'not_run', 'blocked']);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/);
export const PulseAcceptanceDimensionSchema = z.enum([
  'local', 'semantic', 'native_client', 'public_ingress', 'production',
]);
export const PulseAcceptanceAssertionSchema = z.object({
  id,
  caseIds: z.array(z.string().regex(/^RPT-AC-(0[1-9]|[12][0-9]|3[0-3])$/)).min(1),
  phase: z.enum(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07']),
  status: PulseAcceptanceStatusSchema,
  dimension: PulseAcceptanceDimensionSchema,
  assertionCount: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  evidenceHash: hash,
  testIds: z.array(hash).min(1),
}).strict().superRefine((value, context) => {
  if (new Set(value.caseIds).size !== value.caseIds.length)
    context.addIssue({ code: 'custom', message: 'duplicate_case_id' });
  if (value.status === 'passed' && (value.assertionCount === 0 || value.skipped !== 0))
    context.addIssue({ code: 'custom', message: 'passed_assertions_require_nonempty_no_skip_execution' });
});

export type PulseAcceptanceAssertion = z.infer<typeof PulseAcceptanceAssertionSchema>;

export const PulseAcceptanceLaneSchema = z.object({
  id: z.enum(['connected', 'restart', 'migration', 'preview', 'regressions']),
  runId: id,
  sourceHash: hash,
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  status: PulseAcceptanceStatusSchema,
  cleanup: PulseAcceptanceStatusSchema,
  exitCode: z.number().int().nullable(),
  tests: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  assertions: z.array(PulseAcceptanceAssertionSchema),
  artifactHashes: z.array(hash),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.finishedAt) < Date.parse(value.startedAt))
    context.addIssue({ code: 'custom', message: 'invalid_clock_order' });
  if (value.status === 'passed' && (value.exitCode !== 0 || value.tests === 0
    || value.skipped !== 0 || value.cleanup !== 'passed' || value.assertions.length === 0
    || value.assertions.some((a) => a.status !== 'passed' || a.dimension !== 'local')
    || value.artifactHashes.length === 0))
    context.addIssue({ code: 'custom', message: 'invalid_passed_lane' });
  if (new Set(value.assertions.map((a) => a.id)).size !== value.assertions.length)
    context.addIssue({ code: 'custom', message: 'duplicate_assertion_id' });
});
export type PulseAcceptanceLane = z.infer<typeof PulseAcceptanceLaneSchema>;

export const PulseAcceptanceBundleSchema = z.object({
  schemaVersion: z.literal('pulse-acceptance-v1'),
  mode: z.literal('local-synthetic'),
  runId: id,
  base: z.string().regex(/^[a-f0-9]{40}$/),
  branch: z.literal('codex/pulse-check-reports'),
  sourceHash: hash,
  createdAt: z.string().datetime(),
  runtimeMode: z.literal('explicit_test_constructors'),
  transport: z.literal('synthetic'),
  lanes: z.array(PulseAcceptanceLaneSchema),
  migration: z.object({
    ledgerCount: z.number().int().min(99),
    prefixLedgerCount: z.literal(92),
    protectedManifestHash: hash,
    baselineSchemaMigrated: PulseAcceptanceStatusSchema,
    fixtureInsertedWithGuards: PulseAcceptanceStatusSchema,
    suffixExecuted: PulseAcceptanceStatusSchema,
    postUpgradeAssertions: PulseAcceptanceStatusSchema,
    currentReaderOrDeliveryContinuation: PulseAcceptanceStatusSchema,
    historicalProducerExecuted: z.literal('blocked'),
    historicalProducerReason: z.literal('not_provided'),
  }).strict(),
}).strict();
export type PulseAcceptanceBundle = z.infer<typeof PulseAcceptanceBundleSchema>;

export const PulseAcceptanceReadinessSchema = z.object({
  schemaVersion: z.literal('pulse-readiness-v1'),
  runId: id,
  validation: z.enum(['passed', 'failed']),
  pilotEligibility: z.literal('blocked'),
  activationExecuted: z.literal(false),
  gates: z.array(z.object({
    id: z.string().regex(/^G(0[1-9]|1[01])$/),
    status: PulseAcceptanceStatusSchema,
    reason: id,
  }).strict()).length(11),
  cases: z.array(z.object({
    id: z.string().regex(/^RPT-AC-(0[1-9]|[12][0-9]|3[0-3])$/),
    local: PulseAcceptanceStatusSchema,
    assertionIds: z.array(id),
    semantic: z.literal('not_run'),
    nativeClient: z.literal('not_run'),
    publicIngress: z.literal('blocked'),
    production: z.literal('not_run'),
  }).strict()).length(33),
  failures: z.array(id),
}).strict();
export type PulseAcceptanceReadiness = z.infer<typeof PulseAcceptanceReadinessSchema>;
