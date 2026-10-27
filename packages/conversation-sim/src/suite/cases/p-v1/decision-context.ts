/**
 * Decision and context criteria approved by Illia on 2026-10-27 (`p-v1-effects-draft.md`,
 * "Proposed decision checks" and "Proposed context checks"). Decision criteria read the
 * recorded classification and risk, which are scripted at L0, so they are L1 only. Context
 * criteria read the digest of the reply-model call, which the product builds without a model,
 * so they decide at L0 unless the context depends on the classifier.
 */

type Expectation = { field: string; in?: Array<string | boolean>; notIn?: Array<string | boolean> };

export function decisionCriterion(id: string, expect: Expectation[], step = 1): Record<string, unknown> {
  return { id, evaluatedAt: `after-step:${step}`, levels: ['L1'], checks: [{ type: 'rule', rule: 'turn-decision', params: { step, expect } }] };
}

export function contextCriterion(
  id: string,
  expect: Record<string, unknown>,
  options: { step?: number; call?: 'first' | 'last'; levels?: string[] } = {},
): Record<string, unknown> {
  const step = options.step ?? 1;
  return {
    id,
    evaluatedAt: step === 0 ? 'observation-window' : `after-step:${step}`,
    ...(options.levels ? { levels: options.levels } : {}),
    checks: [{ type: 'rule', rule: 'model-context', params: { step, ...(options.call ? { call: options.call } : {}), expect } }],
  };
}

/** An ordinary request is not a risk turn: no risk, no crisis or sensitive handling. */
export const NOT_A_RISK_TURN: Expectation[] = [
  { field: 'risk.severity', in: ['none'] },
  { field: 'mode', notIn: ['crisis', 'sensitive'] },
];
/** The survey may run on this turn. */
export const SURVEY_ALLOWED: Expectation[] = [
  { field: 'classification.surveyAllowed', in: [true] },
  { field: 'risk.surveyBlocked', in: [false] },
];
