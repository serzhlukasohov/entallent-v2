import { z } from 'zod';
import type {
  PulseAllowedTopic,
  PulseInputPurpose,
  PulsePreparationResult,
} from './pulse-report-inputs';
export const PULSE_PRESENTATION_CONTRACT = 'pulse-presentation-v1' as const;
export const PULSE_LABEL_VERSION = 'pulse-labels-v1' as const;
export const PULSE_INDEX_KEYS = ['autonomy', 'growth', 'purpose', 'belonging'] as const;
export type PulseIndexKey = (typeof PULSE_INDEX_KEYS)[number];
export type PulseReportAudience = 'team_lead' | 'manager';
export interface BuildPulseReportRequest {
  tenantId: string;
  cycleId: string;
  overallScopeId: string;
  audience: PulseReportAudience;
  purpose: PulseInputPurpose;
  indexKey?: PulseIndexKey;
}
export interface PulsePresentationScope {
  scopeId: string;
  label: string;
  kind: 'team' | 'manager_overall';
  parentScopeId: string | null;
}
/** Restricted, frozen metadata. Scope IDs never enter presentation or channel payloads. */
export interface PulseAssemblyContext {
  request: BuildPulseReportRequest;
  scopes: PulsePresentationScope[];
  locale: string;
  timezone: string;
  configRevision: number;
  configurationToken: string;
  periodStart: string;
  periodEnd: string;
}
export type PulsePreparedSection = Extract<PulsePreparationResult, { status: 'prepared' }>;
export type PulsePreparedSet =
  | { status: 'prepared'; sections: PulsePreparedSection[] }
  | { status: 'pending' | 'blocked'; reason: string };
export const PULSE_ENGLISH_LABELS = {
  title_tl_intermediate: 'Team Lead preliminary report',
  title_tl_final: 'Team Lead final report',
  title_manager_intermediate: 'Manager preliminary report',
  title_manager_final: 'Manager final report',
  title_insufficient_final: 'Final report',
  index_autonomy: 'Autonomy',
  index_growth: 'Growth',
  index_purpose: 'Purpose',
  index_belonging: 'Belonging',
  engagement: 'Engagement',
  period: 'Period',
  overall_scope: 'Overall scope',
  teams_management: 'Teams in management',
  explanation: 'Explanation',
  main_focus: 'Main focus',
  actions: 'Actions',
  state_healthy: 'Healthy',
  state_attention: 'Needs attention',
  state_critical: 'Critical',
  direction_improving: 'Improving',
  direction_stable: 'Stable',
  direction_declining: 'Declining',
  baseline_established: 'Baseline established',
  preliminary_notice:
    'These results and recommendations are preliminary. The final report is due on the last working day of the cycle.',
  insufficient_data: 'Insufficient data',
  none_supported_problem: 'No concrete current priority is supported by the available evidence.',
  none_supported_action: 'No current action is supported by the available evidence.',
  composition_caveat: 'Changes in composition may influence the comparison.',
  part: 'Part',
  continued: 'Continued',
} as const;
export type PulseLabelKey = keyof typeof PULSE_ENGLISH_LABELS;
export type PulseLabels = Record<PulseLabelKey, string>;
export function isPulseUnicodeText(value: string): boolean {
  if (/[\p{N}\p{Cc}\u202a-\u202e\u2066-\u2069%]/u.test(value)) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => v.trim().length > 0, 'empty_prose')
    .refine(isPulseUnicodeText, 'unsafe_prose');
const references = z.array(z.string().regex(/^e[A-Z]+$/)).min(1);
const statement = z.object({ text: text(1200), references }).strict();
export const PulseNarrativeSchema = z
  .object({
    explanation: z
      .array(statement)
      .min(1)
      .max(12)
      .refine((a) => a.reduce((n, s) => n + s.text.length, 0) <= 1200),
    focus: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('none_supported') }).strict(),
      z.object({ kind: z.literal('problem'), text: text(400), references }).strict(),
    ]),
    actions: z.array(z.object({ title: text(100), detail: text(400), references }).strict()).max(3),
  })
  .strict();
export type PulseNarrative = z.infer<typeof PulseNarrativeSchema>;
export const PULSE_SEMANTIC_VIOLATIONS = [
  'unsupported_cause',
  'unsupported_focus',
  'unsupported_action',
  'unsupported_prevalence',
  'missing_opposed_experience',
  'missing_positive_driver',
  'missing_minority_issue',
  'wrong_role',
  'missing_team_lead_mediation',
  'obsolete_action',
  'duplicate_action',
  'copied_child_actions',
  'identity_hint',
  'numeric_claim',
  'spelled_quantity',
  'wrong_language',
  'meaning_changed',
  'cross_index',
  'evidence_instruction',
  'unverified_cause',
  'missing_evidence',
  'ambiguous',
  'locale_or_meaning',
  'atomic_label',
  'incomplete_labels',
] as const;
export const PulseSemanticReviewSchema = z
  .object({
    verdict: z.enum(['pass', 'fail']),
    violations: z.array(z.enum(PULSE_SEMANTIC_VIOLATIONS)).max(32),
  })
  .strict()
  .refine((v) => v.verdict === 'fail' || v.violations.length === 0, 'ambiguous_verdict');
export type PulseSemanticReview = z.infer<typeof PulseSemanticReviewSchema>;
const labelShape = Object.fromEntries(
  Object.keys(PULSE_ENGLISH_LABELS).map((k) => [
    k,
    text(
      k === 'preliminary_notice'
        ? 400
        : k === 'insufficient_data'
          ? 200
          : ['none_supported_problem', 'none_supported_action', 'composition_caveat'].includes(k)
            ? 300
            : ['part', 'continued'].includes(k)
              ? 40
              : 100,
    ).refine(
      (v) => !(/[<>{}*_`~]|https?:|@/iu.test(v) || v.includes('[') || v.includes(']')),
      'non_atomic_label',
    ),
  ]),
) as unknown as Record<PulseLabelKey, z.ZodType<string>>;
export const PulseLabelsSchema = z.object(labelShape).strict();
export interface PulseSafeEvidence {
  handle: string;
  support: NonNullable<PulseAllowedTopic['summarySupport']>;
  text: string;
  direction?: string;
  severity?: string;
  category?: string;
}
export interface PulseNarrativeRequest {
  locale: string;
  audience: PulseReportAudience;
  sectionRole: 'overall' | 'team';
  purpose: PulseInputPurpose;
  indexKey?: PulseIndexKey;
  evidence: PulseSafeEvidence[];
  acceptedChildActions: { sectionKey: string; actions: PulseNarrative['actions'] }[];
}
export type PulseAssemblyFailureCode =
  | 'invalid_request'
  | 'pending'
  | 'blocked'
  | 'not_ready'
  | 'invalidated'
  | 'narrative_invalid'
  | 'language_unavailable'
  | 'assembly_capacity_exceeded';
export class PulseAssemblyError extends Error {
  constructor(readonly code: PulseAssemblyFailureCode) {
    super(code);
    this.name = 'PulseAssemblyError';
  }
}
export interface PulsePresentedNarrative {
  explanation: string[];
  focus: { kind: 'none_supported' } | { kind: 'problem'; text: string };
  actions: { actionKey: string; title: string; detail: string }[];
}
export type PulsePresentedMetric =
  | {
      kind: 'index_category';
      indexKey: PulseIndexKey;
      category: 'healthy' | 'needs_attention' | 'critical';
      direction: 'baseline_established' | 'improving' | 'stable' | 'declining';
      compositionChanged: boolean;
    }
  | {
      kind: 'index';
      indexKey: PulseIndexKey;
      value: string;
      direction: string;
      compositionChanged: boolean;
    }
  | { kind: 'engagement'; value: string; direction: string; compositionChanged: boolean };
export type PulsePresentedSection =
  | { sectionKey: string; label: string; status: 'insufficient_data' }
  | {
      sectionKey: string;
      label: string;
      status: 'eligible';
      metric: PulsePresentedMetric;
      narrative: PulsePresentedNarrative;
    };
interface PulsePresentationBase {
  contract: typeof PULSE_PRESENTATION_CONTRACT;
  locale: string;
  period: string;
  labels: PulseLabels;
  labelVersion: typeof PULSE_LABEL_VERSION;
  labelHash: string;
  sections: PulsePresentedSection[];
}
export type PulseReportPresentation = PulsePresentationBase &
  (
    | {
        variant: 'team_lead_intermediate';
        purpose: 'intermediate';
        audience: 'team_lead';
        indexKey: PulseIndexKey;
      }
    | {
        variant: 'manager_intermediate';
        purpose: 'intermediate';
        audience: 'manager';
        indexKey: PulseIndexKey;
      }
    | { variant: 'team_lead_final'; purpose: 'final'; audience: 'team_lead' }
    | { variant: 'manager_final'; purpose: 'final'; audience: 'manager' }
  );
export interface PulseAssemblyProvenance {
  context: PulseAssemblyContext;
  sections: PulsePreparedSection[];
  evidenceMappings: Record<
    string,
    Record<string, { lineageId: string; revisionId: string; subjectId: string }>
  >;
}
export type BuildPulseReportResult =
  | { status: 'built'; presentation: PulseReportPresentation; provenance: PulseAssemblyProvenance }
  | { status: PulseAssemblyFailureCode };

export const BuildPulseReportRequestSchema = z
  .object({
    tenantId: z.string().min(1).max(128),
    cycleId: z.string().min(1).max(128),
    overallScopeId: z.string().min(1).max(128),
    audience: z.enum(['team_lead', 'manager']),
    purpose: z.enum(['intermediate', 'final']),
    indexKey: z.enum(PULSE_INDEX_KEYS).optional(),
  })
  .strict()
  .refine(
    (v) => (v.purpose === 'intermediate' ? v.indexKey !== undefined : v.indexKey === undefined),
    'invalid_phase_index',
  );
const presentedNarrativeSchema = z
  .object({
    explanation: z
      .array(text(1200))
      .min(1)
      .refine((a) => a.reduce((n, s) => n + s.length, 0) <= 1200),
    focus: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('none_supported') }).strict(),
      z.object({ kind: z.literal('problem'), text: text(400) }).strict(),
    ]),
    actions: z
      .array(
        z
          .object({
            actionKey: z.string().regex(/^s[A-Z]+a[A-Z]+$/),
            title: text(100),
            detail: text(400),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
const metricBase = {
  direction: z.enum(['improving', 'stable', 'declining', 'baseline_established']),
  compositionChanged: z.boolean(),
};
const presentedMetricSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...metricBase,
      kind: z.literal('index_category'),
      indexKey: z.enum(PULSE_INDEX_KEYS),
      category: z.enum(['healthy', 'needs_attention', 'critical']),
    })
    .strict(),
  z
    .object({
      ...metricBase,
      kind: z.literal('index'),
      indexKey: z.enum(PULSE_INDEX_KEYS),
      value: z
        .string()
        .regex(/^\d{1,3}\.\d$/)
        .refine((v) => Number(v) <= 100),
    })
    .strict(),
  z
    .object({
      ...metricBase,
      kind: z.literal('engagement'),
      value: z
        .string()
        .regex(/^\d{1,2}\.\d$/)
        .refine((v) => Number(v) >= 1 && Number(v) <= 10),
    })
    .strict(),
]);
const presentedSectionSchema = z.discriminatedUnion('status', [
  z
    .object({
      sectionKey: z.string().regex(/^s[A-Z]+$/),
      label: z.string().min(1),
      status: z.literal('insufficient_data'),
    })
    .strict(),
  z
    .object({
      sectionKey: z.string().regex(/^s[A-Z]+$/),
      label: z.string().min(1),
      status: z.literal('eligible'),
      metric: presentedMetricSchema,
      narrative: presentedNarrativeSchema,
    })
    .strict(),
]);
/** Channel-neutral public DTO: all nested objects reject unknown/restricted fields. */
export const PulseReportPresentationSchema = z
  .object({
    contract: z.literal(PULSE_PRESENTATION_CONTRACT),
    locale: z.string().min(1),
    period: z.string().min(1),
    labels: PulseLabelsSchema,
    labelVersion: z.literal(PULSE_LABEL_VERSION),
    labelHash: z.string().regex(/^[a-f0-9]{64}$/),
    sections: z.array(presentedSectionSchema).min(1),
    variant: z.enum([
      'team_lead_intermediate',
      'team_lead_final',
      'manager_intermediate',
      'manager_final',
    ]),
    purpose: z.enum(['intermediate', 'final']),
    audience: z.enum(['team_lead', 'manager']),
    indexKey: z.enum(PULSE_INDEX_KEYS).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const sectionKeys = new Set<string>();
    const actionKeys = new Set<string>();
    for (const [sectionIndex, section] of v.sections.entries()) {
      if (sectionKeys.has(section.sectionKey))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'duplicate_section_identity',
          path: ['sections', sectionIndex, 'sectionKey'],
        });
      sectionKeys.add(section.sectionKey);
      if (section.status === 'eligible')
        for (const [actionIndex, action] of section.narrative.actions.entries()) {
          if (
            actionKeys.has(action.actionKey) ||
            !action.actionKey.startsWith(section.sectionKey + 'a')
          )
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'invalid_action_identity',
              path: ['sections', sectionIndex, 'narrative', 'actions', actionIndex, 'actionKey'],
            });
          actionKeys.add(action.actionKey);
        }
    }

    if (
      v.variant !== v.audience + '_' + v.purpose ||
      (v.purpose === 'intermediate' ? v.indexKey === undefined : v.indexKey !== undefined) ||
      (v.audience === 'team_lead' && v.sections.length !== 1)
    )
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_variant' });
    for (const s of v.sections)
      if (
        s.status === 'eligible' &&
        ((v.purpose === 'final' && s.metric.kind !== 'engagement') ||
          (v.purpose === 'intermediate' &&
            (s.metric.kind !== (v.audience === 'team_lead' ? 'index_category' : 'index') ||
              ('indexKey' in s.metric && s.metric.indexKey !== v.indexKey))))
      )
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'forbidden_metric' });
    if (
      v.sections[0]?.status === 'insufficient_data' &&
      (v.purpose !== 'final' || v.sections.length !== 1)
    )
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_overall_insufficiency' });
  });
/** Workspace consumers may load ESM/CJS copies; classify only our closed typed error vocabulary. */
export function isPulseAssemblyError(error: unknown): error is PulseAssemblyError {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return (
    candidate.name === 'PulseAssemblyError' &&
    typeof candidate.code === 'string' &&
    [
      'invalid_request',
      'pending',
      'blocked',
      'not_ready',
      'invalidated',
      'narrative_invalid',
      'language_unavailable',
      'assembly_capacity_exceeded',
    ].includes(candidate.code)
  );
}
