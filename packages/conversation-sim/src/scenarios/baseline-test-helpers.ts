import type { ScenarioResult } from '@langwatch/scenario';
import { expect } from 'vitest';
import type { CoachHarness } from '../harness/coach-harness';
import { describeViolations, findViolations } from '../harness/assertions';
import { reportRun } from '../harness/report';

export async function reportDeterministicRun(
  name: string,
  harness: CoachHarness,
): Promise<void> {
  await reportRun(name, harness, {
    success: true,
    metCriteria: ['deterministic structural scenario passed'],
    unmetCriteria: [],
    reasoning: 'Deterministic baseline scenario; no LLM judge was used.',
  } as unknown as ScenarioResult);
}

export function expectNoDeterministicViolations(harness: CoachHarness): void {
  const violations = findViolations(harness);
  expect(describeViolations(violations)).toBe('');
}
