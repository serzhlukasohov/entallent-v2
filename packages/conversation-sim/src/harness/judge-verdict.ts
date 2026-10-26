import { expect } from 'vitest';
import type { ScenarioResult } from '@langwatch/scenario';

/**
 * A judge verdict is one sample of a subjective rubric. Inside `pnpm sim:gate` the gate counts
 * judge passes against the scenario's `judgePasses`, so a miss is logged and left to the report
 * instead of failing the Vitest test, which the gate would count as a hard failure. A standalone
 * run (no `SIM_GATE_RUN_ID`) still asserts the verdict directly. A failed result with no judged
 * criteria (for example a script that ended without a verdict) is not a judge miss and always fails.
 */
export function expectJudgeVerdict(
  result: Pick<ScenarioResult, 'success' | 'reasoning' | 'metCriteria' | 'unmetCriteria'>,
  label: string,
): void {
  const judgeMissed = !result.success && result.metCriteria.length + result.unmetCriteria.length > 0;
  if (process.env.SIM_GATE_RUN_ID && judgeMissed) {
    console.warn(`[${label}] judge did not pass this sample: ${result.reasoning ?? 'no reasoning'}`);
    return;
  }
  expect(result.success, result.reasoning ?? 'judge did not pass').toBe(true);
}
