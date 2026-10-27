import { z } from 'zod';
import type { RunEvent } from '../schema';
import type { RuleEntry } from './registry';
import { missingField } from './reply-selection';
import { syntheticRun } from './synthetic-run';

const params = z
  .object({
    port: z.string().min(1),
    method: z.string().min(1),
    expected: z.number().int().nonnegative(),
    /** The evaluated step; 0 covers fixtures and seed. */
    step: z.number().int().nonnegative(),
  })
  .strict();

const requires = ['events'] as const;

function call(stepIndex: number, port: string, method: string, outcome: RunEvent['outcome'], seq: number): RunEvent {
  return { stepIndex, seq, port, method, argsSummary: '', outcome, resultSummary: '', durationMs: 1 };
}

const passRun = syntheticRun('RULE-effect-count-pass', ['Staged.'], ['events']);
const failRun = syntheticRun('RULE-effect-count-fail', ['Staged.'], ['events']);

/**
 * Vacuous-pass guard (AD-6, AD-10): the evaluated step produced exactly `expected`
 * successful `port.method` calls. Only `outcome: 'ok'` events of that step count.
 * `evaluate` synthesizes the params from the manifest's `stateEffect`.
 */
export const effectCount: RuleEntry = {
  requires,
  params,
  run(run, _criterion, raw) {
    const { port, method, expected, step } = params.parse(raw ?? {});
    const missing = missingField(requires, run);
    if (missing) return { status: 'NOT_OBSERVABLE', evidence: `unobservable:${missing}@${run.level}` };
    const stopped = run.stoppedAtStep !== undefined && step > run.stoppedAtStep;
    if (step > run.steps.length || stopped) return { status: 'NOT_OBSERVABLE', evidence: `step-not-reached:${step}` };
    const count = run.events.filter(
      (event) => event.stepIndex === step && event.port === port && event.method === method && event.outcome === 'ok',
    ).length;
    return count === expected
      ? { status: 'PASS' }
      : { status: 'FAIL', evidence: `effect-count ${port}.${method}@${step}: ${count}` };
  },
  fixtures: {
    params: { port: 'questionConfirmationRepo', method: 'stageBundle', expected: 1, step: 1 },
    pass: { ...passRun, events: [call(1, 'questionConfirmationRepo', 'stageBundle', 'ok', 0)] },
    fail: {
      ...failRun,
      events: [
        call(0, 'questionConfirmationRepo', 'stageBundle', 'ok', 0),
        call(1, 'questionConfirmationRepo', 'stageBundle', 'error', 1),
      ],
    },
  },
};
