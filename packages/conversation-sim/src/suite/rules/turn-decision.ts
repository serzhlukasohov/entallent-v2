import { z } from 'zod';
import type { CaseRun, StepObservation } from '../schema';
import type { RuleEntry } from './registry';
import { missingField } from './reply-selection';
import { syntheticRun } from './synthetic-run';

/**
 * Decisions the orchestrator branches on. `risk.surveyBlocked` and `risk.escalates` restate
 * the product's `riskBlocksSurvey` (unassessed or `surveyMustBeBlocked`) and `mustEscalate`
 * (immediate response or `critical`); `reply.surveyQuestion` is any reply message flagged
 * `containsSurveyProbe`.
 */
const FIELDS = [
  'mode',
  'classification.primaryIntent',
  'classification.urgency',
  'classification.surveyAllowed',
  'classification.requiresSafetyCheck',
  'classification.cycleStatusQuestion',
  'risk.severity',
  'risk.surveyBlocked',
  'risk.escalates',
  'reply.surveyQuestion',
] as const;
type Field = (typeof FIELDS)[number];
type Value = string | boolean;

const ValueSchema = z.union([z.string().min(1), z.boolean()]);
const params = z
  .object({
    step: z.number().int().min(1),
    expect: z
      .array(
        z
          .object({ field: z.enum(FIELDS), in: z.array(ValueSchema).min(1).optional(), notIn: z.array(ValueSchema).min(1).optional() })
          .strict()
          .refine((entry) => (entry.in === undefined) !== (entry.notIn === undefined), { message: 'give exactly one of in, notIn' }),
      )
      .min(1),
  })
  .strict();

const requires = ['turn.mode', 'turn.classification', 'turn.risk', 'reply.messages'] as const;

function valueOf(step: StepObservation, field: Field): Value | undefined {
  const { classification, risk, mode } = step.turn ?? {};
  switch (field) {
    case 'mode':
      return mode;
    case 'classification.primaryIntent':
      return classification?.primaryIntent;
    case 'classification.urgency':
      return classification?.urgency;
    case 'classification.surveyAllowed':
      return classification?.surveyAllowed;
    case 'classification.requiresSafetyCheck':
      return classification?.requiresSafetyCheck;
    case 'classification.cycleStatusQuestion':
      return classification === undefined ? undefined : classification.cycleStatusQuestion === true;
    case 'risk.severity':
      return risk?.severity;
    case 'risk.surveyBlocked':
      return risk === undefined ? undefined : !risk.assessed || risk.surveyMustBeBlocked === true;
    case 'risk.escalates':
      return risk === undefined ? undefined : risk.immediateResponseRequired || risk.severity === 'critical';
    case 'reply.surveyQuestion':
      return (step.reply?.messages ?? []).some((message) => message.metadata.containsSurveyProbe === true);
  }
}

/**
 * The orchestrator's decisions on `step` meet every expectation: each named field's value
 * is in `in` (or not in `notIn`). A step whose decisions were not recorded is NOT_OBSERVABLE.
 */
export const turnDecision: RuleEntry = {
  requires,
  params,
  run(run, _criterion, raw) {
    const { step, expect } = params.parse(raw ?? {});
    const missing = missingField(requires, run);
    if (missing) return { status: 'NOT_OBSERVABLE', evidence: `unobservable:${missing}@${run.level}` };
    const observed = run.steps[step - 1];
    const stopped = run.stoppedAtStep !== undefined && step > run.stoppedAtStep;
    if (observed === undefined || stopped) return { status: 'NOT_OBSERVABLE', evidence: `step-not-reached:${step}` };
    const failures: string[] = [];
    for (const entry of expect) {
      const value = valueOf(observed, entry.field);
      if (value === undefined) return { status: 'NOT_OBSERVABLE', evidence: `decision-not-recorded:${entry.field}@${step}` };
      const ok = entry.in !== undefined ? entry.in.includes(value) : !entry.notIn!.includes(value);
      if (!ok) failures.push(`${entry.field}=${String(value)} (${entry.in !== undefined ? 'expected' : 'not'} ${(entry.in ?? entry.notIn)!.join('|')})`);
    }
    return failures.length === 0 ? { status: 'PASS' } : { status: 'FAIL', evidence: `turn ${step}: ${failures.join('; ')}` };
  },
  fixtures: {
    params: { step: 1, expect: [{ field: 'risk.severity', in: ['none', 'low'] }, { field: 'mode', notIn: ['crisis', 'sensitive'] }] },
    pass: decided('RULE-turn-decision-pass', 'low', 'coaching'),
    fail: decided('RULE-turn-decision-fail', 'high', 'sensitive'),
  },
};

function decided(testId: string, severity: string, mode: string): CaseRun {
  const run = syntheticRun(testId, ['Reply.'], [...requires]);
  return {
    ...run,
    steps: run.steps.map((step) => ({
      ...step,
      turn: {
        mode,
        classification: { primaryIntent: 'coaching', secondaryIntents: [], urgency: 'low', requiresSafetyCheck: false, surveyAllowed: true },
        risk: { assessed: true, severity, riskType: null, immediateResponseRequired: false, tripwireRaised: false, surveyMustBeBlocked: false },
      },
    })),
  };
}
