import { createHash } from 'node:crypto';
import {
  BuildPulseReportRequestSchema,
  PulseReportPresentationSchema,
  PULSE_INDEX_KEYS,
  PULSE_LABEL_VERSION,
  PULSE_PRESENTATION_CONTRACT,
  PulseAssemblyError,
  isPulseAssemblyError,
  type BuildPulseReportRequest,
  type PulseAssemblyLease,
  type BuildPulseReportResult,
  type PulsePreparedSection,
  type PulsePresentedMetric,
  type PulsePresentedSection,
  type PulseReportPresentation,
  type PulsePresentedNarrative,
} from '@entalent/contracts';
import type { PulseReportPresentationRepositoryPort } from '../ports/pulse-report-presentation.repository.port';
import type { PulseReportNarrativePort } from '../ports/pulse-report-narrative.port';
import { PreparePulseReportInputsUseCase } from './prepare-pulse-report-inputs.use-case';
import { classifyPulseIndex } from './calculate-pulse-report-metrics';
import {
  generatePulseNarrative,
  projectPulseNarrativeEvidence,
  pulseOpaqueKey,
  resolvePulseLabels,
} from './pulse-report-narrative-policy';
/** Read/build only. No queue, scheduler, persistence or sender can be reached here. */
export class BuildPulseReportUseCase {
  constructor(
    private readonly presentation: PulseReportPresentationRepositoryPort,
    private readonly inputs: PreparePulseReportInputsUseCase,
    private readonly narrative: PulseReportNarrativePort,
    private readonly initiated?: { load(tenantId: string, obligationId: string, token: number): Promise<PulseAssemblyLease | null>; validate(lease: PulseAssemblyLease): Promise<boolean> },
  ) {}
  async execute(input: BuildPulseReportRequest): Promise<BuildPulseReportResult> {
    try {
      return await this.build(input);
    } catch (error) {
      if (isPulseAssemblyError(error)) return { status: error.code };
      return { status: 'blocked' };
    }
  }
  async executeInitiated(tenantId: string, obligationId: string, token: number): Promise<BuildPulseReportResult> {
    const lease = await this.initiated?.load(tenantId, obligationId, token);
    if (!lease || !(await this.initiated!.validate(lease))) return {status:'invalidated'};
    try { return await this.build(lease.request, lease); } catch(error) {
      return {status:isPulseAssemblyError(error) ? error.code : 'blocked'};
    }
  }
  private async build(input: BuildPulseReportRequest, lease?: PulseAssemblyLease): Promise<BuildPulseReportResult> {
    if (!BuildPulseReportRequestSchema.safeParse(input).success)
      return { status: 'invalid_request' };
    if (
      !input ||
      !['team_lead', 'manager'].includes(input.audience) ||
      !['intermediate', 'final'].includes(input.purpose) ||
      (input.purpose === 'intermediate'
        ? !PULSE_INDEX_KEYS.includes(input.indexKey!)
        : input.indexKey !== undefined)
    )
      return { status: 'invalid_request' };
    const context = lease?.context ?? await this.presentation.read(input);
    if (!context) return { status: 'blocked' };
    if (
      !context.scopes.length ||
      context.scopes[0]?.scopeId !== input.overallScopeId ||
      context.scopes[0].kind !== (input.audience === 'team_lead' ? 'team' : 'manager_overall') ||
      (input.audience === 'team_lead' && context.scopes.length !== 1) ||
      context.scopes
        .slice(1)
        .some((s) => s.kind !== 'team' || s.parentScopeId !== input.overallScopeId)
    )
      return { status: 'invalid_request' };
    const prepared = lease ? { status: 'prepared' as const, sections: lease.sections } : await this.inputs.preparePresentationSet(
      context.scopes.map((s, i) => ({
        tenantId: input.tenantId,
        cycleId: input.cycleId,
        scopeId: s.scopeId,
        purpose: input.purpose,
        projection:
          input.audience === 'team_lead'
            ? 'team_lead_overall'
            : i === 0
              ? 'manager_overall'
              : 'manager_team',
      })),
    );
    if (prepared.status !== 'prepared') return { status: prepared.status };
    const sections = prepared.sections;
    if (sections.length !== context.scopes.length) return { status: 'blocked' };
    const first = sections[0]!;
    if (
      sections.some(
        (s, i) =>
          s.context.scopeId !== context.scopes[i]?.scopeId ||
          s.context.tenantId !== input.tenantId ||
          s.context.cycleId !== input.cycleId ||
          s.context.purpose !== input.purpose ||
          s.context.frontier !== first.context.frontier ||
          s.context.generation !== first.context.generation ||
          s.context.periodStart !== context.periodStart ||
          s.context.periodEnd !== context.periodEnd,
      )
    )
      return { status: 'invalidated' };
    const eligible = (s: PulsePreparedSection) =>
      input.purpose === 'final'
        ? s.finalGate === 'eligible'
        : s.metrics.find((m) => m.metricKey === input.indexKey)?.status === 'eligible';
    if (input.purpose === 'intermediate' && !eligible(first)) return { status: 'not_ready' };
    const narrativeCount =
      input.purpose === 'final' && !eligible(first) ? 0 : sections.filter(eligible).length;
    if (narrativeCount > 256) throw new PulseAssemblyError('assembly_capacity_exceeded');
    const labels = await resolvePulseLabels(this.narrative, context.locale);
    const labelHash = createHash('sha256').update(JSON.stringify(labels)).digest('hex');
    const evidenceMappings: Record<
      string,
      Record<string, { subjectId: string; lineageId: string; revisionId: string }>
    > = {};
    const acceptedChildActions: {
      sectionKey: string;
      actions: Awaited<ReturnType<typeof generatePulseNarrative>>['actions'];
    }[] = [];
    const presented = new Map<number, PulsePresentedSection>();
    // Child semantics are accepted first, so overall synthesis can be reviewed against all child actions.
    const activeIndexes =
      input.purpose === 'final' && !eligible(first)
        ? [0]
        : [...sections.keys()].filter((i) => i !== 0).concat(0);
    for (const i of activeIndexes) {
      const s = sections[i]!;
      const sectionKey = 's' + pulseOpaqueKey(i);
      const label = context.scopes[i]!.label;
      if (!eligible(s)) {
        presented.set(i, { sectionKey, label, status: 'insufficient_data' });
        continue;
      }
      const projection = projectPulseNarrativeEvidence(
        s.qualitative,
        s.questionKeys ?? {},
        input.purpose,
        input.indexKey,
      );
      evidenceMappings[sectionKey] = projection.mapping;
      let narrative: PulsePresentedNarrative = {
        explanation: [],
        focus: { kind: 'none_supported' },
        actions: [],
      };
      if (!projection.evidence.length) throw new PulseAssemblyError('narrative_invalid');
      if (projection.evidence.length) {
        const accepted = await generatePulseNarrative(this.narrative, {
          locale: context.locale,
          audience: input.audience,
          sectionRole: i === 0 ? 'overall' : 'team',
          purpose: input.purpose,
          ...(input.indexKey ? { indexKey: input.indexKey } : {}),
          evidence: projection.evidence,
          acceptedChildActions: i === 0 ? acceptedChildActions : [],
        });
        if (i !== 0) acceptedChildActions.push({ sectionKey, actions: accepted.actions });
        narrative = {
          explanation: accepted.explanation.map((e) => e.text),
          focus:
            accepted.focus.kind === 'problem'
              ? { kind: 'problem', text: accepted.focus.text }
              : { kind: 'none_supported' },
          actions: accepted.actions.map((a, n) => ({
            actionKey: sectionKey + 'a' + pulseOpaqueKey(n),
            title: a.title,
            detail: a.detail,
          })),
        };
      }
      const metric = s.metrics.find(
        (m) => m.metricKey === (input.purpose === 'final' ? 'engagement' : input.indexKey),
      );
      if (!metric || metric.rawMean === null) return { status: 'blocked' };
      const baseline = s.baselines?.[metric.metricKey];
      const direction =
        baseline?.status === 'comparable' ? baseline.direction : 'baseline_established';
      const compositionChanged = baseline?.status === 'comparable' && baseline.compositionChanged;
      let display: PulsePresentedMetric;
      if (input.purpose === 'final')
        display = {
          kind: 'engagement',
          value: metric.rawMean.toFixed(1),
          direction,
          compositionChanged,
        };
      else if (input.audience === 'manager')
        display = {
          kind: 'index',
          indexKey: input.indexKey!,
          value: metric.rawMean.toFixed(1),
          direction,
          compositionChanged,
        };
      else {
        const category = classifyPulseIndex(metric.rawMean);
        if (category.status !== 'classified') return { status: 'blocked' };
        display = {
          kind: 'index_category',
          indexKey: input.indexKey!,
          category: category.category,
          direction,
          compositionChanged,
        };
      }
      presented.set(i, { sectionKey, label, status: 'eligible', metric: display, narrative });
    }
    const period = formatPulseReportPeriod(context);
    const presentation = {
      contract: PULSE_PRESENTATION_CONTRACT,
      variant: input.audience + '_' + input.purpose,
      audience: input.audience,
      purpose: input.purpose,
      ...(input.indexKey ? { indexKey: input.indexKey } : {}),
      locale: context.locale,
      period,
      labels,
      labelVersion: PULSE_LABEL_VERSION,
      labelHash,
      sections: sections
        .map((_, i) => presented.get(i))
        .filter((s): s is PulsePresentedSection => Boolean(s)),
    } as PulseReportPresentation;
    if (!PulseReportPresentationSchema.safeParse(presentation).success)
      throw new PulseAssemblyError('narrative_invalid');
    if (!(lease ? await this.initiated!.validate(lease) : await this.presentation.validate(context, sections))) return { status: 'invalidated' };
    deepFreeze(presentation);
    return { status: 'built', presentation, provenance: { context, sections, evidenceMappings } };
  }
}

function deepFreeze(value: unknown): void {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
}

/** Display the last included instant of [start,end), retaining PostgreSQL sub-millisecond precision. */
export function formatPulseReportPeriod(context: {
  locale: string;
  timezone: string;
  periodStart: string;
  periodEnd: string;
}): string {
  const formatter = new Intl.DateTimeFormat(context.locale, {
    timeZone: context.timezone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const fraction = context.periodEnd.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/)?.[1] ?? '';
  const subMillisecond = /[1-9]/.test(fraction.padEnd(6, '0').slice(3));
  const lastIncludedMs = Date.parse(context.periodEnd) - (subMillisecond ? 0 : 1);
  return (
    formatter.format(new Date(context.periodStart)) +
    ' — ' +
    formatter.format(new Date(lastIncludedMs))
  );
}
