import {
  PulseNarrativeSchema,
  PulseSemanticReviewSchema,
  type PulseNarrativeRequest,
} from '@entalent/contracts';
import type { PulseReportNarrativePort } from '@entalent/application';
export const PULSE_NARRATIVE_EVALUATION_RUBRIC = [
  'source_entailment',
  'support_class_and_unknown_cause',
  'opposed_and_minority_experiences',
  'cross_index_isolation',
  'focus_support',
  'role_and_team_lead_remit',
  'current_distinct_actions',
  'overall_child_distinction',
  'no_identity_or_numeric_claims',
  'company_language_and_meaning',
] as const;
export interface PulseNarrativeEvaluationCase {
  caseKey: string;
  request: PulseNarrativeRequest;
  draft: unknown;
  expected: 'pass' | 'fail';
}
/** Offline evidence validates the harness/shape only. It is never semantic or multilingual acceptance. */
export function evaluatePulseNarrativeOffline(c: PulseNarrativeEvaluationCase) {
  const parsed = PulseNarrativeSchema.safeParse(c.draft);
  const allowed = new Set(c.request.evidence.map((e) => e.handle));
  const references = parsed.success
    ? [
        ...parsed.data.explanation,
        ...(parsed.data.focus.kind === 'problem' ? [parsed.data.focus] : []),
        ...parsed.data.actions,
      ].flatMap((v) => v.references)
    : [];
  return {
    caseKey: c.caseKey,
    shape: parsed.success ? 'passed' : 'failed',
    localReferences: references.every((r) => allowed.has(r)) ? 'passed' : 'failed',
    semanticAcceptance: 'not_evaluated',
    multilingualAcceptance: 'not_evaluated',
    rubric: PULSE_NARRATIVE_EVALUATION_RUBRIC,
  };
}
/** No CLI, scheduler or default test invokes model work. Caller must supply explicit approval and a provider. */
export async function runPulseNarrativeOptInEvaluation(
  port: PulseReportNarrativePort,
  cases: readonly PulseNarrativeEvaluationCase[],
  authorization: 'explicitly_approved',
) {
  if (authorization !== 'explicitly_approved')
    throw new Error('pulse_narrative_evaluation_requires_explicit_approval');
  const results = [];
  for (const c of cases) {
    const review = PulseSemanticReviewSchema.safeParse(await port.review(c.request, c.draft));
    results.push({
      caseKey: c.caseKey,
      status: review.success && review.data.verdict === c.expected ? 'matched' : 'failed',
      modelAcceptance: 'external_review_only',
    });
  }
  return results;
}
