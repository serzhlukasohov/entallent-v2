import type { ScenarioResult } from '@langwatch/scenario';
import { expect } from 'vitest';
import type { CoachHarness } from '../harness/coach-harness';
import { describeViolations, findViolations } from '../harness/assertions';
import type { ScenarioRunReport } from '../harness/report';
import { reportRun, writeScenarioRunReport } from '../harness/report';

export async function reportDeterministicRun(
  name: string,
  harness: CoachHarness,
): Promise<void> {
  await reportRun(name, harness, {
    success: true,
    metCriteria: ['deterministic structural scenario passed'],
    unmetCriteria: [],
    reasoning: 'Deterministic baseline scenario; no LLM judge was used.',
  } as unknown as ScenarioResult, false);
}

export function reportDeterministicPolicyRun(
  name: string,
  checks: Array<{ rule: string; passed: boolean; detail: string }>,
): void {
  const violations = checks
    .filter((check) => !check.passed)
    .map((check) => ({ turn: 0, rule: check.rule, detail: check.detail }));
  const report: ScenarioRunReport = {
    schemaVersion: 1,
    gateId: process.env.SIM_GATE_ID ?? null,
    gateRunId: process.env.SIM_GATE_RUN_ID ?? null,
    scenarioName: name,
    scenarioSlug: slugify(name),
    runAt: new Date().toISOString(),
    gitSha: process.env.SIM_GATE_GIT_SHA ?? null,
    models: {
      coachBalanced: process.env.OPENAI_MODEL_BALANCED ?? null,
      simulator: process.env.SIM_SIMULATOR_MODEL ?? 'gpt-4o-mini',
      judge: process.env.SIM_JUDGE_MODEL ?? 'gpt-4o',
      azureTestingDeployment: process.env.AZURE_OPENAI_TESTING_DEPLOYMENT ?? null,
    },
    judge: {
      evaluated: false,
      passed: false,
      metCriteria: [],
      unmetCriteria: [],
      reasoning: 'Deterministic policy scenario; no LLM judge was used.',
    },
    deterministic: {
      passed: violations.length === 0,
      violations,
    },
    turns: [],
    memoryItems: [],
    styleProfile: null,
  };

  writeScenarioRunReport(report);
}

export function expectNoDeterministicViolations(harness: CoachHarness): void {
  const violations = findViolations(harness);
  expect(describeViolations(violations)).toBe('');
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
