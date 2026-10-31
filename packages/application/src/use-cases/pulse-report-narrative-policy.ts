import {
  PULSE_INDEX_KEYS,
  PulseNarrativeSchema,
  PulseSemanticReviewSchema,
  PulseLabelsSchema,
  PULSE_ENGLISH_LABELS,
  PulseAssemblyError,
  type PulseAllowedTopic,
  type PulseInputPurpose,
  type PulseNarrativeRequest,
  type PulseNarrative,
  type PulseSafeEvidence,
  type PulseLabels,
} from '@entalent/contracts';
import type { PulseReportNarrativePort } from '../ports/pulse-report-narrative.port';
import { calculatePulseIndexMetric } from './calculate-pulse-report-metrics';
export function pulseOpaqueKey(n: number): string {
  let key = '';
  do {
    key = String.fromCharCode(65 + (n % 26)) + key;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return key;
}
export function projectPulseNarrativeEvidence(
  topics: readonly PulseAllowedTopic[],
  questionKeys: Record<string, string[]>,
  purpose: PulseInputPurpose,
  indexKey?: string,
) {
  const approved = topics.filter(
    (t) =>
      t.kind === 'index' &&
      PULSE_INDEX_KEYS.some((key) => key === t.questionGroup) &&
      Boolean(questionKeys[t.questionGroup]?.includes(t.questionKey)) &&
      (purpose === 'final' || t.questionGroup === indexKey),
  );
  const selected = approved.filter(
    (t) => t.support === 'safe_permanent_summary' && Boolean(t.safeSummary),
  );
  let allowed = selected;
  if (purpose === 'intermediate') {
    const keys = questionKeys[indexKey ?? ''] ?? [];
    const subjects = new Set(approved.map((t) => t.subjectId));
    const complete = new Set(
      [...subjects].filter((participantId) => {
        const answers = approved
          .filter((t) => t.subjectId === participantId)
          .map((t) => ({ questionKey: t.questionKey, value: t.value }));
        const computed = calculatePulseIndexMetric({
          expectedQuestionKeys: keys,
          participants: [{ participantId, answers }],
        });
        return computed.status === 'calculated' && computed.completeCount === 1;
      }),
    );
    allowed = selected.filter((t) => complete.has(t.subjectId));
  }
  const mapping: Record<string, { subjectId: string; lineageId: string; revisionId: string }> = {};
  const evidence: PulseSafeEvidence[] = allowed.map((t, i) => {
    const handle = 'e' + pulseOpaqueKey(i);
    mapping[handle] = { subjectId: t.subjectId, lineageId: t.lineageId, revisionId: t.revisionId };
    return {
      handle,
      support: t.summarySupport ?? 'unverified_historical',
      text: t.safeSummary!,
      ...(t.signalDirection ? { direction: t.signalDirection } : {}),
      ...(t.signalSeverity ? { severity: t.signalSeverity } : {}),
      ...(t.rootCauseCategory ? { category: t.rootCauseCategory } : {}),
    };
  });
  return { evidence, mapping };
}
export function validatePulseNarrative(
  raw: unknown,
  handles: readonly string[],
): { success: false } | { success: true; data: PulseNarrative } {
  const parsed = PulseNarrativeSchema.safeParse(raw);
  if (!parsed.success) return { success: false };
  const n = parsed.data;
  const allowed = new Set(handles);
  const refs = [
    ...n.explanation,
    ...(n.focus.kind === 'problem' ? [n.focus] : []),
    ...n.actions,
  ].flatMap((s) => s.references);
  const actions = n.actions.map((a) =>
    (a.title + ' ' + a.detail).normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim(),
  );
  if (refs.some((r) => !allowed.has(r)) || new Set(actions).size !== actions.length)
    return { success: false as const };
  return parsed;
}
export async function generatePulseNarrative(
  port: PulseReportNarrativePort,
  input: PulseNarrativeRequest,
): Promise<PulseNarrative> {
  let corrections: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const draft = await port.draft(input, corrections);
    const parsed = validatePulseNarrative(
      draft,
      input.evidence.map((e) => e.handle),
    );
    if (!parsed.success) {
      corrections = ['draft_shape_or_references'];
      continue;
    }
    const review = PulseSemanticReviewSchema.safeParse(await port.review(input, parsed.data));
    if (review.success && review.data.verdict === 'pass' && review.data.violations.length === 0)
      return parsed.data;
    corrections = review.success ? review.data.violations : ['review_invalid'];
  }
  throw new PulseAssemblyError('narrative_invalid');
}
export async function resolvePulseLabels(
  port: PulseReportNarrativePort,
  locale: string,
): Promise<PulseLabels> {
  if (new Intl.Locale(locale).language === 'en') return { ...PULSE_ENGLISH_LABELS };
  let corrections: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await port.localize(locale, PULSE_ENGLISH_LABELS, corrections);
    const parsed = PulseLabelsSchema.safeParse(raw);
    if (!parsed.success) {
      corrections = ['label_shape_or_atomic_meaning'];
      continue;
    }
    const review = PulseSemanticReviewSchema.safeParse(
      await port.reviewLabels(locale, PULSE_ENGLISH_LABELS, parsed.data),
    );
    if (review.success && review.data.verdict === 'pass' && review.data.violations.length === 0)
      return parsed.data;
    corrections = review.success ? review.data.violations : ['review_invalid'];
  }
  throw new PulseAssemblyError('language_unavailable');
}
